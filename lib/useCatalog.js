"use client";
// Каталог всегда берём из API /api/v1/catalog, а не из кода страниц.
// Главная и карточка продукта получают каталог с сервера (SSR) и передают сюда через primeCatalog —
// тогда браузер вообще не запрашивает каталог. Иначе — один общий запрос на все компоненты экрана.
import { useEffect, useState } from "react";

let cache = null;
let inflight = null;

export function primeCatalog(data) {
  if (data && !cache) cache = data;
}

function fetchCatalog() {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = fetch("/api/v1/catalog")
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => {
        cache = data;
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function useCatalog(initial) {
  primeCatalog(initial);
  const [state, setState] = useState(() => ({ data: cache, error: null, loading: !cache }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (state.data) return;
    let alive = true;
    fetchCatalog()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const retry = () => {
    setState({ data: null, error: null, loading: true });
    setAttempt((n) => n + 1);
  };
  return { ...state, retry };
}

export function useProduct(slug, initial) {
  const { data, error, loading, retry } = useCatalog(initial);
  const product = data?.products.find((p) => p.slug === slug) || null;
  return { product, catalog: data, error, loading, retry };
}
