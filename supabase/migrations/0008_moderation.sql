-- 0008 · D4: очередь модерации фото и решения модератора, SEC-14 (модератор не читает заказы и фото клиентов напрямую).
-- Только добавление: новые столбцы, новые функции, новые ограничивающие политики. Старые функции не меняются,
-- кроме заглушки private.order_moderation_enter из 0007 (её вызывает только новый код).

alter table public.moderation_reviews add column if not exists item_id uuid references public.order_items (id) on delete cascade;
alter table public.moderation_reviews add column if not exists photo_path text;
alter table public.moderation_reviews add column if not exists photo_index int;
alter table public.moderation_reviews add column if not exists comment text check (char_length(comment) <= 500);
create index if not exists moderation_reviews_order_idx on public.moderation_reviews (order_id);

-- Вход в «Модерацию»: каждое фото снимка заказа с флагом цензуры → запись очереди (если ещё не одобрено и не ждёт).
-- Автоматика только ставит в очередь: отклоняет всегда человек.
create or replace function private.order_moderation_enter(_order uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare _n int := 0; _num text; _synthetic boolean;
begin
  begin
    insert into public.moderation_reviews (order_id, item_id, photo_id, photo_path, photo_index, auto_flag, auto_scores)
    select _order, i.id, ph.id, p ->> 'path', (t.ord - 1)::int, true, ph.nsfw
      from public.order_items i
      cross join lateral jsonb_array_elements(coalesce(i.snapshot -> 'photos', '[]'::jsonb)) with ordinality t(p, ord)
      left join public.project_photos ph on ph.id::text = p ->> 'id'
     where i.order_id = _order
       and coalesce((p ->> 'moderationFlag')::boolean, false)
       and not exists (select 1 from public.moderation_reviews r
                        where r.order_id = _order and r.photo_path = p ->> 'path' and r.decision in ('approved', 'pending'));
    get diagnostics _n = row_count;
    if _n > 0 then
      update public.orders set substatus = 'Фото проверяет модератор' where id = _order returning number, is_synthetic into _num, _synthetic;
      if not coalesce(_synthetic, false) then
        insert into public.staff_notifications (kind, audience, title, body, order_id, link, dedupe_key)
        values ('moderation_needed', 'moderator', 'Нужна проверка фото · ' || _num, 'Фото с флагом цензуры: ' || _n, _order,
                '/admin/moderation', 'modq:' || _order || ':' || extract(epoch from clock_timestamp())::bigint)
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'order_moderation_enter: %', sqlerrm;
  end;
  return _n;
end $$;

-- Решение модератора по записи очереди. approve — одобрить (если больше ничего не ждёт — заказ уходит в производство
-- через ту же функцию смены статуса). return — вернуть на замену с причиной из списка: клиент получает «Нужно заменить фото».
create or replace function public.moderation_decide(_review uuid, _decision text, _reason text, _comment text, _actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare _r public.moderation_reviews; _o public.orders; _res jsonb; _note text;
begin
  select * into _r from public.moderation_reviews where id = _review for update;
  if not found then return jsonb_build_object('result', 'rejected', 'code', 'not_found'); end if;
  select * into _o from public.orders where id = _r.order_id for update;
  if not found or _o.is_synthetic then return jsonb_build_object('result', 'rejected', 'code', 'not_found'); end if;
  if _r.decision <> 'pending' then return jsonb_build_object('result', 'rejected', 'code', 'already_decided'); end if;
  if _o.status <> 'moderation' then return jsonb_build_object('result', 'rejected', 'code', 'not_in_moderation'); end if;
  _note := left(nullif(btrim(coalesce(_comment, '')), ''), 500);
  if _decision = 'approve' then
    update public.moderation_reviews set decision = 'approved', comment = _note, moderator_id = _actor, decided_at = now() where id = _review;
    if private.order_moderation_blocked(_o.id) then
      return jsonb_build_object('result', 'applied', 'decision', 'approved', 'status', _o.status, 'waiting', true);
    end if;
    _res := public.erp_apply_event('mod:' || _o.id || ':' || _review, _o.id, 'moderation_passed', now(), 'moderator', _actor,
                                   'Модератор проверил фото — можно печатать', '{}'::jsonb);
    return jsonb_build_object('result', 'applied', 'decision', 'approved', 'status', coalesce(_res ->> 'status', _o.status), 'waiting', false);
  elsif _decision = 'return' then
    if _reason is null or _reason not in ('explicit', 'violence', 'personal_data', 'rights', 'quality', 'other') then
      return jsonb_build_object('result', 'rejected', 'code', 'reason_required');
    end if;
    update public.moderation_reviews set decision = 'rejected', reason = _reason, comment = _note, moderator_id = _actor, decided_at = now()
     where id = _review;
    update public.orders set substatus = 'Нужно заменить фото', updated_at = now() where id = _o.id;
    if _o.user_id is not null then
      insert into public.notifications (user_id, kind, title, body, order_id, link, category, dedupe_key)
      values (_o.user_id, 'photo_replace', 'Нужно заменить фото',
              'Заказ ' || _o.number || ': модератор вернул фото на замену. Откройте заказ, чтобы узнать причину.',
              _o.id, '/orders/' || _o.id, 'moderation', 'photo_replace:' || _review)
      on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
    end if;
    return jsonb_build_object('result', 'applied', 'decision', 'rejected', 'status', _o.status);
  end if;
  return jsonb_build_object('result', 'rejected', 'code', 'invalid_decision');
end $$;

revoke all on function public.moderation_decide(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.moderation_decide(uuid, text, text, text, uuid) to service_role;
revoke all on function private.order_moderation_enter(uuid) from public;

-- SEC-14: модератор не читает заказы (ФИО, телефон, адрес) и фото клиентов своим ключом. Экраны сотрудников читают
-- сервисным ключом после проверки роли и отдают модератору только маскированные данные и фото очереди.
do $$ begin
  create policy orders_moderator_no_pii on public.orders as restrictive for select to authenticated
    using (user_id = (select auth.uid()) or (select public.has_role('admin')) or not (select public.has_role('moderator')));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy project_photos_moderator_no_direct on public.project_photos as restrictive for select to authenticated
    using (user_id = (select auth.uid()) or (select public.has_role('admin')) or not (select public.has_role('moderator')));
exception when duplicate_object then null; end $$;
