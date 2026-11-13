-- 0015_promo_cards.sql — N8: промокоды под управлением админки, учёт применений, личные коды-открытки.
-- Только добавление и обратная совместимость с кодом main:
--  * новые столбцы promo_codes — с умолчаниями (старый findPromo читает select * и лишнего не замечает);
--  * новая таблица promo_redemptions — RLS включён, гостям и клиентам закрыто, пишет только сервер;
--  * новые функции create_order_promo и issue_order_card; public.create_order не меняется (main вызывает её как раньше).
-- Безопасно применять повторно.

-- 1) Условия промокода
alter table public.promo_codes add column if not exists product_slugs text[] not null default '{}';
alter table public.promo_codes add column if not exists season text check (season in ('autumn', 'blackfriday', 'newyear'));
alter table public.promo_codes add column if not exists max_uses int check (max_uses > 0);
alter table public.promo_codes add column if not exists max_uses_per_user int check (max_uses_per_user > 0);
-- Личный код (открытка к заказу): только для этого клиента, выдан к заказу source_order_id
alter table public.promo_codes add column if not exists owner_user_id uuid references auth.users (id) on delete cascade;
alter table public.promo_codes add column if not exists source_order_id uuid references public.orders (id) on delete cascade;
alter table public.promo_codes add column if not exists created_at timestamptz not null default now();
alter table public.promo_codes add column if not exists updated_at timestamptz not null default now();
create unique index if not exists promo_codes_source_order_key on public.promo_codes (source_order_id) where source_order_id is not null;
create index if not exists promo_codes_owner_idx on public.promo_codes (owner_user_id) where owner_user_id is not null;
create index if not exists promo_codes_season_idx on public.promo_codes (season) where season is not null;
comment on column public.promo_codes.product_slugs is 'N8: к каким продуктам относится код; пусто — ко всем';
comment on column public.promo_codes.season is 'N8: сезон кода (autumn | blackfriday | newyear) или null';
comment on column public.promo_codes.max_uses is 'N8: лимит применений всего; null — без лимита';
comment on column public.promo_codes.max_uses_per_user is 'N8: лимит применений на клиента; null — без лимита';
comment on column public.promo_codes.owner_user_id is 'N8: личный код клиента (открытка); null — общий код';

-- Клиент видит свои личные коды (открытки) — для «Мои заказы». Общие коды по-прежнему видит только админ.
drop policy if exists promo_codes_own on public.promo_codes;
create policy promo_codes_own on public.promo_codes for select to authenticated
  using (owner_user_id is not null and owner_user_id = (select auth.uid()));

-- 2) Учёт применений: одна строка на заказ с кодом
create table if not exists public.promo_redemptions (
  id bigint generated always as identity primary key,
  code text not null references public.promo_codes (code) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  goods_kop int not null default 0 check (goods_kop >= 0),
  discount_kop int not null default 0 check (discount_kop >= 0),
  total_kop int not null default 0 check (total_kop >= 0),
  created_at timestamptz not null default now(),
  constraint promo_redemptions_order_key unique (order_id)
);
create index if not exists promo_redemptions_code_idx on public.promo_redemptions (code, user_id);
comment on table public.promo_redemptions is 'N8: применения промокодов (сколько раз, на какую сумму заказов). Пишет только сервер в create_order_promo';
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_redemptions from anon, authenticated;
grant select, insert, update, delete on public.promo_redemptions to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Прошлые заказы с кодом — в учёт (чтобы статистика не начиналась с нуля)
insert into public.promo_redemptions (code, order_id, user_id, goods_kop, discount_kop, total_kop, created_at)
select o.promo_code, o.id, o.user_id, o.goods_kop, o.discount_kop, o.total_kop, o.created_at
from public.orders o
join public.promo_codes p on p.code = o.promo_code
where o.promo_code is not null
on conflict on constraint promo_redemptions_order_key do nothing;

-- 3) Личный код-открытка к заказу. Повторный вызов для того же заказа возвращает тот же код (второй не создаётся).
--    _card: { code, kind, value, min_total_kop, valid_to, label } — условия решает сервер. Чужой заказ — null.
create or replace function public.issue_order_card(_user uuid, _order uuid, _card jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _code text;
begin
  select p.code into _code from public.promo_codes p where p.source_order_id = _order;
  if _code is not null or _card is null then
    return _code;
  end if;
  perform 1 from public.orders o where o.id = _order and o.user_id = _user;
  if not found then
    return null;
  end if;
  insert into public.promo_codes (
    code, kind, value, min_total_kop, valid_from, valid_to, label, active, is_synthetic,
    max_uses, max_uses_per_user, owner_user_id, source_order_id
  ) values (
    upper(_card ->> 'code'), _card ->> 'kind', coalesce((_card ->> 'value')::int, 0), coalesce((_card ->> 'min_total_kop')::int, 0),
    now(), (_card ->> 'valid_to')::timestamptz, coalesce(_card ->> 'label', ''), true, false,
    1, 1, _user, _order
  )
  on conflict do nothing
  returning code into _code;
  if _code is null then
    -- Параллельный вызов успел выдать открытку этому заказу (или код совпал — тогда null, сервер повторит с другим)
    select p.code into _code from public.promo_codes p where p.source_order_id = _order;
  end if;
  return _code;
end;
$$;
revoke all on function public.issue_order_card(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.issue_order_card(uuid, uuid, jsonb) to service_role;

-- 4) Заказ с промокодом — одной транзакцией.
--  * тот же ключ идемпотентности → тот же заказ, лимит кода второй раз не тратится;
--  * строка кода блокируется (FOR UPDATE): параллельные заказы с одним кодом идут по очереди,
--    второй видит применение первого — лимит не превышается;
--  * второй линией проверяются: выключен, срок, чужой личный код, лимиты всего и на клиента
--    (товары, минимальная сумма и сезон уже проверил сервер по корзине — lib/promo.js);
--  * сам заказ создаёт прежняя public.create_order (сверка корзины, блокировка проектов);
--  * применение записывается в promo_redemptions, к новому заказу выдаётся открытка (_card).
create or replace function public.create_order_promo(_user uuid, _key text, _order jsonb, _items jsonb, _card jsonb default null)
returns table (order_id uuid, created boolean, card_code text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  _id uuid;
  _code text := nullif(upper(coalesce(_order ->> 'promo_code', '')), '');
  _p record;
  _n int;
  _res record;
begin
  select o.id into _id from public.orders o where o.user_id = _user and o.idempotency_key = _key;
  if _id is not null then
    return query select _id, false, (select p.code from public.promo_codes p where p.source_order_id = _id);
    return;
  end if;

  if _code is not null then
    select p.* into _p from public.promo_codes p where p.code = _code for update;
    if not found then
      raise exception 'promo_not_found' using errcode = 'P0001';
    end if;
    -- Пока ждали блокировку, заказ с этим ключом мог появиться
    select o.id into _id from public.orders o where o.user_id = _user and o.idempotency_key = _key;
    if _id is not null then
      return query select _id, false, (select p.code from public.promo_codes p where p.source_order_id = _id);
      return;
    end if;
    if not _p.active then
      raise exception 'promo_disabled' using errcode = 'P0001';
    end if;
    if _p.valid_from is not null and now() < _p.valid_from then
      raise exception 'promo_not_started' using errcode = 'P0001';
    end if;
    if _p.valid_to is not null and now() > _p.valid_to then
      raise exception 'promo_expired' using errcode = 'P0001';
    end if;
    if _p.owner_user_id is not null and _p.owner_user_id is distinct from _user then
      raise exception 'promo_not_yours' using errcode = 'P0001';
    end if;
    if _p.max_uses is not null then
      select count(*) into _n from public.promo_redemptions r where r.code = _code;
      if _n >= _p.max_uses then
        if _p.owner_user_id is not null then
          raise exception 'promo_used' using errcode = 'P0001';
        end if;
        raise exception 'promo_limit' using errcode = 'P0001';
      end if;
    end if;
    if _p.max_uses_per_user is not null then
      select count(*) into _n from public.promo_redemptions r where r.code = _code and r.user_id = _user;
      if _n >= _p.max_uses_per_user then
        raise exception 'promo_limit_user' using errcode = 'P0001';
      end if;
    end if;
  end if;

  select * into _res from public.create_order(_user, _key, _order, _items);

  if _res.created and _code is not null then
    insert into public.promo_redemptions (code, order_id, user_id, goods_kop, discount_kop, total_kop)
    values (
      _code, _res.order_id, _user,
      coalesce((_order ->> 'goods_kop')::int, 0), coalesce((_order ->> 'discount_kop')::int, 0), coalesce((_order ->> 'total_kop')::int, 0)
    )
    on conflict on constraint promo_redemptions_order_key do nothing;
  end if;

  return query select _res.order_id, _res.created,
    public.issue_order_card(_user, _res.order_id, case when _res.created then _card else null end);
end;
$$;
revoke all on function public.create_order_promo(uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_order_promo(uuid, text, jsonb, jsonb, jsonb) to service_role;

-- 5) Статистика для админки: сколько раз применён код, сколькими клиентами, на какую сумму заказов
create or replace function public.promo_stats()
returns table (code text, uses int, users int, goods_kop bigint, discount_kop bigint, total_kop bigint, last_used_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.code, count(*)::int, count(distinct r.user_id)::int,
         coalesce(sum(r.goods_kop), 0)::bigint, coalesce(sum(r.discount_kop), 0)::bigint, coalesce(sum(r.total_kop), 0)::bigint,
         max(r.created_at)
  from public.promo_redemptions r
  group by r.code
$$;
revoke all on function public.promo_stats() from public, anon, authenticated;
grant execute on function public.promo_stats() to service_role;

notify pgrst, 'reload schema';
