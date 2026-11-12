-- 0007 · D3: мок ERP (события производства), симулятор, ручная смена статуса, уведомления клиенту и сотрудникам.
-- Только добавление: новые столбцы с умолчаниями, новые таблицы, новые функции и триггеры.
-- Все переходы статуса заказа идут через одну функцию public.erp_apply_event().
-- База общая со старым кодом: триггеры никогда не роняют вставку (ошибка → предупреждение в лог).

-- ───────────── Заказы: стадия производства и время её смены ─────────────
alter table public.orders add column if not exists erp_stage text
  check (erp_stage in ('moderation_passed','print_started','printed','bound','packed','handed_to_delivery','delivered'));
alter table public.orders add column if not exists stage_changed_at timestamptz;
alter table public.orders add column if not exists sim_step_seconds int check (sim_step_seconds between 1 and 3600);

-- Лента: какое событие создало строку
alter table public.order_status_history add column if not exists event_id text;
alter table public.order_status_history add column if not exists event_type text;

-- Принятые события (exactly-once по event_id). Отказы (409) сюда не пишутся — только в журнал.
create table if not exists public.erp_events (
  event_id text primary key check (event_id ~ '^[A-Za-z0-9_.:-]{8,120}$'),
  order_id uuid not null references public.orders (id) on delete cascade,
  type text not null check (type in ('moderation_started','moderation_passed','print_started','printed','bound','packed',
                                     'handed_to_delivery','delivered','manual_status')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  source text not null check (source in ('erp','simulator','admin','moderator','system')),
  status_after text not null,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists erp_events_order_idx on public.erp_events (order_id, received_at);

-- ───────────── Уведомления ─────────────
alter table public.notifications add column if not exists interaction_id uuid references public.interactions (id) on delete cascade;
alter table public.notifications add column if not exists link text check (link ~ '^/[A-Za-z0-9]' and char_length(link) <= 200);
alter table public.notifications add column if not exists category text not null default 'orders' check (category in ('orders','support','moderation'));
alter table public.notifications add column if not exists dedupe_key text check (char_length(dedupe_key) <= 120);
create unique index if not exists notifications_dedupe_idx on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- Уведомления сотрудникам: audience 'moderator' видят модератор и админ, 'admin' — только админ
create table if not exists public.staff_notifications (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('order_new','order_status','moderation_needed','moderation_replacement','support_new','support_message')),
  audience text not null default 'admin' check (audience in ('admin','moderator')),
  title text not null check (char_length(title) <= 160),
  body text not null default '' check (char_length(body) <= 300),
  order_id uuid references public.orders (id) on delete cascade,
  interaction_id uuid references public.interactions (id) on delete cascade,
  link text check (link ~ '^/[A-Za-z0-9]' and char_length(link) <= 200),
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists staff_notifications_at_idx on public.staff_notifications (audience, created_at desc);
create table if not exists public.staff_notification_reads (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now()
);

-- Обращения: кто из операторов ответил последним
alter table public.interactions add column if not exists first_response_at timestamptz;

insert into private.app_settings (key, value)
values ('erp_sim', '{"enabled": true, "stepSeconds": 30, "deliveryFactor": 2}')
on conflict (key) do nothing;

-- ───────────── Функции ─────────────

create or replace function private.erp_rank(_s text) returns int language sql immutable set search_path = '' as $$
  select case _s when 'moderation_passed' then 1 when 'print_started' then 2 when 'printed' then 3
    when 'bound' then 4 when 'packed' then 5 when 'handed_to_delivery' then 6 when 'delivered' then 7 else 0 end $$;

create or replace function private.status_label(_s text) returns text language sql immutable set search_path = '' as $$
  select case _s when 'accepted' then 'Принят' when 'moderation' then 'Модерация' when 'production' then 'Производство'
    when 'shipped' then 'Готов / передан в доставку' when 'done' then 'Завершён' else _s end $$;

-- Ждёт ли заказ модератора. D3: фото с флагом без одобрения. D4 заменяет тело (очередь moderation_reviews).
create or replace function private.order_moderation_blocked(_order uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.moderation_reviews r where r.order_id = _order and r.decision in ('pending','rejected'))
      or exists (select 1 from public.order_items i, jsonb_array_elements(coalesce(i.snapshot -> 'photos','[]'::jsonb)) p
                  where i.order_id = _order and coalesce((p ->> 'moderationFlag')::boolean, false)
                    and not exists (select 1 from public.moderation_reviews r
                                     where r.order_id = _order and r.photo_id::text = p ->> 'id' and r.decision = 'approved')) $$;

-- Вход в «Модерацию»: D4 создаёт здесь записи очереди. Возвращает число новых записей.
create or replace function private.order_moderation_enter(_order uuid) returns int
language plpgsql security definer set search_path = '' as $$ begin return 0; end $$;

-- Единственная точка смены статуса заказа: события ERP, симулятор, модератор и ручная смена админом.
--   _type: moderation_started (система после тестовой оплаты), moderation_passed … delivered (ERP), manual_status (админ).
-- Ответ: {result: applied|rejected, replayed, status, stage, substatus, code}
create or replace function public.erp_apply_event(_event_id text, _order uuid, _type text, _at timestamptz,
  _source text default 'erp', _actor uuid default null, _reason text default null, _payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _prev public.erp_events;
  _o public.orders;
  _to text; _sub text; _stage text; _code text; _when timestamptz; _src text; _why text;
begin
  select * into _prev from public.erp_events where event_id = _event_id;
  if found then
    if _prev.order_id <> _order or _prev.type <> _type then
      return jsonb_build_object('result','rejected','code','idempotency_conflict');
    end if;
    return jsonb_build_object('result','applied','replayed',true,'status',_prev.status_after);
  end if;

  select * into _o from public.orders where id = _order for update;   -- события одного заказа — строго по очереди
  if not found then return jsonb_build_object('result','rejected','code','order_not_found'); end if;
  select * into _prev from public.erp_events where event_id = _event_id;   -- повтор успел, пока ждали блокировку
  if found then
    if _prev.order_id <> _order or _prev.type <> _type then
      return jsonb_build_object('result','rejected','code','idempotency_conflict');
    end if;
    return jsonb_build_object('result','applied','replayed',true,'status',_prev.status_after);
  end if;

  if _type = 'manual_status' then
    _to := _payload ->> 'status';
    if _to is null or _to not in ('accepted','moderation','production','shipped','done') then
      _code := 'invalid_status';
    elsif char_length(btrim(coalesce(_reason, ''))) < 5 then
      _code := 'reason_required';
    elsif _to = _o.status then
      _code := 'same_status';
    end if;
    _stage := case _to when 'shipped' then 'handed_to_delivery' when 'done' then 'delivered' else null end;
    _sub := case _to when 'accepted' then 'Заказ принят' when 'moderation' then 'Проверяем макет и фото'
                     when 'production' then 'Ждёт печати' when 'shipped' then 'Передан в доставку' else 'Доставлен' end;
  elsif _type = 'moderation_started' then
    if _o.status <> 'accepted' or _o.payment_status <> 'paid_test' then _code := 'invalid_transition'; end if;
    _to := 'moderation'; _stage := null; _sub := 'Проверяем макет и фото';
  elsif _type in ('moderation_passed','print_started','printed','bound','packed','handed_to_delivery','delivered') then
    if _o.status <> (case _type when 'moderation_passed' then 'moderation' when 'delivered' then 'shipped' else 'production' end)
       or (_type <> 'moderation_passed' and private.erp_rank(_type) <= private.erp_rank(_o.erp_stage)) then
      _code := 'invalid_transition';
    elsif _type = 'moderation_passed' and private.order_moderation_blocked(_order) then
      _code := 'moderation_pending';
    end if;
    _to := case _type when 'moderation_passed' then 'production' when 'handed_to_delivery' then 'shipped'
                      when 'delivered' then 'done' else 'production' end;
    _stage := _type;
    _sub := case _type when 'moderation_passed' then 'Макет одобрен, ждёт печати' when 'print_started' then 'Печать'
                       when 'printed' then 'Напечатано' when 'bound' then 'Переплёт и сборка' when 'packed' then 'Упаковано'
                       when 'handed_to_delivery' then 'Передан в доставку' else 'Доставлен' end;
  else
    _code := 'invalid_type';
  end if;
  if _code is not null then
    return jsonb_build_object('result','rejected','code',_code,'status',_o.status,'stage',_o.erp_stage);
  end if;

  -- Время шага: не раньше прошлой смены и не позже «сейчас» — лента всегда по порядку
  _when := least(greatest(coalesce(_at, now()), coalesce(_o.stage_changed_at, _o.status_changed_at), _o.status_changed_at), now());
  update public.orders
     set status = _to, substatus = _sub, erp_stage = _stage, stage_changed_at = _when,
         status_changed_at = case when _to <> _o.status then _when else status_changed_at end, updated_at = now()
   where id = _order;
  _src := case when _source in ('erp','simulator') then 'erp' when _source in ('admin','moderator') then 'admin' else 'system' end;
  _why := coalesce(nullif(btrim(coalesce(_reason, '')), ''), _sub);
  insert into public.order_status_history (order_id, status, substatus, at, source, reason, actor_id, event_id, event_type)
  values (_order, _to, _sub, _when, _src, left(_why, 500), _actor, _event_id, _type);
  insert into public.erp_events (event_id, order_id, type, occurred_at, source, status_after, payload)
  values (_event_id, _order, _type, _when, _source, _to, coalesce(_payload, '{}'::jsonb));
  if _to = 'moderation' then perform private.order_moderation_enter(_order); end if;
  return jsonb_build_object('result','applied','replayed',false,'status',_to,'stage',_stage,'substatus',_sub,'from',_o.status);
end $$;

-- Симулятор производства для одного демо-заказа: догоняет пропущенные шаги (не больше 12 за вызов).
-- Каждый шаг — через erp_apply_event, поэтому правила и лента те же, что у настоящего ERP.
create or replace function private.erp_sim_order(_id uuid, _step int) returns int
language plpgsql security definer set search_path = '' as $$
declare
  _o public.orders; _next text; _base timestamptz; _at timestamptz; _n int := 0; _hist int; _r jsonb; _book boolean; _why text;
begin
  for _guard in 1..12 loop
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

-- Ленивое продвижение при чтении (вызывает сервер приложения): только указанные демо-заказы.
create or replace function public.erp_tick_orders(_orders uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare _s jsonb; _step int; _id uuid; _n int := 0; _sim int;
begin
  select value into _s from private.app_settings where key = 'erp_sim';
  if coalesce((_s ->> 'enabled')::boolean, true) = false then return 0; end if;
  _step := coalesce((_s ->> 'stepSeconds')::int, 30);
  for _id, _sim in
    select o.id, o.sim_step_seconds from public.orders o
     where o.id = any (coalesce(_orders, '{}'::uuid[])) and o.is_demo and not o.is_synthetic and o.status <> 'done'
     limit 100
  loop
    _n := _n + private.erp_sim_order(_id, coalesce(_sim, _step));
  end loop;
  return _n;
end $$;

-- ───────────── Триггеры уведомлений (никогда не роняют вставку) ─────────────

create or replace function private.notify_on_status() returns trigger
language plpgsql security definer set search_path = '' as $$
declare _o record; _kind text; _title text; _body text; _on boolean;
begin
  begin
    select o.id, o.number, o.user_id, o.is_synthetic into _o from public.orders o where o.id = new.order_id;
    if not found or _o.is_synthetic then return null; end if;

    -- Сотрудникам (админу): каждый заказ — новый и каждая смена статуса (подэтапы производства — нет)
    if new.event_type is null or new.event_type in ('moderation_started','moderation_passed','handed_to_delivery','delivered','manual_status') then
      insert into public.staff_notifications (kind, audience, title, body, order_id, link, dedupe_key)
      values (case when new.status = 'accepted' and new.source = 'system' then 'order_new' else 'order_status' end, 'admin',
              case when new.status = 'accepted' and new.source = 'system' then 'Новый заказ ' || _o.number
                   else _o.number || ' → ' || private.status_label(new.status) end,
              left(coalesce(new.reason, ''), 300), new.order_id, '/admin/orders/' || new.order_id, 'hist:' || new.id)
      on conflict (dedupe_key) do nothing;
    end if;

    -- Клиенту: только важное — принят, готов и передан в доставку, завершён
    if _o.user_id is null then return null; end if;
    if new.status = 'accepted' and new.source = 'system' then
      _kind := 'order_accepted'; _title := 'Заказ принят'; _body := 'Заказ ' || _o.number || ' принят. Статус можно смотреть в «Заказах».';
    elsif new.status = 'shipped' then
      _kind := 'order_shipped'; _title := 'Заказ готов и передан в доставку'; _body := 'Заказ ' || _o.number || ' напечатан, упакован и передан в доставку.';
    elsif new.status = 'done' then
      _kind := 'order_done'; _title := 'Заказ завершён'; _body := 'Заказ ' || _o.number || ' доставлен. Спасибо, что печатаете с PicPac!';
    else
      return null;
    end if;
    select s.order_updates into _on from public.notification_settings s where s.user_id = _o.user_id;
    if _on is false then return null; end if;
    insert into public.notifications (user_id, kind, title, body, order_id, link, category, dedupe_key)
    values (_o.user_id, _kind, _title, _body, new.order_id, '/orders/' || new.order_id, 'orders', _kind || ':' || new.order_id)
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  exception when others then
    raise warning 'notify_on_status: %', sqlerrm;
  end;
  return null;
end $$;

create or replace function private.notify_on_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare _i record;
begin
  begin
    select i.id, i.user_id, i.topic, i.order_id, o.number, o.is_synthetic,
           (select count(*) from public.interaction_messages m where m.interaction_id = i.id and m.author_kind = 'client') as client_msgs
      into _i
      from public.interactions i join public.orders o on o.id = i.order_id where i.id = new.interaction_id;
    if not found or _i.is_synthetic then return null; end if;
    if new.author_kind = 'operator' and _i.user_id is not null then
      insert into public.notifications (user_id, kind, title, body, order_id, interaction_id, link, category, dedupe_key)
      values (_i.user_id, 'support_reply', 'Ответ поддержки', left('Заказ ' || _i.number || ': ' || new.body, 300), _i.order_id, _i.id,
              '/orders/' || _i.order_id || '#support', 'support', 'msg:' || new.id)
      on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
      update public.interactions set first_response_at = coalesce(first_response_at, new.created_at) where id = _i.id;
    elsif new.author_kind = 'client' then
      insert into public.staff_notifications (kind, audience, title, body, order_id, interaction_id, link, dedupe_key)
      values (case when _i.client_msgs <= 1 then 'support_new' else 'support_message' end, 'admin',
              case when _i.client_msgs <= 1 then 'Новое обращение · ' else 'Сообщение клиента · ' end || _i.number,
              left(_i.topic || ': ' || new.body, 300), _i.order_id, _i.id, '/admin/support/' || _i.id, 'msg:' || new.id)
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then
    raise warning 'notify_on_message: %', sqlerrm;
  end;
  return null;
end $$;

create or replace trigger order_status_history_notify after insert on public.order_status_history
  for each row execute function private.notify_on_status();
create or replace trigger interaction_messages_notify after insert on public.interaction_messages
  for each row execute function private.notify_on_message();

-- ───────────── Права ─────────────
alter table public.erp_events enable row level security;
alter table public.staff_notifications enable row level security;
alter table public.staff_notification_reads enable row level security;
do $$ begin
  create policy erp_events_admin on public.erp_events for select to authenticated using ((select public.has_role('admin')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_notifications_staff on public.staff_notifications for select to authenticated
    using ((select public.has_role('admin')) or (audience = 'moderator' and (select public.has_role('moderator'))));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_reads_own on public.staff_notification_reads for select to authenticated using (user_id = (select auth.uid()));
exception when duplicate_object then null; end $$;
revoke all on public.erp_events, public.staff_notifications, public.staff_notification_reads from anon, authenticated;
grant select on public.erp_events, public.staff_notifications, public.staff_notification_reads to authenticated;
grant select, insert, update, delete on public.erp_events, public.staff_notifications, public.staff_notification_reads to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on function public.erp_apply_event(text, uuid, text, timestamptz, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.erp_tick_orders(uuid[]) from public, anon, authenticated;
grant execute on function public.erp_apply_event(text, uuid, text, timestamptz, text, uuid, text, jsonb) to service_role;
grant execute on function public.erp_tick_orders(uuid[]) to service_role;
revoke all on function private.erp_sim_order(uuid, int) from public;
revoke all on function private.order_moderation_blocked(uuid) from public;
revoke all on function private.order_moderation_enter(uuid) from public;
revoke all on function private.notify_on_status() from public;
revoke all on function private.notify_on_message() from public;
