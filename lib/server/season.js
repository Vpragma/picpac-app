import "server-only";
// Сезон оформления (N2): чтение и смена. Таблица public.site_season (миграция 0014), одна строка.
// Читаем публичным ключом (RLS разрешает чтение всем), меняем — только секретным ключом после проверки роли admin.
// Чтение — через кэш данных Next (unstable_cache, тег «picpac-season»): страницы не ждут базу на каждом запросе,
// а смена сезона в админке сбрасывает тег (revalidateTag с expire: 0) — следующий запрос любого экземпляра
// сервера читает базу заново, поэтому новый сезон виден сразу и без мигания плашки.
// Страховка: база медлит — ждём не дольше WAIT_MS и отдаём последнее известное значение (или «none»).
import { revalidateTag, unstable_cache } from "next/cache";
import { cache } from "react";
import { parseSeason, SEASON_DEFAULT } from "../seasonShared";
import { createSupabaseAdmin, createSupabaseStateless } from "./supabaseAdmin";

export const SEASON_TAG = "picpac-season";
const WAIT_MS = 1200;
// Сброс тега Next применяет в фоне уже после ответа на смену сезона: запрос в первые миллисекунды
// ещё получил бы старое значение из кэша. Поэтому сразу после смены этот процесс отвечает записанным.
const JUST_WRITTEN_MS = 3000;

// Последнее известное значение на процесс сервера (обработчики API и страницы Next собирает в разные модули)
const store = (globalThis.__picpacSeason ||= { value: null });

async function fetchRow() {
  const { data, error } = await createSupabaseStateless().from("site_season").select("season, updated_at").eq("id", true).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// Кэш данных: до смены сезона (тег) или не дольше 60 с — страховка, если строку поменяют в обход API
const cachedSeason = unstable_cache(async () => parseSeason((await fetchRow())?.season), ["picpac-site-season-v1"], { tags: [SEASON_TAG], revalidate: 60 });

const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

// Текущий сезон: «none» | «autumn» | «blackfriday» | «newyear»
export async function readSeason() {
  if (store.value && Date.now() - (store.writtenAt || 0) < JUST_WRITTEN_MS) return store.value;
  try {
    const value = await Promise.race([cachedSeason(), wait(WAIT_MS)]);
    if (value) {
      store.value = value;
      return value;
    }
  } catch (e) {
    console.error("Сезон: не удалось прочитать", e?.message);
  }
  return store.value || SEASON_DEFAULT;
}

// Один раз на запрос страницы: layout и страница видят одно и то же значение
export const seasonForRequest = cache(() => readSeason());

// Для админки: текущий сезон, когда и кем включён (прямо из базы, без кэша)
export async function readSeasonInfo() {
  const { data, error } = await createSupabaseAdmin().from("site_season").select("season, updated_at, updated_by").eq("id", true).maybeSingle();
  if (error) throw new Error(error.message);
  let by = null;
  if (data?.updated_by) {
    const { data: u } = await createSupabaseAdmin().auth.admin.getUserById(data.updated_by).catch(() => ({ data: null }));
    by = u?.user?.email || null;
  }
  return { season: parseSeason(data?.season), updatedAt: data?.updated_at || null, updatedBy: by };
}

// Смена сезона (роль уже проверена). Возвращает { season, previous }.
export async function writeSeason(season, userId) {
  const value = parseSeason(season);
  const db = createSupabaseAdmin();
  const { data: before } = await db.from("site_season").select("season").eq("id", true).maybeSingle();
  const { error } = await db.from("site_season").upsert({ id: true, season: value, updated_at: new Date().toISOString(), updated_by: userId || null });
  if (error) throw new Error(error.message);
  store.value = value;
  store.writtenAt = Date.now();
  // Сброс кэша данных у всех: следующий запрос читает базу (старое значение не отдаётся)
  revalidateTag(SEASON_TAG, { expire: 0 });
  return { season: value, previous: parseSeason(before?.season) };
}
