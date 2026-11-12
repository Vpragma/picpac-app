-- 0005 · S10: «реальные» данные в сводке = всё, что не синтетика.
-- Заказы из приложения на демо-стенде помечены is_demo (их статусы двигает демо-тикер), но это настоящие действия
-- пользователей — в статистике они «реальные». Синтетические строки (is_synthetic) — «демо-данные».
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
  select * from orders where _with_synthetic or not is_synthetic
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
    'orders', (select count(*) from od where is_synthetic)
  ),
  'events', (select count(*) from ev)
);
$$;

revoke all on function public.analytics_summary(int, boolean) from public, anon, authenticated;
grant execute on function public.analytics_summary(int, boolean) to service_role;
