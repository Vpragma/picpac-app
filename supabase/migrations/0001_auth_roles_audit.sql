-- 0001. Аккаунты, роли и журнал действий (требования ТЗ ОТ-02 и ОТ-04).
-- Файл безопасно применять повторно: всё создаётся через "if not exists" или "or replace".

-- Служебная схема: её не видно через API Supabase
create schema if not exists private;
revoke all on schema private from public;

-- Роли приложения
do $$
begin
  create type public.app_role as enum ('client', 'moderator', 'admin');
exception
  when duplicate_object then null;
end
$$;

-- Профиль: одна строка на аккаунт, удаляется вместе с аккаунтом
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 100),
  created_at timestamptz not null default now()
);
comment on table public.profiles is 'Профиль пользователя PicPac';

-- Роли: у аккаунта может быть несколько ролей, пара (пользователь, роль) уникальна
create table if not exists public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
comment on table public.user_roles is 'Роли пользователей: client, moderator, admin';

-- Журнал действий: строки только добавляются.
-- У user_id нет внешнего ключа намеренно: записи остаются и после удаления аккаунта.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  role public.app_role,
  action text not null check (char_length(action) <= 64),
  object_type text check (char_length(object_type) <= 64),
  object_id text check (char_length(object_id) <= 200),
  result text not null check (result in ('success', 'denied', 'error')),
  details jsonb not null default '{}'::jsonb,
  ip inet
);
comment on table public.audit_log is 'Журнал действий: кто, когда, что, над чем, результат. Менять и удалять нельзя';
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_action_at_idx on public.audit_log (action, at desc);

-- Есть ли у текущего пользователя роль. Используется в правилах доступа (RLS).
create or replace function public.has_role(_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = _role
  );
$$;
revoke all on function public.has_role(public.app_role) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated, service_role;

-- Новый пользователь: создаём профиль и даём роль client
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 100))
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'client')
  on conflict (user_id, role) do nothing;

  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Пользователи, созданные до этой миграции, тоже получают профиль и роль client
insert into public.profiles (id, full_name)
select u.id, left(coalesce(u.raw_user_meta_data ->> 'full_name', ''), 100)
from auth.users u
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select u.id, 'client'
from auth.users u
where not exists (select 1 from public.user_roles r where r.user_id = u.id)
on conflict (user_id, role) do nothing;

-- Журнал нельзя менять и удалять никому, даже серверу с секретным ключом
create or replace function private.audit_log_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Журнал действий нельзя изменять или удалять (%)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change
  before update or delete on public.audit_log
  for each row execute function private.audit_log_append_only();

drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.audit_log_append_only();

-- Правила доступа на уровне строк (RLS)
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_log enable row level security;

-- Пользователь видит свой профиль, админ — все
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.has_role('admin')));

-- Пользователь видит свои роли, админ — все
drop policy if exists user_roles_select_own_or_admin on public.user_roles;
create policy user_roles_select_own_or_admin on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));

-- Журнал читает только админ
drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using ((select public.has_role('admin')));

-- Права на таблицы. Гости (anon) не видят ничего.
-- Вошедшие пользователи только читают — какие строки, решают правила выше.
-- Писать профили и роли может только сервер (service_role); политик на запись нет.
revoke all on public.profiles, public.user_roles, public.audit_log from anon, authenticated;
grant select on public.profiles, public.user_roles, public.audit_log to authenticated;
grant select, insert, update, delete on public.profiles, public.user_roles to service_role;
-- Журнал: сервер только читает и добавляет
revoke all on public.audit_log from service_role;
grant select, insert on public.audit_log to service_role;
