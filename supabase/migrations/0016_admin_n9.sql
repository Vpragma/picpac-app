-- 0016 (N9, ночь 2). Админка сильнее: старая цена для плашки «скидка», роли и список пользователей
-- для администратора, индексы для быстрых фильтров журнала и списка заказов.
-- Только добавление: новые столбец, функции и индексы. Старые функции и данные не меняются,
-- код из main продолжает работать (новый столбец — null по умолчанию). Журнал не меняется.

-- ───────────── Каталог: цена «от» до скидки ─────────────
-- Карточка каталога (N1) зачёркивает старую цену, если она больше текущей «от» (lib/server/catalog.js).
alter table public.products add column if not exists old_price_kop int
  check (old_price_kop is null or (old_price_kop > 0 and old_price_kop <= 10000000));
comment on column public.products.old_price_kop is 'Цена «от» до скидки, копейки BYN (плашка «скидка», старая цена зачёркнута). null — без скидки. Меняет админ (журнал: admin.catalog_update)';

-- ───────────── Журнал: быстрые фильтры по группе действий ─────────────
-- «Входы» (auth.%), «Модерация» (moderation.%), «Админские действия» (admin.%) — поиск по началу строки
-- с сортировкой по id (страницы «Показать ещё»). Обычный btree по action начало строки в LIKE не ищет.
create index if not exists audit_log_action_prefix_idx on public.audit_log (action text_pattern_ops, id desc);

-- ───────────── Заказы: просроченные и поиск по номеру ─────────────
create index if not exists orders_eta_open_idx on public.orders (eta_to) where status not in ('shipped', 'done');
create index if not exists orders_number_prefix_idx on public.orders (number text_pattern_ops);
create index if not exists order_items_product_idx on public.order_items (product_slug, order_id);

-- ───────────── Пользователи: список для администратора ─────────────
-- Почта лежит в auth.users (её не видно через API), поэтому — функция с проверкой роли внутри.
-- Вызывается от имени вошедшего админа: auth.uid() — он сам. Не админ — ошибка 42501.
-- _q — часть почты, имени или начало id; _role — только с этой ролью; _hide_tests — без e2e-/critic-/night2-.
create or replace function public.admin_list_users(
  _q text default null,
  _role public.app_role default null,
  _hide_tests boolean default true,
  _limit int default 25,
  _offset int default 0
)
returns table (
  id uuid,
  email text,
  full_name text,
  roles public.app_role[],
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_synthetic boolean,
  is_demo boolean,
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _pat text;
begin
  if (select auth.uid()) is null or not public.has_role('admin') then
    raise exception 'Только для администратора' using errcode = '42501';
  end if;
  -- Подстановочные знаки LIKE в запросе — как обычные символы
  _pat := case
    when nullif(btrim(_q), '') is null then null
    else '%' || replace(replace(replace(lower(btrim(left(_q, 100))), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  end;
  return query
  with base as (
    select
      u.id,
      u.email::text as email,
      coalesce(p.full_name, '') as full_name,
      coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = u.id), '{}'::public.app_role[]) as roles,
      u.created_at,
      u.last_sign_in_at,
      coalesce(p.is_synthetic, false) as is_synthetic,
      coalesce(u.raw_app_meta_data ->> 'demo', '') = 'true' as is_demo
    from auth.users u
    left join public.profiles p on p.id = u.id
    where (_pat is null or lower(u.email) like _pat or lower(coalesce(p.full_name, '')) like _pat or u.id::text like _pat)
      and (not _hide_tests or coalesce(u.email, '') !~* '^(e2e|critic|night2)-')
  )
  select b.id, b.email, b.full_name, b.roles, b.created_at, b.last_sign_in_at, b.is_synthetic, b.is_demo, count(*) over () as total
  from base b
  where _role is null or _role = any (b.roles)
  order by (b.roles && array['admin', 'moderator']::public.app_role[]) desc, b.is_synthetic, b.created_at desc, b.id
  limit least(greatest(coalesce(_limit, 25), 1), 100)
  offset greatest(coalesce(_offset, 0), 0);
end;
$$;
revoke all on function public.admin_list_users(text, public.app_role, boolean, int, int) from public, anon;
grant execute on function public.admin_list_users(text, public.app_role, boolean, int, int) to authenticated;

-- ───────────── Пользователи: выдать или снять роль ─────────────
-- Только админ; свои роли — нельзя; роль «клиент» не трогаем; демо-аккаунты и синтетический набор жюри — нельзя;
-- последнего администратора снять нельзя (под блокировкой: два админа не снимут друг друга одновременно).
-- Ответ — код: granted | revoked | unchanged | forbidden | self | client_role | not_found | demo_account | synthetic | last_admin
create or replace function public.admin_set_role(_user uuid, _role public.app_role, _grant boolean)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  _me uuid := (select auth.uid());
  _admins int;
  _n int;
begin
  if _me is null or not public.has_role('admin') then
    return 'forbidden';
  end if;
  if _user = _me then
    return 'self';
  end if;
  if _role = 'client' then
    return 'client_role';
  end if;
  if not exists (select 1 from auth.users u where u.id = _user) then
    return 'not_found';
  end if;
  if exists (select 1 from auth.users u where u.id = _user and coalesce(u.raw_app_meta_data ->> 'demo', '') = 'true') then
    return 'demo_account';
  end if;
  if exists (select 1 from public.profiles p where p.id = _user and p.is_synthetic) then
    return 'synthetic';
  end if;
  -- Все смены ролей сотрудников — по очереди
  perform pg_advisory_xact_lock(hashtext('picpac:admin_set_role'));
  if _grant then
    insert into public.user_roles (user_id, role) values (_user, _role) on conflict (user_id, role) do nothing;
    get diagnostics _n = row_count;
    return case when _n > 0 then 'granted' else 'unchanged' end;
  end if;
  if _role = 'admin' and exists (select 1 from public.user_roles r where r.user_id = _user and r.role = 'admin') then
    select count(*) into _admins from public.user_roles r where r.role = 'admin';
    if _admins <= 1 then
      return 'last_admin';
    end if;
  end if;
  delete from public.user_roles r where r.user_id = _user and r.role = _role;
  get diagnostics _n = row_count;
  return case when _n > 0 then 'revoked' else 'unchanged' end;
end;
$$;
revoke all on function public.admin_set_role(uuid, public.app_role, boolean) from public, anon;
grant execute on function public.admin_set_role(uuid, public.app_role, boolean) to authenticated;
