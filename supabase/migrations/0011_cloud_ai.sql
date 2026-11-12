-- 0011. Облачный ИИ Cloudflare Workers AI (этап D6, SEC-20): согласие, учёт облачных правок, дневной бюджет.
-- Только добавляет: новые таблицы и функции. Безопасно применять повторно.
-- Сутки считаются по UTC — как у Cloudflare (бесплатные 10 000 нейронов сбрасываются в 00:00 UTC = 03:00 по Минску).

-- Согласие «Фото отправится в Cloudflare для обработки и не сохраняется» — один раз на аккаунт.
create table if not exists public.ai_cloud_consents (
  user_id uuid primary key references auth.users (id) on delete cascade,
  accepted_at timestamptz not null default now(),
  version smallint not null default 1 check (version between 1 and 100)
);
comment on table public.ai_cloud_consents is 'Согласие клиента на облачный ИИ (Cloudflare Workers AI). Пишет только сервер';

-- Облачные правки пользователя за сутки: число вызовов и оценка нейронов
create table if not exists public.ai_cloud_usage (
  day date not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  calls int not null default 0 check (calls >= 0),
  neurons int not null default 0 check (neurons >= 0),
  primary key (day, user_id)
);
comment on table public.ai_cloud_usage is 'Облачные ИИ-правки за сутки (UTC) на пользователя: вызовы и нейроны. Без фото и текста команд';

-- Общий дневной бюджет нейронов на всё приложение
create table if not exists public.ai_cloud_budget (
  day date primary key,
  calls int not null default 0 check (calls >= 0),
  neurons int not null default 0 check (neurons >= 0)
);
comment on table public.ai_cloud_budget is 'Облачный ИИ: всего вызовов и нейронов за сутки (UTC)';

-- Читать и писать может только сервер (секретный ключ): правил RLS для клиентов нет
alter table public.ai_cloud_consents enable row level security;
alter table public.ai_cloud_usage enable row level security;
alter table public.ai_cloud_budget enable row level security;
revoke all on public.ai_cloud_consents, public.ai_cloud_usage, public.ai_cloud_budget from anon, authenticated;

-- Занять одну облачную правку: в одной транзакции проверяет лимит пользователя и общий бюджет нейронов.
-- Ответ: { ok: true, day, used, limit } или { ok: false, reason: 'user' | 'budget', used, limit }.
create or replace function public.ai_cloud_reserve(_user uuid, _user_limit int, _budget int, _estimate int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _day date := (now() at time zone 'utc')::date;
  _b_neurons int;
  _u_calls int;
begin
  insert into public.ai_cloud_budget (day) values (_day) on conflict (day) do nothing;
  select neurons into _b_neurons from public.ai_cloud_budget where day = _day for update;
  insert into public.ai_cloud_usage (day, user_id) values (_day, _user) on conflict (day, user_id) do nothing;
  select calls into _u_calls from public.ai_cloud_usage where day = _day and user_id = _user for update;
  if _u_calls >= _user_limit then
    return jsonb_build_object('ok', false, 'reason', 'user', 'day', _day, 'used', _u_calls, 'limit', _user_limit);
  end if;
  if _b_neurons + greatest(_estimate, 0) > _budget then
    return jsonb_build_object('ok', false, 'reason', 'budget', 'day', _day, 'used', _u_calls, 'limit', _user_limit);
  end if;
  update public.ai_cloud_usage set calls = calls + 1, neurons = neurons + greatest(_estimate, 0) where day = _day and user_id = _user;
  update public.ai_cloud_budget set calls = calls + 1, neurons = neurons + greatest(_estimate, 0) where day = _day;
  return jsonb_build_object('ok', true, 'day', _day, 'used', _u_calls + 1, 'limit', _user_limit);
end;
$$;

-- После вызова: поправить оценку нейронов на настоящий расход (_delta может быть < 0),
-- _refund — облако не ответило: правку пользователю вернуть (нейроны остаются в бюджете — так надёжнее).
create or replace function public.ai_cloud_settle(_user uuid, _day date, _delta int, _refund boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_cloud_usage
    set neurons = greatest(0, neurons + _delta), calls = greatest(0, calls - (case when _refund then 1 else 0 end))
    where day = _day and user_id = _user;
  update public.ai_cloud_budget
    set neurons = greatest(0, neurons + _delta)
    where day = _day;
end;
$$;

revoke all on function public.ai_cloud_reserve(uuid, int, int, int) from public, anon, authenticated;
revoke all on function public.ai_cloud_settle(uuid, date, int, boolean) from public, anon, authenticated;
grant execute on function public.ai_cloud_reserve(uuid, int, int, int) to service_role;
grant execute on function public.ai_cloud_settle(uuid, date, int, boolean) to service_role;
