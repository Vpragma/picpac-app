// Линейные иллюстрации PicPac (N1): нарисованы для приложения, линейный стиль брендбука (линия, без заливок).
// Основная линия — currentColor (токен --ds-color-line-art, цвет логотипа), вторая — .ink2 (тёмно-зелёная).
// Без хуков — можно и в серверных, и в клиентских компонентах. Лицензия — наша (docs/licenses.md, «Иллюстрации»).

const svgProps = {
  viewBox: "0 0 160 120",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: "false",
};

const heart = (cx, cy, s = 1) =>
  `M${cx} ${cy + 10 * s} C${cx - 8 * s} ${cy + 4 * s} ${cx - 12 * s} ${cy} ${cx - 12 * s} ${cy - 4 * s} C${cx - 12 * s} ${cy - 8 * s} ${cx - 9 * s} ${cy - 10 * s} ${cx - 6 * s} ${cy - 10 * s} C${cx - 3 * s} ${cy - 10 * s} ${cx - 1 * s} ${cy - 8 * s} ${cx} ${cy - 6 * s} C${cx + 1 * s} ${cy - 8 * s} ${cx + 3 * s} ${cy - 10 * s} ${cx + 6 * s} ${cy - 10 * s} C${cx + 9 * s} ${cy - 10 * s} ${cx + 12 * s} ${cy - 8 * s} ${cx + 12 * s} ${cy - 4 * s} C${cx + 12 * s} ${cy} ${cx + 8 * s} ${cy + 4 * s} ${cx} ${cy + 10 * s} Z`;

// четырёхлучевая «искра»
const spark = (cx, cy, r = 8) =>
  `M${cx} ${cy - r} C${cx + r * 0.15} ${cy - r * 0.15} ${cx + r * 0.15} ${cy - r * 0.15} ${cx + r} ${cy} C${cx + r * 0.15} ${cy + r * 0.15} ${cx + r * 0.15} ${cy + r * 0.15} ${cx} ${cy + r} C${cx - r * 0.15} ${cy + r * 0.15} ${cx - r * 0.15} ${cy + r * 0.15} ${cx - r} ${cy} C${cx - r * 0.15} ${cy - r * 0.15} ${cx - r * 0.15} ${cy - r * 0.15} ${cx} ${cy - r} Z`;

const ART = {
  // раскрытая фотокнига с фото и сердцем
  book: (
    <>
      <path d="M80 34 C64 26 44 24 22 28 V92 C44 88 64 90 80 98 C96 90 116 88 138 92 V28 C116 24 96 26 80 34 Z" />
      <path d="M80 34 V98" />
      <rect x="32" y="40" width="36" height="28" rx="2" />
      <path d="M34 64 L46 52 L54 60 L58 56 L66 64" />
      <circle cx="60" cy="47" r="3" />
      <path d={heart(109, 52, 0.9)} />
      <g className="ink2">
        <path d="M94 74 H124 M94 82 H116 M36 78 H64" />
        <path d={spark(140, 18, 6)} />
      </g>
    </>
  ),
  // сумка покупок с сердцем
  cart: (
    <>
      <path d="M42 46 H118 L112 102 H48 Z" />
      <path d="M64 46 V40 C64 31 71 24 80 24 C89 24 96 31 96 40 V46" />
      <path d={heart(80, 74, 1.1)} />
      <g className="ink2">
        <path d={spark(130, 30, 7)} />
        <path d="M28 62 V72 M23 67 H33" />
      </g>
    </>
  ),
  // посылка с лентой
  orders: (
    <>
      <path d="M34 48 L80 30 L126 48 V92 L80 110 L34 92 Z" />
      <path d="M34 48 L80 66 L126 48 M80 66 V110" />
      <g className="ink2">
        <path d="M57 39 L103 57 V72" />
        <path d={spark(140, 24, 6)} />
        <path d="M18 70 H26 M14 80 H24" />
      </g>
    </>
  ),
  // колокольчик уведомлений
  bell: (
    <>
      <path d="M80 24 C66 24 56 35 56 49 V68 L48 80 H112 L104 68 V49 C104 35 94 24 80 24 Z" />
      <path d="M72 86 C72 91 75.5 94 80 94 C84.5 94 88 91 88 86" />
      <g className="ink2">
        <path d={spark(124, 30, 7)} />
        <path d="M34 54 V64 M29 59 H39" />
        <path d="M116 88 C122 84 126 78 128 72" />
      </g>
    </>
  ),
  // стопка отпечатков
  photos: (
    <>
      <g transform="rotate(-8 56 62)">
        <rect x="26" y="36" width="58" height="52" rx="3" />
        <rect x="32" y="42" width="46" height="34" rx="1" />
      </g>
      <rect x="70" y="28" width="64" height="60" rx="3" />
      <rect x="76" y="34" width="52" height="38" rx="1" />
      <path d="M78 70 L94 54 L104 64 L110 58 L126 70" />
      <circle cx="116" cy="44" r="4" />
      <g className="ink2">
        <path d="M80 80 H112" />
        <path d={heart(42, 104, 0.6)} />
        <path d={spark(146, 22, 6)} />
      </g>
    </>
  ),
  // телефон с фото, щитом и искрами — ИИ на устройстве
  ai: (
    <>
      <rect x="54" y="12" width="52" height="96" rx="9" />
      <path d="M73 20 H87" />
      <rect x="61" y="28" width="38" height="32" rx="2" />
      <path d="M63 56 L74 45 L81 52 L85 48 L97 56" />
      <path d="M80 68 L91 72 V81 C91 88 86 92 80 94 C74 92 69 88 69 81 V72 Z" />
      <path d="M75 81 L79 85 L86 77" />
      <g className="ink2">
        <path d={spark(124, 30, 9)} />
        <path d={spark(36, 56, 6)} />
        <path d="M120 70 H134 M124 78 H134" />
      </g>
    </>
  ),
  // машина доставки
  truck: (
    <>
      <path d="M22 40 H94 V88 H22 Z" />
      <path d="M94 54 H118 L134 70 V88 H94" />
      <path d="M100 60 H116 L124 68 H100 Z" />
      <circle cx="44" cy="90" r="9" />
      <circle cx="114" cy="90" r="9" />
      <path d={heart(58, 63, 0.9)} />
      <g className="ink2">
        <path d="M4 50 H14 M8 60 H16 M2 70 H12" />
        <path d={spark(140, 26, 6)} />
      </g>
    </>
  ),
  // карта с пунктиром и меткой — «страница потерялась»
  lost: (
    <>
      <path d="M120 20 C110 20 103 27 103 36 C103 48 120 62 120 62 C120 62 137 48 137 36 C137 27 130 20 120 20 Z" />
      <circle cx="120" cy="36" r="5" />
      <rect x="16" y="78" width="34" height="28" rx="2" transform="rotate(-6 33 92)" />
      <g className="ink2">
        <path d="M50 88 C66 70 74 98 92 80 S112 70 118 66" strokeDasharray="3 6" />
        <path d="M70 30 H86 M74 38 H86" />
      </g>
    </>
  ),
};

export default function LineArt({ name = "book", className = "empty-art", title }) {
  const art = ART[name] || ART.book;
  return (
    <svg {...svgProps} className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {art}
    </svg>
  );
}

// Пустой экран: иллюстрация, тёплый заголовок, текст и действия
export function EmptyState({ art = "book", title, children, actions = null, headingLevel = 2 }) {
  const H = `h${headingLevel}`;
  return (
    <div className="card empty-state" data-testid="empty-state">
      <LineArt name={art} />
      <H>{title}</H>
      {children && <p>{children}</p>}
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
