// Подписи для экрана журнала действий

export const ACTION_LABELS = {
  "auth.login": "Вход",
  "auth.register": "Регистрация",
  "auth.logout": "Выход",
  "auth.role_select": "Выбор роли",
  "auth.mfa_enroll": "Подключение кода 2FA",
  "auth.mfa_verify": "Проверка кода 2FA",
  "access.denied": "Отказ в доступе",
  "profile.update": "Изменение профиля",
  "account.delete": "Удаление аккаунта",
};

export const RESULT_LABELS = { success: "Успех", denied: "Отказ", error: "Ошибка" };

export const REASON_LABELS = {
  invalid_credentials: "неверная почта или пароль",
  invalid_input: "пустая или неверная почта",
  rate_limited: "слишком много попыток",
  service_rate_limit: "ограничение Supabase",
  service_unavailable: "сервис входа недоступен",
  roles_unavailable: "роли не загрузились",
  no_session: "не выполнен вход",
  no_role: "нет нужной роли",
  mfa_required: "нужен код 2FA",
  role_not_assigned: "роль не назначена",
  demo_account: "тестовый аккаунт",
  wrong_password: "неверный пароль",
  delete_failed: "сбой удаления",
  after_register: "вход после регистрации",
  create_failed: "сбой создания",
  email_exists: "почта уже занята",
  weak_password: "слабый пароль",
  invalid_code: "неверный код",
  enroll_failed: "сбой подключения",
  not_staff: "не сотрудник",
};

export const OBJECT_LABELS = { route: "адрес", user: "аккаунт", role: "роль", profile: "профиль", factor: "2FA" };
