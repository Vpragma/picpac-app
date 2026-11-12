-- 0010_push_cart_reminders.sql — D5 (S09): пуш-подписки, отправка пушей по уведомлениям, одно напоминание о забытой корзине.
-- Только добавление: новые столбцы (с умолчаниями или null), новая таблица, новые функции и настройки.

-- 1) Подписки: привязка к сессии входа и короткая метка устройства вместо полного User-Agent (SEC-18, SEC-19).
--    Старый столбец user_agent не удаляем, просто больше не заполняем.
alter table public.push_subscriptions add column if not exists session_id uuid;
alter table public.push_subscriptions add column if not exists device text check (char_length(device) <= 60);
alter table public.push_subscriptions add column if not exists last_ok_at timestamptz;
create index if not exists push_subscriptions_session_idx on public.push_subscriptions (session_id);

-- 2) Уведомления: ссылка на экран (то же определение, что у этапа D3 — кто применится первым, тот и создаст)
--    и отметка «пуш отправлен» — по ней сервер шлёт пуш ровно один раз.
alter table public.notifications add column if not exists link text check (link ~ '^/[A-Za-z0-9]' and char_length(link) <= 200);
alter table public.notifications add column if not exists pushed_at timestamptz;
create index if not exists notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

-- 3) Одно напоминание на корзину: ключ — хеш состава корзины (отсортированные id проектов)
create table if not exists public.cart_reminders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  cart_key text not null check (char_length(cart_key) <= 64),
  pushed int not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, cart_key)
);
comment on table public.cart_reminders is 'D5: какие корзины уже получили напоминание (одно на состав корзины)';
alter table public.cart_reminders enable row level security;
revoke all on public.cart_reminders from anon, authenticated;
grant select, insert, update, delete on public.cart_reminders to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 4) Настройки (не секреты). Через API схема private не видна — читать и менять только функциями ниже.
insert into private.app_settings (key, value) values
  ('cart_reminder_after_minutes', '1440'::jsonb),
  ('app_url', '"https://picpac-app-jade.vercel.app"'::jsonb)
on conflict (key) do nothing;

create or replace function public.app_setting(_key text)
returns jsonb language sql stable security definer set search_path = ''
as $$ select s.value from private.app_settings s where s.key = _key $$;
revoke all on function public.app_setting(text) from public, anon, authenticated;
grant execute on function public.app_setting(text) to service_role;

create or replace function public.set_app_setting(_key text, _value jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if _key not in ('cart_reminder_after_minutes') then
    raise exception 'setting_not_allowed' using errcode = 'P0001';
  end if;
  insert into private.app_settings (key, value, updated_at) values (_key, _value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end;
$$;
revoke all on function public.set_app_setting(text, jsonb) from public, anon, authenticated;
grant execute on function public.set_app_setting(text, jsonb) to service_role;

notify pgrst, 'reload schema';
