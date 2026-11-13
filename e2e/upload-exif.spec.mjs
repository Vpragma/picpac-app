// N3: фото уходит в наше хранилище без EXIF и GPS (вошедший клиент). Файл с ориентацией 6 («снято боком»), GPS,
// XMP, комментарием и «хвостом» после кадра → в хранилище: ни одного из них, кадр уже повёрнут (портрет),
// размеры в базе — как у повёрнутого кадра. Пользователь e2e-…@example.com удаляется вместе с файлами.
import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { sniffImage } from "../lib/imageMeta.js";
import { hasPhotoMeta } from "../lib/photo/stripMeta.js";
import { jpegWithMeta } from "../tests/helpers/exif.mjs";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

test("фото в хранилище — без EXIF и GPS, ориентация перенесена в пиксели", async ({ page }, info) => {
  test.skip(info.project.name.startsWith("телефон"), "проверка хранилища: одного устройства достаточно");
  test.setTimeout(6 * 60_000);
  const admin = supabaseAdmin();
  const user = await createTestUser(admin, ["client"], "e2eexif" + Date.now().toString(36).slice(-4));
  try {
    const base = new Uint8Array(readFileSync(new URL("../tests/fixtures/nesvizh-1600.jpg", import.meta.url)));
    const raw = sniffImage(base); // 1600×1098 — пейзаж
    const file = info.outputPath("gps-photo.jpg");
    const withMeta = jpegWithMeta(base, 6);
    writeFileSync(file, withMeta);
    expect(hasPhotoMeta(withMeta)).toBe(true);

    await page.goto("/login");
    await page.getByLabel("Почта").fill(user.email);
    await page.getByLabel("Пароль", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.goto("/product/photo");
    await page.getByRole("button", { name: "Выбрать фото" }).click();
    await expect(page).toHaveURL(/\/editor/);
    await page.locator("input[type=file]").setInputFiles(file);
    await expect(page.locator('.photo-cell[data-photo="gps-photo.jpg"] [data-upload]')).toHaveText("Загружено", { timeout: 240_000 });

    const { data: projects } = await admin.from("projects").select("id").eq("user_id", user.id);
    const { data: photos } = await admin.from("project_photos").select("storage_path, width, height").in("project_id", projects.map((p) => p.id));
    expect(photos).toHaveLength(1);
    const { data: blob, error } = await admin.storage.from("photos").download(photos[0].storage_path);
    expect(error).toBeNull();
    const stored = new Uint8Array(await blob.arrayBuffer());
    const text = Buffer.from(stored).toString("latin1");
    expect(text.includes("Exif")).toBe(false);
    expect(text.includes("GPS")).toBe(false);
    expect(text.includes("xmpmeta")).toBe(false);
    expect(text.includes("SEFT")).toBe(false);
    expect(hasPhotoMeta(stored)).toBe(false);
    // Ориентация 6 — поворот на 90°: в хранилище уже портрет, и в базе те же размеры
    const meta = sniffImage(stored);
    expect([meta.width, meta.height]).toEqual([raw.height, raw.width]);
    expect([photos[0].width, photos[0].height]).toEqual([raw.height, raw.width]);
  } finally {
    await deleteTestUser(admin, user);
  }
});
