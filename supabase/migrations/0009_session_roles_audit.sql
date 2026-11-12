-- 0009_session_roles_audit.sql — D7: SEC-22 (роли только у живой сессии) и SEC-15 (индексы фильтров журнала).
-- Только добавление: новая функция и новые индексы. Старые функции и таблицы не меняются.

-- 1) SEC-22. Подпись токена сервер проверяет на месте (getClaims), а эта функция дополнительно
--    смотрит, есть ли сессия из токена (утверждение session_id) в auth.sessions.
--    Выход, «выйти везде», удаление аккаунта и истёкший срок сессии удаляют или закрывают строку —
--    старый токен сразу перестаёт давать роли.
do $$
begin
  if not has_table_privilege(current_user, 'auth.sessions', 'SELECT') then
    raise exception 'Нет права SELECT на auth.sessions у роли % — функцию не создаём', current_user;
  end if;
end $$;

-- null — сессии из токена больше нет; {} — сессия жива, ролей нет; иначе — роли пользователя
create or replace function public.session_roles()
returns public.app_role[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from auth.sessions s
      where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
        and s.user_id = (select auth.uid())
        and (s.not_after is null or s.not_after > now())
    )
    then coalesce(
      (select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = (select auth.uid())),
      '{}'::public.app_role[]
    )
    else null
  end;
$$;
comment on function public.session_roles() is 'SEC-22: роли текущего пользователя, только если сессия из токена ещё есть в auth.sessions; null — сессии нет';
revoke all on function public.session_roles() from public, anon;
grant execute on function public.session_roles() to authenticated;

-- 2) SEC-15. Фильтры экрана журнала: пользователь, объект, почта (почта ещё и в лимите попыток входа)
create index if not exists audit_log_user_idx on public.audit_log (user_id, id desc);
create index if not exists audit_log_object_idx on public.audit_log (object_type, object_id, id desc);
create index if not exists audit_log_email_idx on public.audit_log ((details ->> 'email'), at desc);
create index if not exists audit_log_result_idx on public.audit_log (result, id desc);

notify pgrst, 'reload schema';
