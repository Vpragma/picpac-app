-- 0017 · N4: модерация, которая реально работает — проверка фото на нашем сервере (модели обнажённости и CLIP).
-- Только добавление и обратная совместимость: новый столбец с умолчанием null и индекс для истории решений.
-- Старый код (основной сайт) этот столбец не читает и не пишет; флаг для заказа — прежний moderation_flag.

-- Вердикт проверки на сервере для фото: {v, path, at, scores, findings: [{id, level}], ms} или {v, path, at, unchecked, error}.
-- path — какой файл проверен (печатная версия или оригинал): сменился файл — проверка повторяется.
alter table public.project_photos add column if not exists moderation jsonb;
comment on column public.project_photos.moderation is
  'N4: проверка фото на сервере — {v, path, at, scores, findings[{id, level}], ms} или {unchecked, error}. Фото не хранится, только оценки.';

-- История решений модератора и среднее время проверки (экран «Модерация»)
create index if not exists moderation_reviews_decided_idx on public.moderation_reviews (decided_at desc) where decision <> 'pending';
