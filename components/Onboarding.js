"use client";
// Онбординг при первом входе (N1): 3 коротких экрана в тоне бренда, можно пропустить. Флаг — localStorage
// pp:onboarding = "done". Показывается только на главной и после первой отрисовки (не мешает LCP и не сдвигает
// вёрстку: окно поверх страницы). В автотестах флаг ставится заранее (playwright.config.mjs, storageState).
import { useEffect, useRef, useState } from "react";
import LineArt from "./LineArt";

const KEY = "pp:onboarding";
const SLIDES = [
  { art: "photos", title: "Ваши фото заслуживают книги", text: "Отпуск, первые шаги малыша, просто тёплые дни — соберите их в фотокнигу прямо в телефоне." },
  { art: "ai", title: "Помощник всё подскажет", text: "Разложит фото по страницам, улучшит свет и цвет. ИИ работает на вашем телефоне — фото никуда не отправляются." },
  { art: "truck", title: "Напечатаем за 3 дня", text: "Цена видна сразу, платить сейчас не нужно. Доставим по всей Беларуси, а брак перепечатаем бесплатно." },
];

function seen() {
  try {
    return window.localStorage.getItem(KEY) === "done";
  } catch {
    return true; // хранилище недоступно — не надоедаем
  }
}

export default function Onboarding() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const titleRef = useRef(null);
  const backRef = useRef(null);

  useEffect(() => {
    if (seen()) return;
    // после первой отрисовки и загрузки — главный экран успевает показаться (LCP)
    const show = () => {
      backRef.current = document.activeElement;
      setOpen(true);
    };
    let t;
    if (document.readyState === "complete") t = setTimeout(show, 300);
    else {
      const onLoad = () => (t = setTimeout(show, 300));
      window.addEventListener("load", onLoad, { once: true });
      return () => {
        window.removeEventListener("load", onLoad);
        clearTimeout(t);
      };
    }
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open, i]);

  function close() {
    try {
      window.localStorage.setItem(KEY, "done");
    } catch {}
    setOpen(false);
    if (backRef.current && backRef.current.focus) backRef.current.focus();
  }

  const cardRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") close();
      // фокус не уходит из окна (aria-modal): Tab по кругу между кнопками окна
      if (e.key === "Tab" && cardRef.current) {
        const items = [...cardRef.current.querySelectorAll("button, [tabindex='-1']")];
        const first = items[0];
        const last = items[items.length - 1];
        if (!cardRef.current.contains(document.activeElement)) {
          e.preventDefault();
          first?.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <div className="onboarding" role="presentation" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="ob-title" aria-describedby="ob-text" data-testid="onboarding" ref={cardRef}>
        <LineArt name={s.art} className="onboarding-art" />
        <h2 id="ob-title" tabIndex={-1} ref={titleRef}>
          {s.title}
        </h2>
        <p id="ob-text">{s.text}</p>
        <ol className="onboarding-dots" aria-label={`Экран ${i + 1} из ${SLIDES.length}`}>
          {SLIDES.map((x, k) => (
            <li key={x.title} aria-current={k === i ? "step" : undefined} />
          ))}
        </ol>
        <div className="onboarding-actions">
          <button type="button" className="btn-text" onClick={close}>
            Пропустить
          </button>
          <button type="button" className="btn btn-primary" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? "Начать" : "Дальше"}
          </button>
        </div>
      </div>
    </div>
  );
}
