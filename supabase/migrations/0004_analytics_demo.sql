-- 0004 · S10: статистика админки и демо-данные. Только добавляющие изменения.
-- Пометки синтетических и демо-строк, индексы для сводки и функция сводки для дашборда.

-- Синтетические клиенты (synthetic-NNN@example.com) помечены в профиле: reset:demo удаляет только их
alter table public.profiles add column if not exists is_synthetic boolean not null default false;
-- Демо-проекты клиента client@example.com (seed:demo) — reset:demo удаляет только их
alter table public.projects add column if not exists is_demo boolean not null default false;

create index if not exists analytics_events_at_idx on public.analytics_events (at desc);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists interactions_status_idx on public.interactions (status);

-- Сводка для дашборда. Считает база (без выгрузки тысяч строк в приложение):
--   воронка — число разных участников (хеш пользователя, иначе сеанс) с событием шага за период;
--   длительности шагов редактора — массивы (медиану считает приложение, это проверяет unit-тест);
--   «где бросают» — последний шаг редактора у тех, кто не добавил в корзину;
--   плитки — текущее состояние заказов и обращений, выручка (тест) — за период по paid_at.
-- _with_synthetic = false — только реальные строки (без is_synthetic и is_demo).
create or replace function public.analytics_summary(_days int, _with_synthetic boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with ev as (
  select type, coalesce(user_hash, session_id) as actor, step, duration_ms, props, is_synthetic, at
  from analytics_events
  where at >= now() - make_interval(days => _days)
    and (_with_synthetic or not is_synthetic)
),
od as (
  select * from orders where _with_synthetic or not (is_synthetic or is_demo)
),
actors as (
  select actor,
    bool_or(type = 'product_view') as v,
    bool_or(type = 'project_create') as p,
    bool_or(type = 'cart_add') as c,
    bool_or(type = 'checkout_start') as s,
    bool_or(type = 'payment_test') as pay,
    bool_or(type = 'ai_edit') as ai
  from ev
  where actor is not null
  group by actor
),
last_step as (
  select distinct on (actor) actor, step
  from ev
  where type = 'editor_step' and step is not null and actor is not null
  order by actor, at desc
)
select jsonb_build_object(
  'funnel', (
    select jsonb_build_object(
      'product_view', count(*) filter (where v),
      'project_create', count(*) filter (where p),
      'cart_add', count(*) filter (where c),
      'checkout_start', count(*) filter (where s),
      'payment_test', count(*) filter (where pay)
    ) from actors
  ),
  'durations', (
    select coalesce(jsonb_object_agg(step, d), '{}'::jsonb)
    from (
      select step, jsonb_agg(duration_ms) as d
      from ev
      where type = 'editor_step' and step is not null and duration_ms is not null
      group by step
    ) x
  ),
  'dropoff', (
    select coalesce(jsonb_object_agg(step, n), '{}'::jsonb)
    from (
      select l.step, count(*) as n
      from last_step l join actors a on a.actor = l.actor
      where not a.c
      group by l.step
    ) y
  ),
  'ai', (
    select jsonb_build_object('projects', count(*) filter (where p), 'projectsWithAi', count(*) filter (where p and ai))
    from actors
  ) || (
    select jsonb_build_object(
      'aiEdits', count(*),
      'autoEnhanced', coalesce(sum(case when props ->> 'kind' = 'auto' then least(greatest(coalesce((props ->> 'count')::int, 1), 1), 500) else 0 end), 0)
    )
    from ev where type = 'ai_edit'
  ),
  'tiles', (
    select jsonb_build_object(
      'ordersToday', count(*) filter (where created_at >= (date_trunc('day', now() at time zone 'Europe/Minsk') at time zone 'Europe/Minsk')),
      'inWork', count(*) filter (where status in ('accepted', 'moderation', 'production')),
      'overdue', count(*) filter (where status not in ('shipped', 'done') and eta_to < now()),
      'onModeration', count(*) filter (where status = 'moderation'),
      'ordersPeriod', count(*) filter (where created_at >= now() - make_interval(days => _days)),
      'paidPeriod', count(*) filter (where payment_status = 'paid_test' and paid_at >= now() - make_interval(days => _days)),
      'revenueKop', coalesce(sum(total_kop) filter (where payment_status = 'paid_test' and paid_at >= now() - make_interval(days => _days)), 0)
    ) from od
  ),
  'unanswered', (select count(*) from interactions i join od on od.id = i.order_id where i.status = 'open'),
  'unansweredOverdue', (select count(*) from interactions i join od on od.id = i.order_id where i.status = 'open' and i.sla_due < now()),
  'synthetic', jsonb_build_object(
    'events', (select count(*) from ev where is_synthetic),
    'orders', (select count(*) from od where is_synthetic or is_demo)
  ),
  'events', (select count(*) from ev)
);
$$;

revoke all on function public.analytics_summary(int, boolean) from public, anon, authenticated;
grant execute on function public.analytics_summary(int, boolean) to service_role;
