"use client";
// Микровзаимодействия, которым нужен JS (N2): «полёт» миниатюры в корзину после «В корзину».
// Событие picpac-cart-add шлёт lib/cart.js; точка старта — место последнего нажатия (кнопка «В корзину»).
import { useEffect } from "react";
import { flyToCart } from "@/lib/flyToCart";

export default function MotionFx() {
  useEffect(() => {
    let last = null;
    const onDown = (e) => {
      last = { x: e.clientX, y: e.clientY, at: Date.now() };
    };
    const onAdd = (e) => {
      const from = last && Date.now() - last.at < 5000 ? last : { x: window.innerWidth / 2, y: window.innerHeight - 120 };
      flyToCart({ from, image: e.detail?.cover || null });
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("picpac-cart-add", onAdd);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("picpac-cart-add", onAdd);
    };
  }, []);
  return null;
}
