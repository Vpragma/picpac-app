// GET /api/v1/moderation/health — работает ли проверка фото на сервере (N4): модели загружаются и считают.
// Открыт без входа (проверка превью Vercel и мониторинг): прогоняет обе модели на серой картинке 64×64,
// созданной здесь же, — без фото и данных пользователей. Ответ кэшируется в экземпляре на 5 минут,
// не чаще 6 запросов в минуту с одного адреса.
import sharp from "sharp";
import { rateLimited, tooMany } from "@/lib/server/api";
import { clientIp } from "@/lib/server/audit";
import { json, jsonError } from "@/lib/server/http";
import { loadEngine, scoreImage } from "@/lib/server/moderationEngine";
import { findings } from "@/lib/moderation";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

let last = null; // { at, body }

export async function GET(request) {
  if (last && Date.now() - last.at < 5 * 60_000) return json({ ...last.body, cached: true });
  if (await rateLimited(`modhealth:${clientIp(request.headers) || "unknown"}`, 6, 60)) return tooMany(60);
  const t0 = Date.now();
  try {
    await loadEngine();
    const t1 = Date.now();
    const gray = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#808080" } }).png().toBuffer();
    const scores = await scoreImage(gray);
    const body = {
      ok: true,
      engine: "onnxruntime-web (wasm) + sharp",
      models: ["nsfw-image-detection-384 (ViT-tiny)", "clip-vit-base-patch32 int8"],
      version: scores.v,
      sampleFlagged: findings(scores).length > 0,
      ms: { load: t1 - t0, check: Date.now() - t1 },
    };
    last = { at: Date.now(), body };
    return json(body);
  } catch (e) {
    console.error("Проверка модерации на сервере:", e?.message);
    return jsonError(503, "moderation_unavailable", "Проверка фото на сервере сейчас недоступна: заказы с непроверенными фото уходят модератору.");
  }
}
