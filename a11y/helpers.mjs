// Общие проверки доступности для тестов a11y (D2)
// Цели касания меньше 44×44: кнопки, ссылки-кнопки, меню, переключатели (ссылки внутри текста — исключение WCAG)
export async function smallTargets(page) {
  return page.evaluate(() => {
    const sel = "button, a.btn, [role=button], summary, input[type=checkbox], input[type=radio], .tabbar a, .topbar a, .site-footer a, a.back-link";
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden" || cs.display === "none") continue;
      let ok = r.width >= 43.5 && r.height >= 43.5;
      const label = el.closest("label");
      if (!ok && label) {
        const lr = label.getBoundingClientRect();
        ok = lr.width >= 43.5 && lr.height >= 43.5;
      }
      if (!ok) out.push(`${el.tagName.toLowerCase()} «${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}» ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
}
