-- 0018 · N10: лента сотрудника без шума от автотестов и симулятора ERP.
-- Причина «бесконечной» ленты админа: триггеры 0007/0008 пишут уведомление на каждый новый заказ, каждую смену статуса
-- и каждое обращение — в том числе по заказам автотестов (e2e-…, critic-…, night2-…) и по шагам симулятора ERP
-- (pg_cron каждые 30 с, 0013). Автотесты на общей базе делают сотни заказов, и всё это падало в ленту админа.
--
-- Только добавление: два столбца с умолчаниями, две новые функции, новый триггер BEFORE INSERT. Старые функции
-- и триггеры не меняются: новый триггер срабатывает на любую вставку в staff_notifications (0007, 0008 и будущие).
--   • is_test = true — уведомление про заказ или обращение тестового аккаунта. Новый код ленты показывает его только
--     тестовому сотруднику (автотесты проверяют свою ленту), админ и модератор его не видят. Старый код видит всё,
--     как раньше, — совместимо.
--   • Шаги симулятора ERP (event_id 'sim:…') — не уведомление на каждый шаг, а одна сводка за день:
--     «Симулятор ERP · сводка за 13.11» / «Смен статуса: 12. Последняя: PP-… → Завершён». Время — последнего шага.
--     «Новый заказ» (его делает человек), ручная смена статуса, решения модератора и события настоящего ERP — как раньше.

alter table public.staff_notifications add column if not exists is_test boolean not null default false;
alter table public.staff_notifications add column if not exists repeat_count int not null default 1 check (repeat_count >= 1);
create index if not exists staff_notifications_real_idx on public.staff_notifications (audience, created_at desc) where not is_test;

-- Тестовый аккаунт: почта автотестов и проверяющих агентов. Зеркало — isTestEmail() в lib/notifyRules.js
create or replace function private.is_test_email(_email text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(_email, '') ~* '^(e2e|critic|night2)-' $$;

create or replace function private.staff_notification_shape() returns trigger
language plpgsql security definer set search_path = '' as $$
declare _order uuid; _email text; _event text; _key text; _day timestamptz; _n int; _last text;
begin
  begin
    _order := new.order_id;
    if _order is null and new.interaction_id is not null then
      select i.order_id into _order from public.interactions i where i.id = new.interaction_id;
    end if;
    if _order is not null then
      select u.email into _email from public.orders o join auth.users u on u.id = o.user_id where o.id = _order;
      if private.is_test_email(_email) then new.is_test := true; end if;
    end if;
    if not new.is_test and new.interaction_id is not null then
      select u.email into _email from public.interactions i join auth.users u on u.id = i.user_id where i.id = new.interaction_id;
      if private.is_test_email(_email) then new.is_test := true; end if;
    end if;

    -- Шаг симулятора ERP → сводка за день (отдельная для тестовых заказов)
    if new.dedupe_key like 'hist:%' then
      select h.event_id into _event from public.order_status_history h where h.id = substr(new.dedupe_key, 6)::bigint;
      if _event like 'sim:%' then
        _last := new.title;
        _day := date_trunc('day', now() at time zone 'Europe/Minsk');
        _key := 'erp-sim:' || case when new.is_test then 'test:' else '' end || to_char(_day, 'YYYY-MM-DD');
        perform pg_advisory_xact_lock(hashtext(_key));   -- два шага одновременно не теряют счёт
        update public.staff_notifications
           set repeat_count = repeat_count + 1,
               body = left('Смен статуса: ' || (repeat_count + 1) || '. Последняя: ' || _last, 300),
               created_at = now()
         where dedupe_key = _key
        returning repeat_count into _n;
        if found then return null; end if;   -- сводка обновлена, отдельной строки не будет
        new.dedupe_key := _key;
        new.title := 'Симулятор ERP · сводка за ' || to_char(_day, 'DD.MM');
        new.body := left('Смен статуса: 1. Последняя: ' || _last, 300);
        new.order_id := null;          -- сводка не исчезает вместе с одним заказом
        new.interaction_id := null;
        new.link := '/admin';
        new.repeat_count := 1;
      end if;
    end if;
  exception when others then
    raise warning 'staff_notification_shape: %', sqlerrm;   -- уведомление всё равно сохранится, вставку не роняем
  end;
  return new;
end $$;

create or replace trigger staff_notifications_shape before insert on public.staff_notifications
  for each row execute function private.staff_notification_shape();

revoke all on function private.is_test_email(text) from public;
revoke all on function private.staff_notification_shape() from public;
