"use client";
// Каталог всегда берём из API /api/v1/catalog, а не из кода страниц.
import { useEffect, useState } from "react";

let cache = null;

export function useCatalog() {
  const [state, setState] = useState({ data: cache, error: null, loading: !cache });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (cache) return;
    setState({ data: null, error: null, loading: true });
    let alive = true;
    fetch("/api/v1/catalog")
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => {
        cache = data;
        if (alive) setState({ data, error: null, loading: false });
      })
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

export function useProduct(slug) {
  const { data, error, loading, retry } = useCatalog();
  const product = data?.products.find((p) => p.slug === slug) || null;
  return { product, error, loading, retry };
}
