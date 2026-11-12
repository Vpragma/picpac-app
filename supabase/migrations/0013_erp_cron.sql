-- 0013 · A1 / пункт 22: демо-заказы двигаются сами, без открытия клиентом.
-- pg_cron каждые 30 секунд вызывает private.erp_tick(): каждому просроченному демо-заказу — ОДИН шаг за тик
-- (через ту же public.erp_apply_event), время шага — по плану (прошлая смена + 30 с), поэтому статус меняется
-- каждые 30–60 секунд, а не все шаги разом. Заказы тестовых аккаунтов (e2e-…, critic-…) расписание не трогает —
-- их двигает только ленивый путь при чтении (тесты остаются детерминированными). Синтетика стоит на месте.
-- Выключить, ничего не удаляя: private.app_settings → erp_sim → "cron": false (или cron.unschedule('picpac-erp-tick')).

-- Тот же симулятор, что private.erp_sim_order (0007), но с пределом шагов за вызов
create or replace function private.erp_sim_order_steps(_id uuid, _step int, _max int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  _o public.orders; _next text; _base timestamptz; _at timestamptz; _n int := 0; _hist int; _r jsonb; _book boolean; _why text;
begin
  for _guard in 1..greatest(1, least(coalesce(_max, 1), 12)) loop
    select * into _o from public.orders where id = _id;
    if not found or not _o.is_demo or _o.is_synthetic or _o.status = 'done' then exit; end if;
    _base := greatest(_o.status_changed_at, coalesce(_o.stage_changed_at, _o.status_changed_at));
    _why := null;
    if _o.status = 'accepted' then
      exit when _o.payment_status <> 'paid_test';
      _next := 'moderation_started';
      _base := greatest(_o.status_changed_at, coalesce(_o.paid_at, _o.status_changed_at));
      _why := 'Оплата получена (тест): заказ ушёл на проверку макета';
    elsif _o.status = 'moderation' then
      exit when private.order_moderation_blocked(_id);
      _next := 'moderation_passed';
      _why := 'Автоодобрение: у фото нет флагов модерации';
    elsif _o.status = 'production' then
      select exists (select 1 from public.order_items i where i.order_id = _id and i.snapshot ->> 'kind' = 'book') into _book;
      _next := case coalesce(_o.erp_stage, 'moderation_passed')
                 when 'moderation_passed' then 'print_started' when 'print_started' then 'printed'
                 when 'printed' then case when _book then 'bound' else 'packed' end
                 when 'bound' then 'packed' else 'handed_to_delivery' end;
    elsif _o.status = 'shipped' then
      _next := 'delivered';
      _step := _step * 2;   -- доставка в демо идёт вдвое дольше
    else
      exit;
    end if;
    _at := _base + make_interval(secs => _step);
    exit when _at > now();
    select count(*) into _hist from public.order_status_history where order_id = _id;
    _r := public.erp_apply_event('sim:' || _id || ':' || _next || ':' || _hist, _id, _next, _at,
                                 case when _next in ('moderation_started','moderation_passed') then 'system' else 'simulator' end,
                                 null, _why, '{}'::jsonb);
    exit when _r ->> 'result' <> 'applied' or coalesce((_r ->> 'replayed')::boolean, false);
    _n := _n + 1;
  end loop;
  return _n;
end $$;

create or replace function private.erp_tick() returns int
language plpgsql security definer set search_path = '' as $$
declare _s jsonb; _step int; _id uuid; _sim int; _n int := 0;
begin
  select value into _s from private.app_settings where key = 'erp_sim';
  if coalesce((_s ->> 'enabled')::boolean, true) = false or coalesce((_s ->> 'cron')::boolean, true) = false then
    return 0;
  end if;
  _step := coalesce((_s ->> 'stepSeconds')::int, 30);
  for _id, _sim in
    select o.id, o.sim_step_seconds from public.orders o
     where o.is_demo and not o.is_synthetic and o.status <> 'done'
       and not exists (select 1 from auth.users u
                        where u.id = o.user_id and (u.email ilike 'e2e-%' or u.email ilike 'critic-%'))
     order by o.updated_at
     limit 200
  loop
    begin
      _n := _n + private.erp_sim_order_steps(_id, coalesce(_sim, _step), 1);
    exception when others then
      raise warning 'erp_tick %: %', _id, sqlerrm;
    end;
  end loop;
  return _n;
end $$;

revoke all on function private.erp_sim_order_steps(uuid, int, int) from public;
revoke all on function private.erp_tick() from public;

-- Расписание. Если pg_cron недоступен — миграция не падает, статусы двигает ленивый путь при чтении.
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  begin
    perform cron.schedule('picpac-erp-tick', '30 seconds', 'select private.erp_tick()');
  exception when others then
    perform cron.schedule('picpac-erp-tick', '* * * * *', 'select private.erp_tick()');   -- старый pg_cron: раз в минуту
  end;
  perform cron.schedule('picpac-cron-cleanup', '0 3 * * *', $c$ delete from cron.job_run_details where end_time < now() - interval '3 days' $c$);
exception when others then
  raise notice 'pg_cron недоступен (%): статусы двигает ленивое продвижение при чтении', sqlerrm;
end $$;
