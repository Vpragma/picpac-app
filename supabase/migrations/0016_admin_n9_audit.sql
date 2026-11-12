-- 0016 (N9, ночь 2), часть 2. Журнал действий «без шума» — только отображением, сам журнал не меняется.
-- Представление над audit_log с признаком is_test: записи автотестов скрываются на экране журнала,
-- но остаются в базе (ОТ-04: журнал не удаляем и не меняем).
-- Автотест — это: служебная почта e2e-… / critic-… / night2-…, запрос с самого сервера (127.0.0.1),
-- пометка details.test или аккаунт, которого уже нет (тестовые аккаунты удаляются после каждого прогона;
-- у части их действий нет почты — например, «Админ: отправить напоминания сейчас»).
-- security_invoker: правила RLS таблиц действуют как при прямом чтении — журнал видит только админ.
create or replace view public.audit_log_view
with (security_invoker = true)
as
select
  a.id,
  a.at,
  a.user_id,
  a.role,
  a.action,
  a.object_type,
  a.object_id,
  a.result,
  a.details,
  a.ip,
  (
    coalesce(a.details ->> 'email', '') ~* '^(e2e|critic|night2)-'
    or coalesce(a.ip = '127.0.0.1'::inet, false)
    or a.details ->> 'test' is not null
    or (a.user_id is not null and not exists (select 1 from public.profiles p where p.id = a.user_id))
  ) as is_test
from public.audit_log a;

comment on view public.audit_log_view is 'Журнал действий только для чтения (N9): те же строки audit_log + is_test (автотесты и удалённые тестовые аккаунты) для экрана журнала. Строки не меняются и не удаляются';

revoke all on public.audit_log_view from anon, authenticated;
grant select on public.audit_log_view to authenticated, service_role;
