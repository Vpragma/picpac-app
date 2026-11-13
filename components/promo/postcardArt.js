// Открытка PicPac (N8): один рисунок — две отрисовки. На экране — SVG (текст настоящий, Jost страницы),
// для «Сохранить картинкой» — тот же рисунок на canvas → PNG прямо на устройстве, без сторонних сервисов.
// Линейная графика нарисована для приложения (стиль components/LineArt.js), лицензия — наша.

export const CARD_W = 400;
export const CARD_H = 540;

const heart = (cx, cy, s = 1) =>
  `M${cx} ${cy + 10 * s} C${cx - 8 * s} ${cy + 4 * s} ${cx - 12 * s} ${cy} ${cx - 12 * s} ${cy - 4 * s} C${cx - 12 * s} ${cy - 8 * s} ${cx - 9 * s} ${cy - 10 * s} ${cx - 6 * s} ${cy - 10 * s} C${cx - 3 * s} ${cy - 10 * s} ${cx - 1 * s} ${cy - 8 * s} ${cx} ${cy - 6 * s} C${cx + 1 * s} ${cy - 8 * s} ${cx + 3 * s} ${cy - 10 * s} ${cx + 6 * s} ${cy - 10 * s} C${cx + 9 * s} ${cy - 10 * s} ${cx + 12 * s} ${cy - 8 * s} ${cx + 12 * s} ${cy - 4 * s} C${cx + 12 * s} ${cy} ${cx + 8 * s} ${cy + 4 * s} ${cx} ${cy + 10 * s} Z`;
const spark = (cx, cy, r = 8) =>
  `M${cx} ${cy - r} C${cx + r * 0.15} ${cy - r * 0.15} ${cx + r * 0.15} ${cy - r * 0.15} ${cx + r} ${cy} C${cx + r * 0.15} ${cy + r * 0.15} ${cx + r * 0.15} ${cy + r * 0.15} ${cx} ${cy + r} C${cx - r * 0.15} ${cy + r * 0.15} ${cx - r * 0.15} ${cy + r * 0.15} ${cx - r} ${cy} C${cx - r * 0.15} ${cy - r * 0.15} ${cx - r * 0.15} ${cy - r * 0.15} ${cx} ${cy - r} Z`;
// листок на ветке: черешок от (x, y), длина l, наклон a (градусы)
const leaf = (x, y, l, a) => {
  const r = (a * Math.PI) / 180;
  const ex = x + l * Math.cos(r);
  const ey = y + l * Math.sin(r);
  const nx = -Math.sin(r) * l * 0.32;
  const ny = Math.cos(r) * l * 0.32;
  const mx = (x + ex) / 2;
  const my = (y + ey) / 2;
  return `M${x} ${y} Q${mx + nx} ${my + ny} ${ex} ${ey} Q${mx - nx} ${my - ny} ${x} ${y} Z M${x} ${y} L${(x + ex * 2) / 3} ${(y + ey * 2) / 3}`;
};

// Раскрытая фотокнига с фото и сердцем (как LineArt «book», крупнее), ветки по бокам, искры.
// ink — основная линия (цвет логотипа), ink2 — вторая (зелёная), accent — сезонный акцент.
export const ART = [
  // книга
  { d: "M200 92 C176 80 146 77 113 83 V179 C146 173 176 176 200 188 C224 176 254 173 287 179 V83 C254 77 224 80 200 92 Z", ink: "ink" },
  { d: "M200 92 V188", ink: "ink" },
  { d: "M128 101 H182 V143 H128 Z", ink: "ink" },
  { d: "M131 137 L149 119 L161 131 L167 125 L179 137", ink: "ink" },
  { d: "M170 111 m-4.5 0 a4.5 4.5 0 1 0 9 0 a4.5 4.5 0 1 0 -9 0", ink: "ink" },
  { d: heart(244, 118, 1.25), ink: "ink" },
  { d: "M220 154 H266 M220 166 H254 M131 160 H176", ink: "ink2" },
  // ветка слева
  { d: "M60 210 C70 170 78 140 104 112", ink: "ink2" },
  { d: leaf(66, 186, 26, 200), ink: "accent" },
  { d: leaf(72, 162, 24, -30), ink: "accent" },
  { d: leaf(84, 138, 22, 210), ink: "accent" },
  { d: leaf(94, 124, 20, -40), ink: "accent" },
  // ветка справа
  { d: "M340 210 C330 170 322 140 296 112", ink: "ink2" },
  { d: leaf(334, 186, 26, -20), ink: "accent" },
  { d: leaf(328, 162, 24, 210), ink: "accent" },
  { d: leaf(316, 138, 22, -30), ink: "accent" },
  { d: leaf(306, 124, 20, 220), ink: "accent" },
  // искры и сердечко
  { d: spark(96, 62, 9), ink: "ink2" },
  { d: spark(310, 54, 7), ink: "ink" },
  { d: spark(336, 82, 4.5), ink: "ink2" },
  { d: heart(64, 96, 0.6), ink: "ink" },
];

// N7: для заказа только с печатью фото — две фотографии-отпечатка вместо книги (ветки, искры и сердце те же).
// Передний отпечаток залит цветом бумаги (fill) — он закрывает задний, как настоящий снимок сверху.
function printArt(cx, cy, w, h, deg, front) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const p = (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return `${(cx + dx * cos - dy * sin).toFixed(1)} ${(cy + dx * sin + dy * cos).toFixed(1)}`;
  };
  const rect = (x0, y0, x1, y1) => `M${p(x0, y0)} L${p(x1, y0)} L${p(x1, y1)} L${p(x0, y1)} Z`;
  const L = cx - w / 2;
  const T = cy - h / 2;
  const R = cx + w / 2;
  const B = cy + h / 2;
  const iL = L + 7;
  const iT = T + 7;
  const iR = R - 7;
  const iB = B - 18; // внизу поле шире — как у отпечатка
  const at = (fx, fy) => p(iL + (iR - iL) * fx, iT + (iB - iT) * fy);
  const [sx, sy] = at(0.74, 0.28).split(" ").map(Number);
  return [
    { d: rect(L, T, R, B), ink: "ink", fill: front ? "paper" : undefined },
    { d: rect(iL, iT, iR, iB), ink: "ink" },
    { d: `M${at(0.04, 0.94)} L${at(0.36, 0.46)} L${at(0.56, 0.72)} L${at(0.72, 0.5)} L${at(0.96, 0.94)}`, ink: "ink" },
    { d: `M${sx - 5} ${sy} a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0`, ink: "ink" },
    ...(front ? [{ d: `M${p(L + 14, B - 9)} L${p(L + 52, B - 9)}`, ink: "ink2" }] : []),
  ];
}

export const ART_PRINTS = [
  ...printArt(170, 128, 112, 92, -8, false),
  ...printArt(230, 142, 112, 92, 7, true),
  { d: heart(124, 188, 0.8), ink: "ink" },
  ...ART.slice(7), // ветки, искры, сердечко — как у открытки с книгой
];

// Рисунок открытки: «book» — раскрытая книга (есть фотокнига в заказе), «prints» — отпечатки (только печать фото)
export const artFor = (kind) => (kind === "prints" ? ART_PRINTS : ART);

// Тексты открытки: тёплые, про семью и воспоминания (тон брендбука)
export function cardText({ code, benefit, validToText, orderNumber }) {
  return {
    title: ["Спасибо, что храните", "воспоминания с нами"],
    body: ["Семья — это история. Пусть следующая", "глава будет ещё теплее."],
    codeLabel: "Ваш личный код на следующий заказ",
    code,
    terms: `${benefit}${validToText ? ` · действует до ${validToText}` : ""}`,
    note: `Один раз и только для вас${orderNumber ? ` · к заказу ${orderNumber}` : ""}`,
    slogan: "Pic Pac — машина времени для ваших счастливых мгновений",
  };
}

// Цвета: фирменные; при включённом сезоне акценты берутся из --season-* (договор N2), текст и бумага — фирменные
export const BRAND_COLORS = {
  paper: "#F6EFE6",
  frame: "#CCC7BF",
  ink: "#DD5757",
  ink2: "#38524F",
  accent: "#E8996C",
  text: "#2B403D",
  muted: "#5C615F",
  code: "#BD3434",
  codeBg: "#FFFFFF",
};

export function seasonColors() {
  if (typeof document === "undefined") return null;
  const season = document.documentElement.getAttribute("data-season");
  if (!season || season === "none") return null;
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  const s1 = v("--season-1");
  const s2 = v("--season-2");
  const s5 = v("--season-5") || s1;
  if (!s1 || !s2) return null;
  // Линии — сезонные (декор), текст, код и бумага остаются фирменными (контраст AA)
  return { season, ink: s2, accent: s5, ink2: v("--season-4") && season === "autumn" ? v("--season-4") : BRAND_COLORS.ink2 };
}

// Рисунок на canvas: тот же, что в SVG. scale — плотность (3 → 1200×1620 px)
export async function drawCard(canvas, data, colors, scale = 3) {
  const c = { ...BRAND_COLORS, ...(colors || {}) };
  const t = cardText(data);
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  const family = (getComputedStyle(document.documentElement).getPropertyValue("--font-jost") || "").trim() || "Jost, sans-serif";
  try {
    await Promise.all([document.fonts.load(`500 24px ${family}`, t.title.join(" ")), document.fonts.load(`400 15px ${family}`, t.body.join(" "))]);
  } catch {}
  // бумага и рамка
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 22);
  ctx.fillStyle = c.paper;
  ctx.fill();
  roundRect(ctx, 14, 14, CARD_W - 28, CARD_H - 28, 14);
  ctx.strokeStyle = c.frame;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // линейная графика
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.4;
  for (const a of artFor(data.art)) {
    const path = new Path2D(a.d);
    if (a.fill) {
      ctx.fillStyle = c[a.fill];
      ctx.fill(path);
    }
    ctx.strokeStyle = c[a.ink];
    ctx.stroke(path);
  }
  // тексты
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = c.text;
  ctx.font = `500 25px ${family}`;
  t.title.forEach((line, i) => ctx.fillText(line, 200, 246 + i * 31));
  ctx.fillStyle = c.muted;
  ctx.font = `400 15px ${family}`;
  t.body.forEach((line, i) => ctx.fillText(line, 200, 312 + i * 21));
  // купон с кодом
  roundRect(ctx, 44, 352, 312, 92, 14);
  ctx.fillStyle = c.codeBg;
  ctx.fill();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = c.code;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = c.muted;
  ctx.font = `400 13px ${family}`;
  ctx.fillText(t.codeLabel, 200, 376);
  ctx.fillStyle = c.code;
  ctx.font = `500 30px ${family}`;
  ctx.fillText(spaced(t.code), 200, 420);
  ctx.fillStyle = c.text;
  ctx.font = `500 16px ${family}`;
  ctx.fillText(t.terms, 200, 470);
  ctx.fillStyle = c.muted;
  ctx.font = `400 13px ${family}`;
  ctx.fillText(t.note, 200, 492);
  ctx.font = `400 12px ${family}`;
  ctx.fillText(t.slogan, 200, 512);
  return canvas;
}

// Код вразрядку — легче читать и диктовать
export const spaced = (code) => String(code || "").split("").join(" ");

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
