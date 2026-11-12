"use client";
// Профиль: «Тема: светлая / тёмная / как в системе» (N1). По умолчанию — светлая. Настройка устройства — нужна и гостю.
import { THEMES, THEME_LABELS, setTheme, useTheme } from "../lib/theme";

export default function ThemeSetting({ initial = "light" }) {
  const theme = useTheme(initial);
  return (
    <section className="card" aria-labelledby="theme-title">
      <h3 id="theme-title">Тема</h3>
      <div className="segmented" role="radiogroup" aria-labelledby="theme-title" data-testid="theme-setting">
        {THEMES.map((t) => (
          <label key={t}>
            <input type="radio" name="pp-theme" value={t} checked={theme === t} onChange={() => setTheme(t)} />
            {THEME_LABELS[t]}
          </label>
        ))}
      </div>
      <p className="muted small" style={{ margin: "8px 0 0" }}>
        Светлая — как на сайте PicPac. Настройка сохранится на этом устройстве.
      </p>
    </section>
  );
}
