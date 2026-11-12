// Сезонная линейная графика (N2): нарисована командой для приложения, в линейном стиле брендбука PicPac —
// линия без заливок, круглые концы, как в components/LineArt.js. Цвета — только токены сезона (--season-*):
// классы .s1….s5 (app/season.css). Без хуков — можно и в серверных, и в клиентских компонентах.
// Лицензия — наша (docs/licenses.md, «Иллюстрации»).

const line = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" };

// Заострённый лист длиной len от основания (0,0) вправо
const leafletD = (len, w = 0.34) => `M0 0 C${len * 0.3} ${-len * w} ${len * 0.72} ${-len * w} ${len} 0 C${len * 0.72} ${len * w} ${len * 0.3} ${len * w} 0 0 Z`;

// Четырёхлучевая «искра» (как в LineArt)
const sparkD = (cx, cy, r = 8) =>
  `M${cx} ${cy - r} C${cx + r * 0.15} ${cy - r * 0.15} ${cx + r * 0.15} ${cy - r * 0.15} ${cx + r} ${cy} C${cx + r * 0.15} ${cy + r * 0.15} ${cx + r * 0.15} ${cy + r * 0.15} ${cx} ${cy + r} C${cx - r * 0.15} ${cy + r * 0.15} ${cx - r * 0.15} ${cy + r * 0.15} ${cx - r} ${cy} C${cx - r * 0.15} ${cy - r * 0.15} ${cx - r * 0.15} ${cy - r * 0.15} ${cx} ${cy - r} Z`;

// Снежинка: 6 лучей с «галочками» на концах
function snowflakeD(cx, cy, r) {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    parts.push(`M${cx} ${cy} L${x.toFixed(1)} ${y.toFixed(1)}`);
    const bx = cx + r * 0.62 * Math.cos(a);
    const by = cy + r * 0.62 * Math.sin(a);
    for (const s of [-1, 1]) {
      const b = a + s * 0.6;
      parts.push(`M${bx.toFixed(1)} ${by.toFixed(1)} L${(bx + r * 0.3 * Math.cos(b)).toFixed(1)} ${(by + r * 0.3 * Math.sin(b)).toFixed(1)}`);
    }
  }
  return parts.join(" ");
}

// Пятиконечная звезда
function starD(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(" L")} Z`;
}

// Хвоя: иголки по обе стороны ветки
function needlesD(x1, y1, x2, y2, n = 9, len = 9) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L;
  const uy = dy / L;
  const parts = [`M${x1} ${y1} L${x2} ${y2}`];
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    for (const s of [-1, 1]) {
      // иголка под углом ~40° вперёд по ветке
      const nx = ux * 0.75 + -uy * s * 0.66;
      const ny = uy * 0.75 + ux * s * 0.66;
      parts.push(`M${px.toFixed(1)} ${py.toFixed(1)} l${(nx * len).toFixed(1)} ${(ny * len).toFixed(1)}`);
    }
  }
  return parts.join(" ");
}

// ── Осень ───────────────────────────────────────────────────────────────
// Кленовый лист в квадрате 100×100, черешок внизу
export const MAPLE_D =
  "M50 4 L55 16 L61 13 L59 30 L66 34 L80 22 L80 32 L94 30 L84 44 L90 50 L74 56 L80 66 L64 64 L58 72 L50 70 L42 72 L36 64 L20 66 L26 56 L10 50 L16 44 L6 30 L20 32 L20 22 L34 34 L41 30 L39 13 L45 16 Z";
const MAPLE_VEINS = "M50 70 V14 M50 60 L86 34 M50 60 L14 34 M50 66 L74 62 M50 66 L26 62 M50 70 C50 80 49 88 47 96";

// Дубовый лист 100×100
const OAK_D =
  "M50 6 C60 8 64 18 58 24 C68 24 72 36 62 40 C74 42 76 56 64 58 C74 62 72 74 58 74 C60 80 56 84 51 85 L49 85 C44 84 40 80 42 74 C28 74 26 62 36 58 C24 56 26 42 38 40 C28 36 32 24 42 24 C36 18 40 8 50 6 Z";
const OAK_VEINS = "M50 12 V96 M50 30 L58 26 M50 30 L42 26 M50 46 L62 42 M50 46 L38 42 M50 62 L62 60 M50 62 L38 60";

// Простой лист (для листопада) 40×40
export const LEAF_D = "M6 34 C6 18 18 6 34 6 C34 22 22 34 6 34 Z";
const LEAF_VEIN = "M6 34 L27 13 M6 34 L2 38";

export function Maple({ x = 0, y = 0, s = 1, r = 0, className = "s2" }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-50 -50)`} className={className}>
      <path d={MAPLE_D} {...line} />
      <path d={MAPLE_VEINS} {...line} strokeWidth={1.4} />
    </g>
  );
}

export function Oak({ x = 0, y = 0, s = 1, r = 0, className = "s1" }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-50 -50)`} className={className}>
      <path d={OAK_D} {...line} />
      <path d={OAK_VEINS} {...line} strokeWidth={1.4} />
    </g>
  );
}

export function Leaf({ x = 0, y = 0, s = 1, r = 0, className = "s5" }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-20 -20)`} className={className}>
      <path d={LEAF_D} {...line} />
      <path d={LEAF_VEIN} {...line} strokeWidth={1.4} />
    </g>
  );
}

// Ветка рябины: веточка, два перистых листа, гроздь ягод. Рисуется от (0,0) вправо, длина ~230
export function Rowan({ x = 0, y = 0, s = 1, r = 0 }) {
  const leaflets = [];
  const fronds = [
    { x0: 46, y0: 25, a: -32, len: 74, n: 4 },
    { x0: 168, y0: 8, a: 18, len: 64, n: 3 },
  ];
  for (const f of fronds) {
    const rad = (f.a * Math.PI) / 180;
    const ex = f.x0 + Math.cos(rad) * f.len;
    const ey = f.y0 + Math.sin(rad) * f.len;
    leaflets.push(<path key={`st${f.x0}`} d={`M${f.x0} ${f.y0} L${ex.toFixed(1)} ${ey.toFixed(1)}`} {...line} strokeWidth={1.4} />);
    for (let i = 0; i < f.n; i++) {
      const t = 0.24 + i * (0.7 / f.n);
      const px = f.x0 + Math.cos(rad) * f.len * t;
      const py = f.y0 + Math.sin(rad) * f.len * t;
      for (const side of [-1, 1]) {
        leaflets.push(
          <path key={`${f.x0}-${i}-${side}`} d={leafletD(22 - i * 1.5, 0.26)} transform={`translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${f.a + side * 68})`} {...line} strokeWidth={1.5} />,
        );
      }
    }
    leaflets.push(<path key={`tip${f.x0}`} d={leafletD(21, 0.26)} transform={`translate(${ex.toFixed(1)} ${ey.toFixed(1)}) rotate(${f.a})`} {...line} strokeWidth={1.5} />);
  }
  const berries = [
    [104, 46],
    [114, 43],
    [110, 54],
    [121, 52],
    [100, 57],
    [118, 62],
    [108, 65],
    [127, 60],
    [96, 48],
  ];
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      <path d="M0 30 C40 24 84 26 124 18 S196 4 232 10" className="s4" {...line} />
      <g className="s4">{leaflets}</g>
      <path d="M118 19 C114 28 108 36 104 42 M118 19 C118 30 118 40 117 46 M118 19 C122 30 126 42 126 52" className="s4" {...line} strokeWidth={1.4} />
      <g className="s2">
        {berries.map(([bx, by]) => (
          <circle key={`${bx}-${by}`} cx={bx} cy={by} r={4.4} {...line} className="sb-berry" />
        ))}
      </g>
    </g>
  );
}

// Кружка с паром и листиком; 100×100
export function Mug({ x = 0, y = 0, s = 1, r = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-50 -50)`}>
      <g className="s3">
        <path d="M22 40 H70 V70 C70 82 62 90 50 90 H42 C30 90 22 82 22 70 Z" {...line} />
        <path d="M70 48 C86 48 88 72 70 72" {...line} />
        <path d="M12 96 H82" {...line} />
      </g>
      <g className="s1">
        <path d="M36 32 C30 26 42 22 36 14" {...line} />
        <path d="M52 32 C46 26 58 22 52 8" {...line} />
      </g>
      <path d={leafletD(18, 0.4)} transform="translate(37 70) rotate(-38)" className="s2" {...line} strokeWidth={1.6} />
    </g>
  );
}

// Клетчатый плед, свёрнутый в рулон, с бахромой; 120×80
export function Plaid({ x = 0, y = 0, s = 1, r = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-60 -40)`}>
      <g className="s2">
        <path d="M28 18 H100 V62 H28" {...line} />
        <ellipse cx="28" cy="40" rx="11" ry="22" {...line} />
        <path d="M28 40 C28 36 33 36 33 40 C33 45 25 46 24 40 C23 33 33 30 36 37" {...line} strokeWidth={1.4} />
      </g>
      <g className="s1">
        <path d="M52 18 V62 M72 18 V62 M90 18 V62" {...line} strokeWidth={1.4} />
        <path d="M38 29 H100 M38 51 H100" {...line} strokeWidth={1.4} />
      </g>
      <path d="M100 22 H107 M100 29 H108 M100 36 H107 M100 44 H108 M100 51 H107 M100 58 H108" className="s3" {...line} strokeWidth={1.4} />
    </g>
  );
}

// ── Чёрная пятница ──────────────────────────────────────────────────────
export function Tag({ x = 0, y = 0, s = 1, r = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-50 -50)`}>
      <g className="s1">
        <path d="M34 22 H82 C86 22 88 24 88 28 V68 C88 72 86 74 82 74 H34 L14 48 Z" {...line} />
        <circle cx="30" cy="48" r="4" {...line} />
      </g>
      <path d="M26 48 C16 40 8 30 14 18" className="s3" {...line} />
      <g className="s2">
        <circle cx="52" cy="38" r="5" {...line} />
        <circle cx="70" cy="58" r="5" {...line} />
        <path d="M72 34 L50 62" {...line} />
      </g>
    </g>
  );
}

export function Bag({ x = 0, y = 0, s = 1, r = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-50 -50)`}>
      <g className="s4">
        <path d="M18 34 H82 L76 92 H24 Z" {...line} />
        <path d="M36 34 V28 C36 19 42 12 50 12 C58 12 64 19 64 28 V34" {...line} />
      </g>
      <path
        d="M50 74 C44 70 38 66 38 60 C38 56 41 54 44 54 C47 54 49 56 50 58 C51 56 53 54 56 54 C59 54 62 56 62 60 C62 66 56 70 50 74 Z"
        className="s1"
        {...line}
      />
    </g>
  );
}

export function Spark({ x = 0, y = 0, size = 8, className = "s2" }) {
  return <path d={sparkD(x, y, size)} className={className} {...line} />;
}

// ── Новый год ───────────────────────────────────────────────────────────
export function FirBranch({ x = 0, y = 0, s = 1, r = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`} className="s5">
      <path d={needlesD(0, 20, 220, 6, 16, 11)} {...line} strokeWidth={1.6} />
      <path d={needlesD(70, 16, 110, 44, 4, 8)} {...line} strokeWidth={1.4} />
      <path d={needlesD(150, 10, 196, 34, 4, 8)} {...line} strokeWidth={1.4} />
    </g>
  );
}

// Ёлочный шар на нитке; подвес в (0,0)
export function Ornament({ x = 0, y = 0, s = 1, drop = 40 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d={`M0 0 V${drop}`} className="s2" {...line} strokeWidth={1.4} />
      <g className="s1">
        <rect x="-6" y={drop} width="12" height="7" rx="2" {...line} />
        <circle cx="0" cy={drop + 25} r="18" {...line} />
        <path d={`M-17 ${drop + 21} C-8 ${drop + 15} 8 ${drop + 29} 17 ${drop + 21}`} {...line} strokeWidth={1.4} />
      </g>
      <path d={`M-14 ${drop + 33} C-6 ${drop + 28} 6 ${drop + 40} 14 ${drop + 34}`} className="s3" {...line} strokeWidth={1.4} />
    </g>
  );
}

export function Snowflake({ x = 0, y = 0, size = 12, className = "s2" }) {
  return <path d={snowflakeD(x, y, size)} className={className} {...line} strokeWidth={1.5} />;
}

export function Star({ x = 0, y = 0, size = 12, className = "s1" }) {
  return <path d={starD(x, y, size)} className={className} {...line} />;
}

export function Gift({ x = 0, y = 0, s = 1, r = 0 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s}) translate(-50 -50)`}>
      <g className="s4">
        <rect x="20" y="42" width="60" height="46" rx="3" {...line} />
        <rect x="16" y="32" width="68" height="12" rx="3" {...line} />
      </g>
      <g className="s3">
        <path d="M50 32 V88" {...line} />
        <path d="M50 32 C42 18 28 22 34 30 C38 34 46 33 50 32 C54 33 62 34 66 30 C72 22 58 18 50 32 Z" {...line} />
      </g>
    </g>
  );
}

// Маленький значок сезона для промо-плашки и превью (24×24)
export function SeasonIcon({ season, className = "season-icon" }) {
  const box = { viewBox: "0 0 100 100", className, "aria-hidden": true, focusable: "false" };
  if (season === "autumn")
    return (
      <svg {...box}>
        <Maple x={50} y={50} s={0.9} className="s2" />
      </svg>
    );
  if (season === "blackfriday")
    return (
      <svg {...box}>
        <Tag x={52} y={50} s={0.95} />
      </svg>
    );
  if (season === "newyear")
    return (
      <svg {...box}>
        <Snowflake x={50} y={50} size={40} className="s1" />
      </svg>
    );
  return null;
}
