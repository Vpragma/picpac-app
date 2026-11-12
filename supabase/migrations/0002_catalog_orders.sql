-- 0002. Каталог, проекты, корзина, заказы, статусы, обращения, уведомления, аналитика, модерация.
-- Сущности ТЗ 4.2: product, customer, project, order, order_status, interaction.
-- Только добавление: новые таблицы, индексы, функции, политики. Безопасно применять повторно.
--
-- Правила хранения:
--   * все даты и время — timestamptz (UTC в базе, показываем по Минску, Europe/Minsk);
--   * деньги — целые копейки (*_kop) плюс валюта (сейчас только BYN).
--
-- Формулы (те же в lib/pricing.js и README, раздел «Формулы»):
--   k_размера          = 1 + 0,6 × (ширина × высота / 400 − 1)          (20×20 → 1; тестовые коэффициенты)
--   цена книги, коп.   = округл_до_10( (база + надбавка_за_2_стр × (страниц − мин) / 2) × k_размера )
--   цена фото, коп.    = цена_за_штуку_размера × число_фото
--   строка заказа      = цена_за_единицу × количество
--   товары             = сумма строк
--   скидка             = percent: округл(товары × % / 100); amount: min(значение, товары); free_delivery: 0
--                        (промокод действует, только если товары ≥ min_total_kop и сейчас между valid_from и valid_to)
--   доставка           = 0, если промокод free_delivery или (товары − скидка) ≥ free_from_kop способа; иначе цена способа
--   итого              = товары − скидка + доставка
--   срок               = сегодня по Минску + max(срок печати позиций) + (min_days … max_days способа доставки)

create extension if not exists pgcrypto;

-- ───────────── Каталог ─────────────

create table if not exists public.products (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (char_length(name) <= 80),
  kind text not null check (kind in ('book', 'print')),
  tagline text not null default '',
  description text not null default '',
  badge text,
  print_days int not null check (print_days between 0 and 60),
  min_pages int,
  max_pages int,
  page_step int,
  min_photos int not null default 1,
  max_photos int not null default 500,
  base_price_kop int check (base_price_kop >= 0),
  per2_pages_kop int check (per2_pages_kop >= 0),
  currency text not null default 'BYN' check (currency = 'BYN'),
  photo_requirements jsonb not null default '{}'::jsonb,
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table public.products is 'Продукты: фотокниги (kind=book) и печать фото (kind=print). Цены в копейках BYN';

create table if not exists public.product_sizes (
  product_slug text not null references public.products (slug) on delete cascade,
  code text not null check (code ~ '^[0-9]{1,3}x[0-9]{1,3}$'),
  label text not null,
  width_cm numeric(5, 1) not null check (width_cm > 0),
  height_cm numeric(5, 1) not null check (height_cm > 0),
  -- Коэффициент цены книги от площади (тестовый): 1 + 0,6 × (площадь/400 − 1)
  price_k numeric(6, 3) not null default 1 check (price_k > 0),
  -- Цена одного отпечатка (только для печати фото)
  unit_price_kop int check (unit_price_kop >= 0),
  sort int not null default 0,
  active boolean not null default true,
  primary key (product_slug, code)
);
comment on table public.product_sizes is 'Размеры продукта. price_k — тестовый коэффициент, уточнить у Фотопринт';

create table if not exists public.product_options (
  product_slug text not null references public.products (slug) on delete cascade,
  option_group text not null check (option_group in ('cover', 'lamination', 'paper', 'print', 'surface')),
  code text not null check (code ~ '^[a-z0-9-]{1,30}$'),
  label text not null,
  note text not null default '',
  price_delta_kop int not null default 0,
  is_default boolean not null default false,
  sort int not null default 0,
  primary key (product_slug, option_group, code)
);
comment on table public.product_options is 'Опции продукта: обложка, ламинация, бумага, печать, поверхность';

create table if not exists public.delivery_methods (
  code text primary key check (code ~ '^[a-z0-9-]{2,30}$'),
  name text not null,
  note text not null default '',
  price_kop int not null check (price_kop >= 0),
  free_from_kop int check (free_from_kop >= 0),
  eta_text text not null default '',
  min_days int not null default 1 check (min_days >= 0),
  max_days int not null default 2 check (max_days >= min_days),
  address_fields text[] not null default '{}',
  sort int not null default 0,
  active boolean not null default true
);
comment on table public.delivery_methods is 'Способы доставки (тестовые цены с picpac.by)';

create table if not exists public.promo_codes (
  code text primary key check (code ~ '^[A-Z0-9]{3,20}$'),
  kind text not null check (kind in ('percent', 'amount', 'free_delivery')),
  value int not null default 0 check (value >= 0),
  min_total_kop int not null default 0 check (min_total_kop >= 0),
  valid_from timestamptz,
  valid_to timestamptz,
  label text not null default '',
  active boolean not null default true,
  is_synthetic boolean not null default true
);
comment on table public.promo_codes is 'Тестовые промокоды: percent — %, amount — копейки, free_delivery — бесплатная доставка';

-- ───────────── Клиент ─────────────

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null default '' check (char_length(label) <= 40),
  recipient_name text not null default '' check (char_length(recipient_name) <= 100),
  phone text not null default '' check (char_length(phone) <= 30),
  city text not null default '' check (char_length(city) <= 80),
  street text not null default '' check (char_length(street) <= 120),
  house text not null default '' check (char_length(house) <= 20),
  flat text not null default '' check (char_length(flat) <= 20),
  postcode text not null default '' check (char_length(postcode) <= 10),
  pickup_point text not null default '' check (char_length(pickup_point) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists addresses_user_idx on public.addresses (user_id);

-- ───────────── Проекты и фото ─────────────

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_slug text not null references public.products (slug),
  title text not null default '' check (char_length(title) <= 100),
  options jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'in_cart', 'ordered')),
  -- Защита от затирания: PATCH присылает version, сервер меняет строку только при совпадении
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);
comment on table public.projects is 'Проект клиента: продукт, опции, фото. version — защита от затирания с другого устройства';

create table if not exists public.project_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  mime text not null check (mime in ('image/jpeg', 'image/png')),
  bytes int not null check (bytes > 0 and bytes <= 26214400),
  width int not null check (width > 0),
  height int not null check (height > 0),
  position int not null default 0,
  edits jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  nsfw jsonb,
  moderation_flag boolean not null default false,
  print_path text,
  created_at timestamptz not null default now()
);
create index if not exists project_photos_project_idx on public.project_photos (project_id, position);
create index if not exists project_photos_user_idx on public.project_photos (user_id);

-- ───────────── Корзина ─────────────

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  quantity int not null default 1 check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id)
);

-- ───────────── Заказы ─────────────

-- Номер заказа PP-ГГММДД-NNNNN: дата по Минску + порядковый номер (не случайный, без коллизий)
create sequence if not exists public.order_number_seq start with 10001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default (
    'PP-' || to_char(now() at time zone 'Europe/Minsk', 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 5, '0')
  ),
  -- После удаления аккаунта заказ остаётся для отчётности, но без владельца и личных данных
  user_id uuid references auth.users (id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  recipient jsonb not null default '{}'::jsonb,
  delivery_code text not null references public.delivery_methods (code),
  delivery_address jsonb not null default '{}'::jsonb,
  currency text not null default 'BYN' check (currency = 'BYN'),
  goods_kop int not null check (goods_kop >= 0),
  discount_kop int not null default 0 check (discount_kop >= 0),
  delivery_kop int not null default 0 check (delivery_kop >= 0),
  total_kop int not null check (total_kop >= 0),
  promo_code text,
  payment_method text check (payment_method in ('card_test', 'erip_test')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid_test')),
  paid_at timestamptz,
  status text not null default 'accepted' check (status in ('accepted', 'moderation', 'production', 'shipped', 'done')),
  substatus text,
  status_changed_at timestamptz not null default now(),
  eta_from timestamptz,
  eta_to timestamptz,
  is_demo boolean not null default false,
  is_synthetic boolean not null default false,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Идемпотентность: один ключ — один заказ у пользователя
create unique index if not exists orders_user_idem_key on public.orders (user_id, idempotency_key);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status, status_changed_at);
comment on table public.orders is 'Заказы. Суммы в копейках BYN, пересчитаны сервером. Статусы: accepted, moderation, production, shipped, done';

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  product_slug text not null,
  title text not null default '',
  options jsonb not null default '{}'::jsonb,
  quantity int not null check (quantity between 1 and 99),
  unit_price_kop int not null check (unit_price_kop >= 0),
  line_total_kop int not null check (line_total_kop >= 0),
  -- Снимок проекта и цен на момент заказа: число фото, страниц, размер, формула
  snapshot jsonb not null default '{}'::jsonb
);
create index if not exists order_items_order_idx on public.order_items (order_id);

create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null check (status in ('accepted', 'moderation', 'production', 'shipped', 'done')),
  substatus text,
  at timestamptz not null default now(),
  source text not null check (source in ('erp', 'admin', 'system')),
  reason text,
  actor_id uuid
);
create index if not exists order_status_history_order_idx on public.order_status_history (order_id, at);

-- ───────────── Обращения ─────────────

create table if not exists public.interactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  topic text not null check (char_length(topic) between 1 and 120),
  kind text not null default 'support' check (kind in ('support', 'reprint')),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  sla_due timestamptz,
  assignee_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists interactions_order_idx on public.interactions (order_id);
create index if not exists interactions_user_idx on public.interactions (user_id, created_at desc);

create table if not exists public.interaction_messages (
  id bigint generated always as identity primary key,
  interaction_id uuid not null references public.interactions (id) on delete cascade,
  author_kind text not null check (author_kind in ('client', 'bot', 'operator')),
  author_id uuid,
  body text not null check (char_length(body) between 1 and 2000),
  attachment_path text,
  created_at timestamptz not null default now()
);
create index if not exists interaction_messages_idx on public.interaction_messages (interaction_id, created_at);

-- ───────────── Уведомления ─────────────

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  order_id uuid references public.orders (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  push_enabled boolean not null default false,
  order_updates boolean not null default true,
  reminders boolean not null default true,
  quiet_from time not null default '22:00',
  quiet_to time not null default '09:00',
  timezone text not null default 'Europe/Minsk',
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) <= 1000),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ───────────── Аналитика и модерация ─────────────

create table if not exists public.analytics_events (
  id bigint generated always as identity primary key,
  type text not null check (char_length(type) <= 40),
  session_id text check (char_length(session_id) <= 64),
  user_hash text check (char_length(user_hash) <= 64),
  step text check (char_length(step) <= 40),
  duration_ms int,
  props jsonb not null default '{}'::jsonb,
  is_synthetic boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists analytics_events_type_at_idx on public.analytics_events (type, at desc);
comment on table public.analytics_events is 'Обезличенные события воронки: без почты и имени, пользователь — только хеш с солью';

create table if not exists public.moderation_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete cascade,
  photo_id uuid references public.project_photos (id) on delete set null,
  auto_flag boolean not null default false,
  auto_scores jsonb,
  decision text not null default 'pending' check (decision in ('pending', 'approved', 'rejected')),
  reason text,
  moderator_id uuid,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists moderation_reviews_pending_idx on public.moderation_reviews (decision, created_at);

-- Запросы на удаление данных, которые нельзя удалить сразу (например, фото заказа в производстве)
create table if not exists public.data_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('delete_photos', 'delete_account')),
  status text not null default 'pending' check (status in ('pending', 'done')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

-- ───────────── Служебное ─────────────

create table if not exists private.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);

-- Лимит частоты: true — запрос разрешён, false — превышен лимит _limit за окно _window_seconds
create or replace function public.rate_limit_hit(_key text, _limit int, _window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _start timestamptz := to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);
  _hits int;
begin
  insert into private.rate_limits (key, window_start, hits)
  values (left(_key, 200), _start, 1)
  on conflict (key, window_start) do update set hits = private.rate_limits.hits + 1
  returning hits into _hits;
  -- Иногда чистим старые окна
  if random() < 0.02 then
    delete from private.rate_limits where window_start < now() - interval '1 day';
  end if;
  return _hits <= _limit;
end;
$$;
revoke all on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int, int) to service_role;

-- Создание заказа одной транзакцией. Повтор с тем же ключом возвращает существующий заказ.
create or replace function public.create_order(_user uuid, _key text, _order jsonb, _items jsonb)
returns table (order_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  select o.id into _id from public.orders o where o.user_id = _user and o.idempotency_key = _key;
  if _id is not null then
    return query select _id, false;
    return;
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
    -- Параллельный запрос с тем же ключом успел раньше
    select o.id into _id from public.orders o where o.user_id = _user and o.idempotency_key = _key;
    return query select _id, false;
    return;
  end if;

  insert into public.order_items (order_id, project_id, product_slug, title, options, quantity, unit_price_kop, line_total_kop, snapshot)
  select _id, (i ->> 'project_id')::uuid, i ->> 'product_slug', coalesce(i ->> 'title', ''), coalesce(i -> 'options', '{}'::jsonb),
         (i ->> 'quantity')::int, (i ->> 'unit_price_kop')::int, (i ->> 'line_total_kop')::int, coalesce(i -> 'snapshot', '{}'::jsonb)
  from jsonb_array_elements(_items) i;

  insert into public.order_status_history (order_id, status, source, reason)
  values (_id, 'accepted', 'system', 'Заказ создан');

  update public.projects p set status = 'ordered', updated_at = now()
  where p.user_id = _user
    and p.id in (select (i ->> 'project_id')::uuid from jsonb_array_elements(_items) i where i ->> 'project_id' is not null);

  delete from public.cart_items c where c.user_id = _user;

  return query select _id, true;
end;
$$;
revoke all on function public.create_order(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_order(uuid, text, jsonb, jsonb) to service_role;

-- Порядок фото в проекте одним запросом
create or replace function public.reorder_photos(_project uuid, _ids uuid[])
returns int
language sql
security definer
set search_path = ''
as $$
  with x as (
    select id, ord from unnest(_ids) with ordinality as t(id, ord)
  ), u as (
    update public.project_photos p set position = x.ord - 1
    from x where p.id = x.id and p.project_id = _project
    returning 1
  )
  select count(*)::int from u;
$$;
revoke all on function public.reorder_photos(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_photos(uuid, uuid[]) to service_role;

-- ───────────── Хранилище фото ─────────────

-- Приватный бакет: только JPEG и PNG до 25 МБ. Доступ — только по подписанным ссылкам сервера.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 26214400, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false, file_size_limit = 26214400, allowed_mime_types = array['image/jpeg', 'image/png'];

-- ───────────── Правила доступа (RLS) ─────────────

alter table public.products enable row level security;
alter table public.product_sizes enable row level security;
alter table public.product_options enable row level security;
alter table public.delivery_methods enable row level security;
alter table public.promo_codes enable row level security;
alter table public.addresses enable row level security;
alter table public.projects enable row level security;
alter table public.project_photos enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.interactions enable row level security;
alter table public.interaction_messages enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.analytics_events enable row level security;
alter table public.moderation_reviews enable row level security;
alter table public.data_requests enable row level security;

-- Каталог и промокоды напрямую видит только админ (клиентам и гостям каталог отдаёт API)
drop policy if exists products_admin on public.products;
create policy products_admin on public.products for select to authenticated using ((select public.has_role('admin')));
drop policy if exists product_sizes_admin on public.product_sizes;
create policy product_sizes_admin on public.product_sizes for select to authenticated using ((select public.has_role('admin')));
drop policy if exists product_options_admin on public.product_options;
create policy product_options_admin on public.product_options for select to authenticated using ((select public.has_role('admin')));
drop policy if exists delivery_methods_admin on public.delivery_methods;
create policy delivery_methods_admin on public.delivery_methods for select to authenticated using ((select public.has_role('admin')));
drop policy if exists promo_codes_admin on public.promo_codes;
create policy promo_codes_admin on public.promo_codes for select to authenticated using ((select public.has_role('admin')));

-- Своё видит владелец, всё — админ
drop policy if exists addresses_own on public.addresses;
create policy addresses_own on public.addresses for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));
drop policy if exists projects_own on public.projects;
create policy projects_own on public.projects for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));
drop policy if exists cart_items_own on public.cart_items;
create policy cart_items_own on public.cart_items for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));
drop policy if exists notification_settings_own on public.notification_settings;
create policy notification_settings_own on public.notification_settings for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));
drop policy if exists data_requests_own on public.data_requests;
create policy data_requests_own on public.data_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));

-- Фото: владелец, админ; модератор — только фото с флагом цензуры
drop policy if exists project_photos_own on public.project_photos;
create policy project_photos_own on public.project_photos for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_role('admin'))
    or (moderation_flag and (select public.has_role('moderator')))
  );

-- Заказы: владелец, админ; модератор — заказы на модерации
drop policy if exists orders_own on public.orders;
create policy orders_own on public.orders for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_role('admin'))
    or (status = 'moderation' and (select public.has_role('moderator')))
  );
drop policy if exists order_items_own on public.order_items;
create policy order_items_own on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));
drop policy if exists order_status_history_own on public.order_status_history;
create policy order_status_history_own on public.order_status_history for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id));

-- Обращения: автор, админ (оператор)
drop policy if exists interactions_own on public.interactions;
create policy interactions_own on public.interactions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));
drop policy if exists interaction_messages_own on public.interaction_messages;
create policy interaction_messages_own on public.interaction_messages for select to authenticated
  using (exists (select 1 from public.interactions i where i.id = interaction_id));

-- Аналитика — админ; модерация — модератор и админ
drop policy if exists analytics_events_admin on public.analytics_events;
create policy analytics_events_admin on public.analytics_events for select to authenticated
  using ((select public.has_role('admin')));
drop policy if exists moderation_reviews_staff on public.moderation_reviews;
create policy moderation_reviews_staff on public.moderation_reviews for select to authenticated
  using ((select public.has_role('moderator')) or (select public.has_role('admin')));

-- Права на таблицы. Гости (anon) не видят ничего. Вошедшие только читают (какие строки — решают правила выше).
-- Пишет только сервер (service_role) после своих проверок.
revoke all on
  public.products, public.product_sizes, public.product_options, public.delivery_methods, public.promo_codes,
  public.addresses, public.projects, public.project_photos, public.cart_items,
  public.orders, public.order_items, public.order_status_history,
  public.interactions, public.interaction_messages,
  public.notifications, public.notification_settings, public.push_subscriptions,
  public.analytics_events, public.moderation_reviews, public.data_requests
from anon, authenticated;
grant select on
  public.products, public.product_sizes, public.product_options, public.delivery_methods, public.promo_codes,
  public.addresses, public.projects, public.project_photos, public.cart_items,
  public.orders, public.order_items, public.order_status_history,
  public.interactions, public.interaction_messages,
  public.notifications, public.notification_settings, public.push_subscriptions,
  public.analytics_events, public.moderation_reviews, public.data_requests
to authenticated;
grant select, insert, update, delete on
  public.products, public.product_sizes, public.product_options, public.delivery_methods, public.promo_codes,
  public.addresses, public.projects, public.project_photos, public.cart_items,
  public.orders, public.order_items, public.order_status_history,
  public.interactions, public.interaction_messages,
  public.notifications, public.notification_settings, public.push_subscriptions,
  public.analytics_events, public.moderation_reviews, public.data_requests
to service_role;
revoke all on sequence public.order_number_seq from anon, authenticated;
grant usage, select on sequence public.order_number_seq to service_role;
grant usage, select on all sequences in schema public to service_role;
