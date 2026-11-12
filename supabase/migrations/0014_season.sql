-- 0014 · N2: сезон оформления — «Без сезона», «Осень», «Чёрная пятница», «Новый год».
-- Договор — docs/night/night2-seasons.md. Одна строка настроек. Читать может любой (сайт показывает сезонные элементы гостям),
-- менять — только сервер с секретным ключом после проверки роли admin (PUT /api/v1/admin/season, запись в журнал).
-- Только добавление: старый код (main) таблицу не читает и продолжает работать.

create table if not exists public.site_season (
  id boolean primary key default true check (id),
  season text not null default 'none' check (season in ('none', 'autumn', 'blackfriday', 'newyear')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
comment on table public.site_season is 'N2: текущий сезон оформления (одна строка). Читать — всем, менять — только сервером после проверки роли admin';

-- К утру на стенде — «Осень» (план ночи 2, N2). Повторный запуск значение не меняет.
insert into public.site_season (id, season) values (true, 'autumn') on conflict (id) do nothing;

alter table public.site_season enable row level security;
revoke all on public.site_season from anon, authenticated;
grant select on public.site_season to anon, authenticated;
drop policy if exists site_season_read on public.site_season;
create policy site_season_read on public.site_season for select to anon, authenticated using (true);
-- Изменений через API от имени пользователя нет: ни одной политики на insert/update/delete
grant select, insert, update on public.site_season to service_role;

notify pgrst, 'reload schema';
