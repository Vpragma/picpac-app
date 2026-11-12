import "server-only";
// Сезон оформления (N2): чтение и смена. Таблица public.site_season (миграция 0014), одна строка.
// Читаем публичным ключом (RLS разрешает чтение всем), меняем — только секретным ключом после проверки роли admin.
// Копия в памяти на 10 секунд: страницы не ждут базу на каждом запросе; если база медлит — не дольше WAIT_MS.
import { cache } from "react";
import { parseSeason, SEASON_DEFAULT } from "../seasonShared";
import { createSupabaseAdmin, createSupabaseStateless } from "./supabaseAdmin";

const TTL_MS = 10_000;
const WAIT_MS = 1200;

// Общая копия на процесс сервера: обработчики API и страницы Next собирает в разные модули,
// а смена сезона в админке должна сразу дойти и до страниц этого экземпляра
const store = (globalThis.__picpacSeason ||= { mem: { value: null, at: 0 }, inflight: null, writtenAt: 0 });

async function fetchRow() {
  const { data, error } = await createSupabaseStateless().from("site_season").select("season, updated_at").eq("id", true).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function refresh() {
  if (!store.inflight) {
    const startedAt = Date.now();
    store.inflight = fetchRow()
      .then((row) => {
        // Чтение, начатое до смены сезона на этом сервере, не затирает новое значение
        if (startedAt >= store.writtenAt) store.mem = { value: parseSeason(row?.season), at: Date.now() };
        return store.mem.value;
      })
      .catch((e) => {
        console.error("Сезон: не удалось прочитать", e?.message);
        return store.mem.value || SEASON_DEFAULT;
      })
      .finally(() => {
        store.inflight = null;
      });
  }
  return store.inflight;
}

const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms));

// Текущий сезон. maxAgeMs — насколько старую копию можно отдать без похода в базу.
// Копия старше — ждём базу не дольше WAIT_MS (дальше — последнее известное значение или «none»):
// так после смены сезона в админке страницы почти сразу приходят уже с новым сезоном, без мигания плашки.
export async function readSeason({ maxAgeMs = TTL_MS } = {}) {
  const { mem } = store;
  if (mem.value && Date.now() - mem.at < maxAgeMs) return mem.value;
  const fresh = await Promise.race([refresh(), wait(WAIT_MS)]);
  return fresh || store.mem.value || SEASON_DEFAULT;
}

// Один раз на запрос страницы: layout и страница видят одно и то же значение
export const seasonForRequest = cache(() => readSeason());

// Для админки: текущий сезон, когда и кем включён
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
  store.writtenAt = Date.now();
  store.mem = { value, at: store.writtenAt };
  return { season: value, previous: parseSeason(before?.season) };
}
