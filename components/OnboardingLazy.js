"use client";
// N5: онбординг — отдельный кусок кода, его качает только тот, кто его ещё не видел (флаг localStorage pp:onboarding).
// Остальным на главной этот код не нужен вовсе — меньше JS на первом экране.
import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

const Onboarding = dynamic(() => import("./Onboarding"), { ssr: false });

const subscribeNone = () => () => {};
function notSeen() {
  try {
    return window.localStorage.getItem("pp:onboarding") !== "done";
  } catch {
    return false; // хранилище недоступно — онбординг и сам бы не показался (Onboarding.seen)
  }
}

export default function OnboardingLazy() {
  // На сервере и при гидратации — false (разметка совпадает), в браузере — по флагу
  const need = useSyncExternalStore(subscribeNone, notSeen, () => false);
  return need ? <Onboarding /> : null;
}
