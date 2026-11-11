-- 0003. Заказанный проект нельзя менять; один проект — один заказ даже при параллельных запросах.
-- Только добавление: новая функция-страж и триггер, create_order заменяется (та же сигнатура). Безопасно применять повторно.

-- Страж фото: добавить фото, сменить порядок или правки у проекта со статусом ordered нельзя.
-- FOR SHARE ждёт, пока идущий create_order (он держит FOR UPDATE на проекте) закончится, и видит новый статус.
create or replace function private.project_photos_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _status text;
begin
  select p.status into _status from public.projects p where p.id = new.project_id for share;
  if _status = 'ordered' then
    raise exception 'project_ordered' using errcode = 'P0001', detail = 'Проект уже в заказе — менять его фото нельзя';
  end if;
  return new;
end;
$$;
revoke all on function private.project_photos_guard() from public;

drop trigger if exists project_photos_guard on public.project_photos;
create trigger project_photos_guard
  before insert or update of project_id, storage_path, position, edits, width, height, mime on public.project_photos
  for each row execute function private.project_photos_guard();

-- Создание заказа одной транзакцией.
--  * тот же ключ идемпотентности → тот же заказ;
--  * проекты заказа блокируются (FOR UPDATE): параллельный заказ тех же проектов с другим ключом ждёт,
--    затем видит status = 'ordered' и получает ошибку cart_changed — второй заказ не создаётся;
--  * перед записью сверяется корзина: проект свой, не заказан, лежит в корзине с тем же количеством,
--    число фото то же, по которому сервер посчитал цену; иначе cart_changed;
--  * в снимок позиции (order_items.snapshot.photos) записывается список фото: id, путь, порядок, размеры, правки.
create or replace function public.create_order(_user uuid, _key text, _order jsonb, _items jsonb)
returns table (order_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
  _ids uuid[];
  _bad int;
begin
  select o.id into _id from public.orders o where o.user_id = _user and o.idempotency_key = _key;
  if _id is not null then
    return query select _id, false;
    return;
  end if;

  _ids := array(
    select (i ->> 'project_id')::uuid from jsonb_array_elements(_items) i where i ->> 'project_id' is not null
  );
  perform 1 from public.projects p where p.id = any (_ids) order by p.id for update;

  -- Пока ждали блокировку, заказ с этим ключом мог появиться
  select o.id into _id from public.orders o where o.user_id = _user and o.idempotency_key = _key;
  if _id is not null then
    return query select _id, false;
    return;
  end if;

  select count(*) into _bad
  from jsonb_array_elements(_items) i
  left join public.projects p on p.id = (i ->> 'project_id')::uuid and p.user_id = _user
  left join public.cart_items c on c.project_id = p.id and c.user_id = _user
  where p.id is null
     or p.status = 'ordered'
     or c.id is null
     or c.quantity <> (i ->> 'quantity')::int
     or (select count(*) from public.project_photos ph where ph.project_id = p.id)
        <> coalesce((i -> 'snapshot' ->> 'photoCount')::int, -1);
  if _bad > 0 or coalesce(array_length(_ids, 1), 0) = 0 then
    raise exception 'cart_changed' using errcode = 'P0001', detail = 'Корзина изменилась или уже оформлена';
  end if;

  insert into public.orders (
    user_id, idempotency_key, recipient, delivery_code, delivery_address,
    goods_kop, discount_kop, delivery_kop, total_kop, promo_code, payment_method,
    eta_from, eta_to, is_demo
  ) values (
    _user, _key, coalesce(_order -> 'recipient', '{}'::jsonb), _order ->> 'delivery_code', coalesce(_order -> 'delivery_address', '{}'::jsonb),
    (_order ->> 'goods_kop')::int, (_order ->> 'discount_kop')::int, (_order ->> 'delivery_kop')::int, (_order ->> 'total_kop')::int,
    _order ->> 'promo_code', _order ->> 'payment_method',
    (_order ->> 'eta_from')::timestamptz, (_order ->> 'eta_to')::timestamptz, coalesce((_order ->> 'is_demo')::boolean, false)
  )
  on conflict (user_id, idempotency_key) do nothing
  returning id into _id;

  if _id is null then
    select o.id into _id from public.orders o where o.user_id = _user and o.idempotency_key = _key;
    return query select _id, false;
    return;
  end if;

  insert into public.order_items (order_id, project_id, product_slug, title, options, quantity, unit_price_kop, line_total_kop, snapshot)
  select _id, (i ->> 'project_id')::uuid, i ->> 'product_slug', coalesce(i ->> 'title', ''), coalesce(i -> 'options', '{}'::jsonb),
         (i ->> 'quantity')::int, (i ->> 'unit_price_kop')::int, (i ->> 'line_total_kop')::int,
         coalesce(i -> 'snapshot', '{}'::jsonb) || jsonb_build_object(
           'photos',
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', ph.id, 'path', ph.storage_path, 'position', ph.position, 'mime', ph.mime,
                     'width', ph.width, 'height', ph.height, 'edits', ph.edits, 'moderationFlag', ph.moderation_flag
                   ) order by ph.position, ph.created_at), '[]'::jsonb)
            from public.project_photos ph where ph.project_id = (i ->> 'project_id')::uuid)
         )
  from jsonb_array_elements(_items) i;

  insert into public.order_status_history (order_id, status, source, reason)
  values (_id, 'accepted', 'system', 'Заказ создан');

  update public.projects p set status = 'ordered', updated_at = now()
  where p.user_id = _user and p.id = any (_ids);

  delete from public.cart_items c where c.user_id = _user and c.project_id = any (_ids);

  return query select _id, true;
end;
$$;
revoke all on function public.create_order(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_order(uuid, text, jsonb, jsonb) to service_role;
