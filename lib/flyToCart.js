"use client";
// «Полёт» миниатюры в корзину (N2): копия обложки летит от кнопки к значку корзины в шапке.
// Только transform и opacity (Web Animations API), элемент вне потока — макет не сдвигается.
// При prefers-reduced-motion не запускается.
export function flyToCart({ from, image }) {
  if (typeof window === "undefined" || !from) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const target = document.querySelector(".topbar .cart-btn");
  if (!target || typeof Element.prototype.animate !== "function") return;
  const t = target.getBoundingClientRect();
  const size = 56;
  const el = document.createElement(image ? "img" : "div");
  if (image) {
    el.src = image;
    el.alt = "";
  }
  el.className = "fly-thumb";
  el.setAttribute("aria-hidden", "true");
  el.style.left = `${Math.round(from.x - size / 2)}px`;
  el.style.top = `${Math.round(from.y - size / 2)}px`;
  document.body.appendChild(el);
  const dx = t.left + t.width / 2 - from.x;
  const dy = t.top + t.height / 2 - from.y;
  const anim = el.animate(
    [
      { transform: "translate3d(0, 0, 0) scale(0.6)", opacity: 0 },
      { transform: "translate3d(0, -12px, 0) scale(1)", opacity: 1, offset: 0.15 },
      { transform: `translate3d(${dx * 0.6}px, ${dy * 0.6 - 48}px, 0) scale(0.75)`, opacity: 1, offset: 0.6 },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.2)`, opacity: 0.3 },
    ],
    { duration: 720, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
  );
  const done = () => el.remove();
  anim.onfinish = done;
  anim.oncancel = done;
  setTimeout(done, 1500);
}
