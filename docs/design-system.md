<!-- Источник: брендбук PicPac 2025 (выжимка — в рабочей папке хакатона) и тема super.picpac.by. -->
# Дизайн-система PicPac App (N1, 12.11.2026)

**Правило:** цвета, отступы, радиусы и тени — только токены ниже (`var(--…)`). Новых цветов не придумывать.
Токены — в одном месте: `app/picpac.css`. Компоненты — `app/globals.css` (старые классы), `app/brand.css` (новые классы N1, подключается последним).

## Токены (app/picpac.css)

Палитра бренда (`--pp-*`, «сырые» цвета — в компонентах лучше через семантические):
- кремовый `--pp-cream #faf5ed`, `--pp-cream-deep #f3ece2`, `--pp-paper #f6efe6`, `--pp-white`;
- зелёные `--pp-green-950 #172321` (фон тёмной темы), `-900 #2b403d` (заголовки), `-800 #364c49`, `-700 #38524f` (текст), `-500 #5f7772`;
- серые `--pp-gray-700 #5c615f` (вторичный текст, AA), `--pp-gray-500 #7c807f` (только крупное/декор), `--pp-gray-300 #aeb4b3`;
- красные `--pp-red #bd3434` (акцент, главная кнопка), `--pp-red-700 #a52d2d`, `--pp-red-800 #8e2626`, `--pp-logo #dd5757` (только логотип и линейная графика);
- рамки `--pp-frame #ccc7bf`, `--pp-frame-strong #bcbfb7`; акценты для графики `--pp-apricot`, `--pp-blue`, `--pp-violet`;
- пастель для плашек: `--pp-rose #edd5d5`, `--pp-sand #ede1d5`, `--pp-sage #c4dad6`, `--pp-stone #dedfdc`, `--pp-sky #cfdde7`, `--pp-lilac #e0dce8`, `--pp-mist #dedbdc`, `--pp-snow #faf7f7`.

Семантические (меняются с темой):
- фон: `--ds-color-bg-page`, `-bg-surface` (карточки), `-bg-raised` (шапка, нижняя панель — непрозрачные), `-bg-field`, `-bg-muted`, `-bg-hover`, `-bg-pressed`, `-bg-selected` (выбранный вариант), `-bg-inverse` (тосты), `-bg-band` (полоса-секция);
- текст: `--ds-color-text`, `-text-strong` (заголовки), `-text-secondary`, `-text-muted`, `-text-inverse`, `-placeholder`;
- акцент: `--ds-color-accent` (текст/значки; в тёмной теме коралл #f0968c), `--ds-color-primary` / `-primary-hover` / `-primary-active` (заливка главной кнопки, #bd3434 в обеих темах), `--ds-color-on-accent` (белый), `--ds-color-link`, `--ds-color-focus`;
- графика: `--ds-color-logo`, `--ds-color-line-art` (линии), `--ds-color-line-art-2` (вторая линия, зелёная);
- рамки: `--ds-color-border`, `-border-strong`, `-border-input` (3:1 к фону), `-card-border`;
- состояния: `--ds-color-success` / `-success-bg`, `-error` / `-error-bg`, `-warning` (только рамки) / `-warning-text` / `-warning-bg`, `-info-bg`, `-scrim`;
- плашки: `--ds-color-chip`, `--ds-color-on-chip`; продукты `--ds-color-tag-new` (sage), `-tag-sale` (rose), `-tag-choice` (sand);
- статусы: `--ds-color-status-accepted` (sky), `-moderation` (lilac), `-production` (sand), `-shipped` (sage), `-done` (stone), `-returned` (rose), `-draft` (mist); лента: `--ds-color-step-done/-current/-todo`.

Шрифт и текст: `--ds-font-sans` (Jost, только он), `--ds-text-xs 12` (только значки на фото), `-sm 14`, `-base 16`, `-lg 18`, `-xl 22`, `-2xl 28`, `--ds-text-amount`, `--ds-text-display` (первый экран), `--ds-tracking-caps`.
Отступы: `--space-1 4px`, `-2 8`, `-3 12`, `-4 16`, `-5 20`, `-6 24`, `-8 32`, `-10 40`, `-12 48`, `-16 64`; `--tap 44px` (цель для пальца).
Радиусы: `--ds-radius-xs 6`, `-sm 8`, `-md 12`, `-lg 16`, `-xl 24`, `-pill 999px`, `--ds-radius-book`.
Тени (мягкие, без цветного свечения): `--ds-shadow-sm`, `-card`, `-card-hover`, `-popover`, `-bar`, `-photo`.
Движение: `--ds-ease`, `--ds-duration 180ms` (при `prefers-reduced-motion` — выключать).
Совместимость: старые `--ds-gradient-accent`, `-selected`, `-highlight`, `-promo`, `--ds-color-surface-glass`, `--ds-shadow-accent` и т. п. оставлены как алиасы на сплошные токены — старый код и ветки от main получают новый вид без правок. **Новый код их не использует.**

## Темы

- `data-color-scheme` на `<html>` ставит сервер по cookie `pp_theme` (`light` | `dark` | `system`); без cookie — `light` у всех.
- Профиль → «Тема: Светлая / Тёмная / Как в системе» (`components/ThemeSetting.js`, `lib/theme.js`, `lib/themeShared.js`).
- Тёмная тема — тёмно-зелёное семейство, главная кнопка та же сплошная #bd3434 с белым текстом.
- В тестах тёмную тему включать cookie `pp_theme=dark` (эмуляция `prefers-color-scheme` её больше не включает).

## Классы компонентов

- Кнопки: `.btn` (вторичная по умолчанию: светлая, рамка), `.btn-primary` (сплошная #bd3434), `.btn-secondary` (контур тёмно-зелёный), `.btn-text` (текстовая, 44 px), `.btn-small`, `.btn-lg`, `.btn-block`, `.icon-btn`.
- Поля: `.field` + `span` (подпись), `.input` (input/select/textarea), `.field-hint`, `.field-error`, `.radio-row`, `.switch-row`, `.segmented` (переключатель-сегменты на radio).
- Карточки: `.card`, `.card-flat`, `.card-muted`, `a.card` (подъём при наведении).
- Плашки: `.chip` (нейтральная), `.tag` + `.tag-new` / `.tag-sale` / `.tag-choice` / `.tag-180`, `.tags`, `.tags-over` (поверх фото); статусы — `.status-chip[data-status=accepted|moderation|production|shipped|done|returned|rejected|pending|approved|draft|in_cart|ordered|open|answered|closed]` (компонент `StatusChip` в `components/OrderBits.js`).
- Цены: `.price-row`, `.price-now`, `.price-old` (зачёркнута), `.price-unit`; компонент `PriceFrom` (`components/CatalogView.js`) — старая цена, если в каталоге есть `oldPriceFrom`.
- Шапка `.topbar` (непрозрачная), нижняя панель `.tabbar` / `.tab`, `.sticky-bar` (панель цены).
- Секции: `.section`, `.section-head`, `.eyebrow`, `.lead`, `.band` (полоса на всю ширину).
- Пустые экраны: `EmptyState` (`components/LineArt.js`) — `.empty-state` + линейная иллюстрация `LineArt name=book|cart|orders|bell|photos|ai|truck|lost`.
- Плашки-сообщения: `.note`, `.note-ok`, `.note-warn`, `.note-error`.
- Админка: `.admin` (плотнее), `.filters`, `.filter-chip[aria-pressed]`, `.table-wrap` + `.data-table` (`.num` — числа справа), `.stat-tiles` / `.stat-tile`.
- Онбординг: `components/Onboarding.js` (`.onboarding`), флаг `localStorage pp:onboarding = done`.

## Контраст (WCAG AA)

- `#bd3434` на `#faf5ed` — 5,2:1; белый на `#bd3434` — 5,7:1; текст `#38524f` на `#faf5ed` — 7,8:1; вторичный `#5c615f` — 5,8:1.
- Серый брендбука `#7C807F` (3,7:1) и логотипный `#DD5757` с белым (3,8:1) — только крупное, декор и логотип.
- Тёмная тема: текст `#ebe5da` на `#172321` — 13,3:1; коралл `#f0968c` на карточке `#20302d` — 6,2:1; пастельные плашки с текстом `#2b403d` — от 7,5:1.
- Проверка: `npm run test:a11y` (axe, светлая и тёмная тема), `e2e/brand.spec.mjs` (светлая по умолчанию, выбор темы, кнопка без градиента).
