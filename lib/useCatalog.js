"use client";
// Каталог всегда берём из API /api/v1/catalog, а не из кода страниц.
import { useEffect, useState } from "react";

let cache = null;

export function useCatalog() {
  const [state, setState] = useState({ data: cache, error: null, loading: !cache });
  useEffect(() => {
    if (cache) return;
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
  }, []);
  return state;
}

export function useProduct(slug) {
  const { data, error, loading } = useCatalog();
  const product = data?.products.find((p) => p.slug === slug) || null;
  return { product, error, loading };
}
