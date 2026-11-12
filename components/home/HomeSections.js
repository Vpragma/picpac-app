// Главная (N1): первый экран про воспоминания, «как это работает», ИИ-редактор, доверие. Серверные компоненты —
// без JS в браузере (бюджет главной). Фото коллажа — из тестовой галереи (Wikimedia Commons, свободные лицензии;
// авторы — на странице «Лицензии и авторы»). Первое фото — с приоритетом (LCP), остальные — лениво.
import Link from "next/link";
import { getImageProps } from "next/image";
import LineArt from "../LineArt";
import sunset from "@/public/demo-gallery/sunset-sun.jpg";
import flowers from "@/public/demo-gallery/flowers.jpg";
import dog from "@/public/demo-gallery/dog.jpg";
import castle from "@/public/demo-gallery/mir-castle.jpg";

const PRINTS = [
  { cls: "print-a", src: sunset, sizes: "(min-width: 1024px) 320px, 58vw", eager: true },
  { cls: "print-b", src: flowers, sizes: "(min-width: 1024px) 210px, 38vw" },
  { cls: "print-c", src: dog, sizes: "(min-width: 1024px) 250px, 46vw" },
  { cls: "print-d", src: castle, sizes: "170px" },
];

function Print({ cls, src, sizes, eager }) {
  const { props } = getImageProps({ src, alt: "", sizes, quality: 70, loading: eager ? "eager" : "lazy", fetchPriority: eager ? "high" : undefined });
  return (
    <figure className={"print " + cls}>
      <picture>
        <img {...props} alt="" decoding="async" />
      </picture>
    </figure>
  );
}

// Линейные рамки-«кальки» и графика под фото (viewBox = пропорции коллажа 5:4)
function CollageArt() {
  const p = { vectorEffect: "non-scaling-stroke" };
  return (
    <svg className="collage-art" viewBox="0 0 500 400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="8" y="12" width="290" height="218" rx="6" {...p} />
      <rect x="312" y="12" width="190" height="253" rx="6" className="ink2" {...p} />
      <rect x="228" y="250" width="230" height="153" rx="6" {...p} />
      <rect x="60" y="238" width="150" height="150" rx="6" className="ink2 only-wide" {...p} />
      <g className="only-narrow">
        <path d="M16 300 C58 270 92 332 140 302 S196 330 212 356" strokeDasharray="4 7" className="ink2" {...p} />
        <path d="M44 372 C34 365 28 360 28 354 C28 349 31 346 35 346 C39 346 42 348 44 351 C46 348 49 346 53 346 C57 346 60 349 60 354 C60 360 54 365 44 372 Z" {...p} />
      </g>
      <path d="M486 288 C487 296 489 298 496 299 C489 300 487 302 486 310 C485 302 483 300 476 299 C483 298 485 296 486 288 Z" {...p} />
      <path d="M20 250 C21 256 22 257 28 258 C22 259 21 260 20 266 C19 260 18 259 12 258 C18 257 19 256 20 250 Z" className="ink2" {...p} />
    </svg>
  );
}

export function HomeHero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-text">
        <p className="eyebrow">Фотокниги и печать фото</p>
        <h1 id="hero-title" className="hero-title">
          Pic Pac — машина времени для ваших <em>счастливых мгновений</em>
        </h1>
        <p className="lead">Соберите фотокнигу прямо в телефоне: добавьте фото — помощник разложит их по страницам. Напечатаем за 3 дня и бережно доставим.</p>
        <div className="hero-actions">
          <Link href="#catalog" className="btn btn-primary btn-lg">
            Выбрать фотокнигу
          </Link>
        </div>
        <p className="hero-note">Цена видна сразу · платить сейчас не нужно · брак перепечатаем бесплатно</p>
      </div>
      <div className="hero-media">
        <div className="collage">
          <CollageArt />
          {PRINTS.map((p) => (
            <Print key={p.cls} {...p} />
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { art: "book", title: "Выберите книгу", text: "Lite, Classic или Premium — цена и сроки видны сразу. Или просто печать фото." },
  { art: "photos", title: "Добавьте фото", text: "Из галереи телефона. Помощник разложит их по страницам и подскажет, что поправить." },
  { art: "truck", title: "Получите заказ", text: "Напечатаем за 3 дня и доставим: Белпочта, Европочта или курьер." },
];

export function HowItWorks() {
  return (
    <section className="section" aria-labelledby="how-title">
      <div className="section-head">
        <h2 id="how-title">Как это работает</h2>
      </div>
      <ol className="how">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <LineArt name={s.art} className="how-icon" />
            <div>
              <span className="how-num">Шаг {i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const Check = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const Shield = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

// Формулировка верна и после N3 (ИИ полностью на устройстве): фото для правок никуда не отправляются
export function AiBlock() {
  return (
    <section className="band" aria-labelledby="ai-title">
      <div className="ai-block">
        <LineArt name="ai" className="ai-art" />
        <div>
          <p className="eyebrow">ИИ-редактор</p>
          <h2 id="ai-title">Помощник, который бережёт ваши фото</h2>
          <p className="lead" style={{ margin: 0 }}>
            Творчество без сложностей: улучшит свет и цвет, поможет убрать лишнее, предупредит о размытых и тёмных кадрах.
          </p>
          <ul className="ai-points">
            <li>
              <Check />
              <span>Автоулучшение одной кнопкой и команды словами: «сделай теплее», «убери солнце»</span>
            </li>
            <li>
              <Check />
              <span>Проверка перед печатью: качество, дубли, пустые страницы</span>
            </li>
          </ul>
          <p className="privacy-note">
            <Shield />
            <span>
              <b>ИИ работает на вашем телефоне.</b> Фото для правок никуда не отправляются.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

const TRUST = [
  { big: "15 лет", text: "печатаем семейные истории в Беларуси" },
  { big: "3 дня", text: "печать фотокниги, фото — за 2 дня" },
  { big: "Качество", text: "книги живут десятилетиями; брак перепечатаем бесплатно" },
  { big: "Доставка", text: "по всей Беларуси; Белпочтой бесплатно от 150 BYN" },
];

export function Trust() {
  return (
    <section className="section" aria-labelledby="trust-title">
      <div className="section-head">
        <h2 id="trust-title">Почему Pic Pac</h2>
      </div>
      <ul className="trust">
        {TRUST.map((t) => (
          <li key={t.big}>
            <b>{t.big}</b>
            <span>{t.text}</span>
          </li>
        ))}
      </ul>
      <p className="muted small" style={{ marginTop: 12 }}>
        Производство — в индустриальном парке «Великий камень». Фото на этой странице — из тестовой галереи, авторы — в разделе{" "}
        <Link href="/licenses">«Лицензии и авторы»</Link>.
      </p>
    </section>
  );
}
