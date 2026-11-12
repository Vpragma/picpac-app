# Лицензии (ОТ-08)

Все внешние библиотеки, модели, шрифты, фото и данные, которые использует PicPac App, — с лицензиями. Состояние на 12.11.2026 (этап D7, после D1: модели на устройстве).

Главное:

- Библиотеки — MIT, Apache-2.0, ISC, BSD, MPL-2.0 и несколько разрешительных (Unlicense, CC0, Blue Oak, Python-2.0, CC BY 4.0 у данных `caniuse-lite`). **GPL и AGPL нет.** LGPL — только у бинарной библиотеки `libvips` внутри `sharp` (необязательная зависимость Next.js, работает на сервере, в код для браузера не попадает).
- Модели ИИ на устройстве (с этапа D1): SlimSAM-77 (Apache-2.0), MI-GAN (MIT, код и веса), ESRGAN-slim ×2 из UpscalerJS (MIT), среда onnxruntime-web (MIT). Файлы лежат у нас в `public/models` и `public/ort`, контрольные суммы — в разделе 2. Подробно — раздел 2 и [ai.md](ai.md).
- Проверка повторяется командой `npm run licenses:check` (входит в `npm run test:all`): код выхода 1, если у рабочей зависимости лицензия GPL/AGPL или лицензия не указана.
- Шрифт Jost — SIL Open Font License 1.1. Логотип и фирменный стиль — © ООО «Фотопринт», только для прототипа.
- Тестовые фото — Wikimedia Commons, свободные лицензии; авторы и ссылки — [test-photos/sources.md](test-photos/sources.md).
- У самого кода прототипа лицензии нет: файла `LICENSE` нет, в `package.json` стоит `"private": true`, репозиторий закрытый. Права на код — по разделу 13 ТЗ, вопрос решается с организаторами.

## 1. npm-зависимости

Таблица ниже сгенерирована скриптом из `node_modules` — обновить: `node scripts/gen-licenses.mjs` (печатает markdown; проверка без таблицы — `npm run licenses:check`; скрипт только читает `package.json`, `node_modules/*/package.json` и `package-lock.json`). Знак ⚠️ — лицензия вне списка MIT / Apache-2.0 / ISC / BSD / MPL-2.0 / OFL; пояснения — в разделе 7.

С этапа D1 `@huggingface/transformers`, `onnxruntime-web`, `@tensorflow/tfjs`, `upscaler` и `@upscalerjs/esrgan-slim` используются в воркерах ИИ-редактора (только по нажатию). С этапа D5 `web-push` (MPL-2.0) отправляет пуши на сервере. `nsfwjs` подключает этап D4 (модерация). Часть пакетов установлена заранее и в коде может не импортироваться (`idb`, `buffer`, `lucide-react`) — их лицензии тоже перечислены.

Источник: `package.json` и `node_modules/*/package.json` проекта picpac-app (picpac-app 0.1.0).
Собрано: 2026-11-12T09:09:28.858Z (скрипт `scripts/gen-licenses.mjs`).

### Прямые зависимости

| Пакет | Версия | Лицензия | Тип | Отметка |
|---|---|---|---|---|
| @dnd-kit/core | 6.3.1 | MIT | рабочая |  |
| @dnd-kit/sortable | 10.0.0 | MIT | рабочая |  |
| @huggingface/transformers | 4.3.2 | Apache-2.0 | рабочая |  |
| @supabase/ssr | 0.12.7 | MIT | рабочая |  |
| @supabase/supabase-js | 2.119.0 | MIT | рабочая |  |
| @tensorflow/tfjs | 4.11.0 | Apache-2.0 | рабочая |  |
| @upscalerjs/esrgan-slim | 1.0.0 | MIT | рабочая |  |
| buffer | 6.0.3 | MIT | рабочая |  |
| idb | 8.0.4 | ISC | рабочая |  |
| qrcode | 1.5.4 | MIT | рабочая | QR-код на сервере (/qr, «Открыть на телефоне»), D9 |
| lucide-react | 1.72.0 | ISC | рабочая |  |
| next | 16.4.6 | MIT | рабочая |  |
| nsfwjs | 4.3.0 | MIT | рабочая |  |
| onnxruntime-web | 1.31.1 | MIT | рабочая |  |
| postgres | 4.1.1 | Unlicense | рабочая | ⚠️ Unlicense — передача в общественное достояние; совместима с проектом (postgres нужен только скрипту миграций) |
| react | 19.3.1 | MIT | рабочая |  |
| react-dom | 19.3.1 | MIT | рабочая |  |
| upscaler | 1.0.0 | MIT | рабочая |  |
| web-push | 4.0.0 | MPL-2.0 | рабочая |  |
| zod | 4.6.7 | MIT | рабочая |  |
| @axe-core/playwright | 4.14.0 | MPL-2.0 | разработка |  |
| @playwright/test | 1.65.0 | Apache-2.0 | разработка |  |
| eslint | 9.39.5 | MIT | разработка |  |
| eslint-config-next | 16.4.6 | MIT | разработка |  |

Всего прямых: 23. Вне списка (MIT, Apache-2.0, ISC, BSD, MPL-2.0, OFL): 1 — postgres (Unlicense).

### Все установленные пакеты (с вложенными), по `package-lock.json`

Всего записей: 530.

| Лицензия | Пакетов |
|---|---:|
| MIT | 393 |
| Apache-2.0 | 52 |
| ISC | 30 |
| BSD-3-Clause | 17 |
| LGPL-3.0-or-later | 10 |
| BSD-2-Clause | 8 |
| 0BSD | 6 |
| MPL-2.0 | 3 |
| Apache-2.0 AND LGPL-3.0-or-later | 3 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| Apache-2.0 AND MIT | 1 |
| BlueOak-1.0.0 | 1 |
| CC-BY-4.0 | 1 |
| Python-2.0 | 1 |
| CC0-1.0 | 1 |
| Unlicense | 1 |
| (MIT OR CC0-1.0) | 1 |

#### Вне списка (19)

| Пакет | Версия | Лицензия | Где | Пояснение |
|---|---|---|---|---|
| @img/sharp-wasm32 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | рабочая, необязательная | LGPL-3.0 — библиотека libvips внутри sharp (необязательная зависимость Next и @huggingface/transformers), отдельный бинарный файл на сервере; в .next/static не найдена (проверено поиском) |
| @img/sharp-* (сборок под платформы: 3) | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | рабочая, необязательная | LGPL-3.0 — библиотека libvips внутри sharp (необязательная зависимость Next и @huggingface/transformers), отдельный бинарный файл на сервере; в .next/static не найдена (проверено поиском) |
| @img/sharp-libvips-* (сборок под платформы: 10) | 1.3.4 | LGPL-3.0-or-later | рабочая, необязательная | LGPL-3.0 — библиотека libvips внутри sharp (необязательная зависимость Next и @huggingface/transformers), отдельный бинарный файл на сервере; в .next/static не найдена (проверено поиском) |
| argparse | 2.0.1 | Python-2.0 | разработка | Python-2.0 — разрешительная, совместима (argparse у js-yaml, инструменты разработки) |
| caniuse-lite | 1.0.30001826 | CC-BY-4.0 | рабочая | CC BY 4.0 — нужна атрибуция (указана здесь); данные о браузерах для сборки (нужны Next и browserslist), в браузер пользователя не отправляются |
| language-subtag-registry | 0.3.23 | CC0-1.0 | разработка | CC0 — общественное достояние; совместима |
| minimatch | 10.2.6 | BlueOak-1.0.0 | разработка | Blue Oak Model License — разрешительная, совместима (проверка кода eslint) |
| postgres | 4.1.1 | Unlicense | рабочая | Unlicense — передача в общественное достояние; совместима с проектом (postgres нужен только скрипту миграций) |

## 2. Модели ИИ

Файлы моделей лежат в репозитории (`public/models`, `public/ort`) и отдаются с нашего сайта: Hugging Face и CDN во время работы не нужны. Размеры и SHA-256 ниже посчитаны по файлам ветки (12.11.2026, этап D7) и совпадают с `models-cache/MANIFEST.tsv`, откуда модели скачаны (D1). Источники по папкам — `public/models/README.md`.

### На устройстве (работают в браузере, фото никуда не уходят)

| Модель | Источник и ревизия | Лицензия кода | Лицензия весов | Набор обучения | Файл, размер | SHA-256 |
|---|---|---|---|---|---|---|
| **SlimSAM-77** — кодировщик (int8), выделение касанием | [Xenova/slimsam-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform) `5850ab45f587c112167512ffef949107115e26a0`; оригинал — github.com/czg1225/SlimSAM | Apache-2.0 | Apache-2.0 | SA-1B (Meta, у набора свои исследовательские условия) | `slimsam-77-uniform-boxes/onnx/vision_encoder_quantized.onnx`, 8 882 165 Б | `cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971` |
| **SlimSAM-77** — декодер с рамкой (int8) | [ArAnirudh/slimsam-77-uniform-boxes](https://huggingface.co/ArAnirudh/slimsam-77-uniform-boxes) `6a74f508b2cb129eda9f9519d67574f1ec27429f` | Apache-2.0 | Apache-2.0 | SA-1B | `slimsam-77-uniform-boxes/onnx/prompt_encoder_mask_decoder_quantized.onnx`, 4 751 034 Б | `45f97f705ff14a886f69bda2e7ba0e1016d6bbf7e82dfc3fb40d8c2216be01f1` |
| **MI-GAN** — ластик | [andraniksargsyan/migan](https://huggingface.co/andraniksargsyan/migan) `406830d0fa60666da0071c342ad2fbc8f30c5c64`; проект Picsart-AI-Research/MI-GAN | MIT, © 2024 Picsart AI Research | MIT (`public/models/migan/LICENSE.txt`, 1 082 Б) | Places2 (свои исследовательские условия) | `migan/migan_pipeline_v2.onnx`, 28 079 181 Б | `6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b` |
| **ESRGAN-slim ×2** (UpscalerJS) — «Резкость для печати» | npm `@upscalerjs/esrgan-slim` 1.0.0; архитектура idealo ISR | MIT (пакет); Apache-2.0 (ISR) | MIT (в составе пакета) | DIV2K (свои исследовательские условия) | `upscaler/x2/model.json` 12 336 Б и `group1-shard1of1.bin` 888 300 Б | `8efb488c2caed0196a6163e3f06798f9245e92623ffd50654a26c372e09150ea`, `5cb464ae4d390ce0a771afd5feaf60fbfcdb18ab48a56db98cdf6b88202369de` |
| **nsfwjs / MobileNetV2** — первичная проверка фото (этап D4) | npm `nsfwjs` 4.3.0; модель GantMan/nsfw_model | MIT | MIT (с оговоркой авторов о материалах третьих сторон) | данные авторов модели | `model.json` 117 928 Б и `group1-shard1of1` 2 619 461 Б (появятся в `public/models` с этапом D4) | `feffc6868d61e412a4e7a22657a3d07a8a48df6e11688a9e25b77c23cb7b45c9`, `8e7dddbb16acacc1bf1601b1b8a761e730ff934b7f2d7771312b2f000e5f5f13` |

Веса всех моделей — MIT или Apache-2.0. У наборов обучения (SA-1B, Places2, DIV2K) свои условия для исследований; на сами веса и их использование они в лицензиях моделей не переносятся, но перед пилотом это стоит проверить с юристом.

### Среда выполнения моделей

| Компонент | Версия | Лицензия | Файлы у нас |
|---|---|---|---|
| `onnxruntime-web` (wasm-ядро) | 1.31.1 | MIT | `public/ort/ort-wasm-simd-threaded.wasm` 14 848 852 Б (`4b884c203b0fa48d057be3332c65513ff85aa3c5bddd6946acc0fab7ecda001d`), `.mjs` 24 738 Б (`30ed0b5cd1182ede931fea448afb567d4dc705ec957af09f108a2be5f770dac3`) — копии из пакета |
| `@huggingface/transformers` | 4.3.2 | Apache-2.0 | код в воркере ИИ-редактора |
| `@tensorflow/tfjs`, `upscaler` | 4.11.0, 1.0.0 | Apache-2.0, MIT | код в воркере (UpscalerJS) |

### В облаке (Cloudflare Workers AI, только по согласию; этап D6)

Мы эти модели не храним и не запускаем сами. Что им передаётся — в [ai.md](ai.md).

| Модель | Лицензия | Примечание |
|---|---|---|
| `@cf/openai/gpt-oss-120b` | Apache-2.0 | разбор свободной фразы в команду |
| `@cf/black-forest-labs/flux-2-klein-4b` | Apache-2.0 (веса FLUX.2 klein 4B) | старшие версии (klein 9B, dev) — только некоммерческие, их не используем |
| `@cf/moondream/moondream3.1-9B-A2B` | Moondream Model License 1.0 (не из списка OSI) | коммерческое использование допускается с ограничениями; перед пилотом прочитать с юристом |

### Что сознательно не используем

| Что | Почему |
|---|---|
| YOLO (Ultralytics) | AGPL-3.0 |
| FLUX.2 klein 9B и dev | лицензия только для некоммерческого использования |

## 3. Шрифт и оформление

| Что | Лицензия | Примечание |
|---|---|---|
| Шрифт **Jost**, начертания 400 и 500 | SIL Open Font License 1.1 (© The Jost Project Authors, автор Owen Earl) | подключается через `next/font/google`: файлы скачиваются при сборке и отдаются с нашего домена, браузер к Google не обращается |
| Токены оформления `--ds-*` (цвета, радиусы, тени) | © ООО «Фотопринт» (тема сайта super.picpac.by) | только в прототипе для хакатона |
| Логотип PicPac (`public/logo.svg`) и иконки приложения, сделанные из него (`public/icons/`, `public/splash/`, `app/icon.svg`, `app/apple-icon.png`, `app/favicon.ico`) | © ООО «Фотопринт» | только в прототипе для хакатона |

## 4. Фото продуктов и данные заказчика

| Что | Правообладатель | Как используем |
|---|---|---|
| Фото продуктов (Lite, Classic, Premium, печать фото) | © ООО «Фотопринт» | **в текущей версии приложения не используются** (карточки каталога без фото). Если будут добавлены — только сжатые копии и только для прототипа |
| Названия продуктов, цены, сроки, способы доставки | ООО «Фотопринт», справочник super.picpac.by от 11.11.2026 | данные заказчика для прототипа. Коэффициенты цен размеров, кроме 20×20, и цены цифровой печати, кроме 10×15, — **тестовые, уточнить у Фотопринт** |

Сохранённые страницы и скриншоты сайта заказчика в репозиторий не входят.

## 5. Тестовая галерея (20 фото)

Все фото — с Wikimedia Commons, свободные лицензии: CC0, общественное достояние, CC BY 2.5/4.0, CC BY-SA 3.0/4.0. Сжатые копии — в `public/demo-gallery/` (до 1600 точек и 400 КБ), «плохие» версии (темно, пересвет, жёлтый оттенок, размытие, завал горизонта, маленькое, дубль) сделаны программно (`scripts/demo-gallery-build.mjs`) и распространяются на тех же условиях, что оригинал. Автор, лицензия, ссылка на оригинал и изменения каждого фото — в [test-photos/sources.md](test-photos/sources.md) и в `public/demo-gallery/manifest.json`. Реальных клиентов на фото нет.

Скриншоты в `docs/screens/` и видео `docs/demo-video.webm` содержат эти же тестовые фото и синтетические данные.

## 6. Данные

| Набор | Происхождение | Условия |
|---|---|---|
| Каталог, цены, сроки, доставка | справочник super.picpac.by (данные заказчика) | для прототипа |
| Синтетические клиенты, заказы, обращения, события | наш генератор `scripts/demo-data.mjs` (`npm run seed:synthetic`), детерминированный; строки помечены `is_synthetic` / `is_demo` | свои, без реальных людей: имена собраны из списков, телефоны `+375 (00) …` (несуществующий код), почты `synthetic-…@example.com`. Допущения — в README |
| Демо-аккаунты жюри | `client@example.com`, `moderator@example.com`, `admin@example.com` (`npm run seed`) | синтетические |
| Внешние датасеты | напрямую не используем; наборы обучения моделей — в разделе 2 | — |

## 7. Исключения в таблице npm

| Пакет | Лицензия | Почему допустимо |
|---|---|---|
| `@img/sharp-libvips-*`, `@img/sharp-*` (сборки `sharp` под платформы) | LGPL-3.0-or-later (libvips) | необязательная зависимость Next.js и `@huggingface/transformers`; отдельный бинарный файл на сервере, в `.next/static` не попадает. Динамическая линковка LGPL-библиотеки не накладывает требований GPL на наш код |
| `postgres` | Unlicense | общественное достояние; нужен только скрипту миграций |
| `caniuse-lite` | CC BY 4.0 | данные о браузерах для сборки; атрибуция — эта строка |
| `argparse` | Python-2.0 | разрешительная; инструмент разработки |
| `minimatch` 10.x | Blue Oak Model License 1.0.0 | разрешительная; инструмент проверки кода |
| `language-subtag-registry` | CC0-1.0 | общественное достояние; инструмент разработки |
| `web-push`, `@axe-core/playwright`, `axe-core` | MPL-2.0 | копилефт на уровне файлов: касается только изменённых файлов самих пакетов, мы их не меняем; `axe-core` — только в тестах доступности |
