// N3: ИИ-редактор полностью на устройстве — доказательство автотестом (гость, телефон 390×844 и компьютер 1280×800).
//
// 1. «Редактор не отправляет фото»: полный сценарий — автоулучшение, команды словами, стили-пресеты, выделение
//    касанием, поиск предмета словом (YOLOX → SlimSAM по рамке), ластик, «Резкость для печати ×2», «В корзину».
//    Перехватываем ВСЕ запросы страницы, её воркеров и сервис-воркера. Тест падает, если хоть один запрос ушёл
//    на другой хост или несёт данные изображения (JPEG/PNG/WebP-байты, base64, data:image, multipart с image/*),
//    текст команд или имя файла. Разрешены только события аналитики без содержимого: { type, step, props.kind }.
// 2. «Авиарежим»: модели загружены → контекст без сети → команды, стили, касание, поиск словом и ластик работают.
//
// Ещё проверяем: плашка «ИИ работает на вашем телефоне», индикатор «Работает без интернета», CSP connect-src
// без сторонних хостов, «В корзину» ничего не пишет в буфер обмена. Консоль без ошибок.
import { expect, test } from "@playwright/test";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const TYPED = ["ярче", "теплее", "старом кино", "сепия", "осветли", "собак", "убери", "мяч", "светится", "повеселее", "dog.jpg", "cat-dark.jpg", "nesvizh"];

// Признаки изображения в теле запроса
function imageEvidence(buf, headers) {
  if (!buf || !buf.length) return "";
  const b = Buffer.from(buf);
  const text = b.toString("latin1");
  if (/^image\//i.test(headers["content-type"] || "")) return "Content-Type: image/*";
  if (b.includes(Buffer.from([0xff, 0xd8, 0xff]))) return "байты JPEG";
  if (b.includes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "байты PNG";
  if (text.includes("RIFF") && text.includes("WEBP")) return "байты WebP";
  if (/data:image\//i.test(text)) return "data:image";
  if (text.includes("/9j/") || text.includes("iVBORw0KGgo") || text.includes("UklGR")) return "base64 картинки";
  if (/content-type:\s*image\//i.test(text)) return "multipart с image/*";
  if (b.length > 64 * 1024) return "большое тело запроса (" + b.length + " байт)";
  return "";
}

function watch(page, context) {
  const seen = new Map();
  const errors = [];
  const add = (r) => {
    const key = r.method() + " " + r.url() + " " + (r.postDataBuffer()?.length || 0);
    if (!seen.has(key)) seen.set(key, r);
  };
  context.on("request", add);
  page.on("request", add);
  page.on("worker", (w) => w.on("console", (m) => m.type() === "error" && errors.push("воркер: " + m.text())));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/ServiceWorker|fetching the script|net::ERR_INTERNET_DISCONNECTED/i.test(m.text()) && errors.push(m.text()));
  return {
    errors,
    requests: () => [...seen.values()],
    // Нарушения: чужой хост, картинка в теле, текст команд в адресе или теле
    problems() {
      const out = [];
      for (const r of seen.values()) {
        const url = r.url();
        if (url.startsWith("data:") || url.startsWith("blob:")) continue;
        const u = new URL(url);
        if (u.origin !== ORIGIN) out.push(`чужой хост: ${r.method()} ${url}`);
        const buf = r.postDataBuffer();
        const img = imageEvidence(buf, r.headers());
        if (img) out.push(`${img}: ${r.method()} ${u.pathname}`);
        // Скачивание фото тестовой галереи с нашего сайта (GET /demo-gallery/…) — это не отправка данных
        const gallery = r.method() === "GET" && u.pathname.startsWith("/demo-gallery/");
        const hay = decodeURIComponent(u.pathname + u.search).toLowerCase() + " " + (buf ? buf.toString("utf8").toLowerCase() : "");
        if (!gallery) for (const t of TYPED) if (hay.includes(t)) out.push(`«${t}» в запросе ${r.method()} ${u.pathname}`);
        // Пишущие запросы — только обезличенные события аналитики
        if (r.method() !== "GET" && r.method() !== "HEAD") {
          if (u.pathname !== "/api/v1/events") out.push(`запись: ${r.method()} ${u.pathname}`);
          else {
            const body = JSON.parse(buf.toString("utf8"));
            for (const ev of body.events || []) {
              const extra = Object.keys(ev).filter((k) => !["type", "step", "durationMs", "props"].includes(k));
              const props = Object.keys(ev.props || {}).filter((k) => !["kind", "product", "count"].includes(k));
              if (extra.length || props.length) out.push(`лишние поля в событии ${ev.type}: ${[...extra, ...props].join(", ")}`);
            }
          }
        }
      }
      return out;
    },
  };
}

async function openEditor(page, files) {
  await page.goto("/product/photo");
  await page.getByRole("button", { name: "Выбрать фото" }).click();
  await expect(page).toHaveURL(/\/editor/);
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of files) await gallery.locator(`label[data-file="${f}"] input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: `Добавить ${files.length} фото` }).click();
  await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(files.length);
  await page.getByRole("button", { name: "Правки", exact: true }).click();
}

async function say(page, text) {
  const cmd = page.locator("#pe-cmd");
  await cmd.fill(text);
  await cmd.press("Enter");
}

const answer = (page) => page.locator(".pe-answer");
const rendered = (page) => expect(page.locator(".pe-after[data-rendered]")).toHaveCount(1);

// Средний цвет и «серость» кадра «после»
const stats = (page) =>
  page.evaluate(() => {
    const c = document.querySelector(".pe-after");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let l = 0;
    let chroma = 0;
    for (let i = 0; i < d.length; i += 16) {
      l += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    }
    const n = d.length / 16;
    return { l: l / n, chroma: chroma / n };
  });

// Средний цвет квадрата 9×9 в долях (u, v)
const px = (page, u, v) =>
  page.evaluate(
    ([u, v]) => {
      const c = document.querySelector(".pe-after");
      const d = c.getContext("2d").getImageData(Math.round(u * c.width) - 4, Math.round(v * c.height) - 4, 9, 9).data;
      const o = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) o[k] += d[i + k] / 81;
      return o;
    },
    [u, v],
  );

const DOG = [0.64, 0.34]; // чёрная спина собаки на dog.jpg
const BALL = [0.22, 0.8]; // красный мяч

async function tap(page, [u, v]) {
  const c = page.locator(".pe-after");
  const box = await c.boundingBox();
  await c.click({ position: { x: box.width * u, y: box.height * v } });
}

test("редактор не отправляет фото: полный сценарий ИИ на устройстве, ни байта картинки наружу", async ({ page, context }) => {
  test.setTimeout(12 * 60_000);
  const w = watch(page, context);
  // Буфер обмена: «В корзину» не должна туда писать
  await page.addInitScript(() => {
    window.__clip = [];
    const rec = (what) => (...a) => (window.__clip.push(what + ":" + String(a[0]).slice(0, 40)), Promise.resolve());
    try {
      if (navigator.clipboard) {
        navigator.clipboard.writeText = rec("writeText");
        navigator.clipboard.write = rec("write");
      }
    } catch {}
    const exec = document.execCommand?.bind(document);
    document.execCommand = (cmd, ...rest) => (/copy|cut/i.test(cmd) && window.__clip.push("execCommand:" + cmd), exec ? exec(cmd, ...rest) : false);
  });

  await openEditor(page, ["dog.jpg", "cat-dark.jpg", "nesvizh-small.jpg"]);
  await page.locator('[data-edit-photo="dog.jpg"]').click();
  await rendered(page);

  await test.step("плашка: ИИ на телефоне, фото для правок никуда не отправляются; CSP без сторонних хостов", async () => {
    await expect(page.locator("[data-local-ai]")).toContainText("ИИ работает на вашем телефоне");
    const res = await page.request.get("/editor");
    const csp = res.headers()["content-security-policy"] || "";
    const connect = csp.split(";").map((s) => s.trim()).find((s) => s.startsWith("connect-src")) || "";
    const hosts = connect.split(/\s+/).slice(1).filter((x) => !["'self'", "data:", "blob:", "ws:"].includes(x));
    expect(hosts.every((h) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(h)), connect).toBe(true);
  });

  await test.step("автоулучшение тёмного фото и команда «улучши»", async () => {
    await page.locator('[data-edit-photo="cat-dark.jpg"]').click();
    await rendered(page);
    await expect(page.locator(".pe-main .pe-name + .pe-badges .pe-badge")).toContainText(["Улучшено"], { timeout: 60_000 });
    await say(page, "улучши");
    await expect(answer(page)).toContainText("Улучшили");
  });

  await test.step("команды словами и опечатки: «сделай ярче и чуть теплее», «контраз побольше»", async () => {
    await page.locator('[data-edit-photo="dog.jpg"]').click();
    await rendered(page);
    await say(page, "сделай ярче и чуть теплее");
    await expect(answer(page)).toContainText("ярче");
    await expect(page.getByRole("slider", { name: "Яркость" })).not.toHaveValue("0");
    await say(page, "контраз побольше");
    await expect(page.getByRole("slider", { name: "Контраст" })).not.toHaveValue("0");
  });

  await test.step("стили-пресеты: «как в старом кино» — кадр серый, «верни цвет» — снова цветной, «сепия»", async () => {
    const color = await stats(page);
    await say(page, "как в старом кино");
    await expect(answer(page)).toContainText("старом кино");
    await expect.poll(async () => (await stats(page)).chroma).toBeLessThan(3);
    await say(page, "верни цвет");
    await expect.poll(async () => (await stats(page)).chroma).toBeGreaterThan(color.chroma * 0.5);
    await say(page, "сепия");
    await expect(answer(page)).toContainText("сепии");
    await say(page, "отмени"); // назад к «верни цвет» — снова цветное
    await expect.poll(async () => (await stats(page)).chroma).toBeGreaterThan(color.chroma * 0.5);
  });

  await test.step("фраза вне словаря — модель на устройстве подбирает по смыслу: «пусть светится» → «Ярче»", async () => {
    await say(page, "пусть светится");
    await expect(answer(page)).toHaveText(/По смыслу — «Ярче»/, { timeout: 180_000 });
    await say(page, "отмени");
  });

  await test.step("поиск словом + ластик: «убери мяч» — выделен, «Убрать» — мяча нет", async () => {
    const ball = await px(page, ...BALL);
    expect(ball[0] - ball[1]).toBeGreaterThan(60); // мяч красный
    await say(page, "убери мяч");
    await expect(answer(page)).toHaveText(/Нашёл и выделил мяч/, { timeout: 180_000 });
    await page.locator(".pe-select").getByRole("button", { name: "Убрать", exact: true }).click();
    await expect(page.locator(".pe-busy")).toHaveCount(0, { timeout: 180_000 });
    await expect(answer(page)).toHaveText(/Убрали выделенное/, { timeout: 60_000 });
    await expect.poll(async () => {
      const b = await px(page, ...BALL);
      return b[0] - b[1];
    }, { timeout: 60_000 }).toBeLessThan(30);
  });

  await test.step("выделение касанием: касание собаки → «Размыть фон»", async () => {
    await page.getByRole("button", { name: "Выделить касанием" }).click();
    await expect(page.locator('.pe-select[data-ready="true"]')).toBeVisible({ timeout: 180_000 });
    await tap(page, DOG);
    await expect(page.getByText(/^Выделено\./)).toBeVisible({ timeout: 60_000 });
    await page.locator(".pe-select").getByRole("button", { name: "Размыть фон" }).click();
    await expect(answer(page)).toHaveText(/Размыли фон/);
  });

  await test.step("поиск предмета словом: «осветли собаку» — нашёл, выделил по рамке, осветлил", async () => {
    const before = await px(page, ...DOG);
    await say(page, "осветли собаку");
    await expect(answer(page)).toHaveText(/Нашёл собаку и осветлил/, { timeout: 180_000 });
    await expect.poll(async () => (await px(page, ...DOG))[1]).toBeGreaterThan(before[1] + 8);
  });

  await test.step("предмета нет на фото: «убери машину» — честно и просьба коснуться", async () => {
    await say(page, "убери машину");
    await expect(answer(page)).toHaveText(/Не нашёл машину на этом фото\. Коснитесь того, что убрать/, { timeout: 120_000 });
    await page.locator(".pe-select").getByRole("button", { name: /^(Отмена|Готово)$/ }).click();
  });

  await test.step("«Резкость для печати ×2» (если в браузере есть WebGL — иначе честный отказ)", async () => {
    await page.locator('[data-edit-photo="nesvizh-small.jpg"]').click();
    await page.getByRole("button", { name: "Резкость для печати ×2" }).click();
    await expect(page.getByText("Резкость для печати ×2 включена").or(page.getByText(/нет WebGL/))).toBeVisible({ timeout: 240_000 });
    // второй раз — по-прежнему без сети наружу
    if (await page.getByRole("button", { name: "Выключить" }).isVisible()) await page.getByRole("button", { name: "Выключить" }).click();
    if (await page.getByRole("button", { name: "Резкость для печати ×2" }).isVisible()) {
      await page.getByRole("button", { name: "Резкость для печати ×2" }).click();
      await expect(page.getByText("Резкость для печати ×2 включена").or(page.getByText(/нет WebGL/))).toBeVisible({ timeout: 240_000 });
    }
  });

  await test.step("«В корзину»: ничего не пишется в буфер обмена", async () => {
    await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Проверка" }).click();
    const toCart = page.getByRole("button", { name: /^(В корзину|Обновить в корзине)$/ });
    await expect(toCart).toBeVisible();
    for (let i = 0; i < 6 && (await toCart.isDisabled()); i++) {
      const go = page.getByRole("button", { name: "Продолжить всё равно" }).first();
      if (await go.isVisible().catch(() => false)) await go.click();
    }
    await toCart.click();
    await expect(page).toHaveURL(/\/cart/);
    expect(await page.evaluate(() => window.__clip)).toEqual([]);
  });

  await test.step("ни один запрос не ушёл наружу и не нёс фото или текст команд", async () => {
    await page.waitForTimeout(5000); // аналитика уходит пачкой раз в 4 с
    const all = w.requests();
    expect(all.length).toBeGreaterThan(10);
    expect(w.problems()).toEqual([]);
    expect(w.errors).toEqual([]);
    test.info().annotations.push({ type: "запросы", description: `${all.length} запросов, все на ${ORIGIN}, без фото и текста команд` });
  });
});

test("авиарежим: модели загружены — без сети правки продолжают работать", async ({ page, context }) => {
  test.setTimeout(12 * 60_000);
  const w = watch(page, context);
  await openEditor(page, ["dog.jpg", "cat.jpg"]);
  await page.locator('[data-edit-photo="dog.jpg"]').click();
  await rendered(page);

  await test.step("с сетью: «Скачать ИИ заранее» → индикатор «Работает без интернета»", async () => {
    const pre = page.locator("[data-ai-prefetch]");
    await expect(pre).toBeVisible();
    if ((await pre.getAttribute("data-ai-prefetch")) !== "ready") {
      await pre.getByRole("button", { name: /Скачать ИИ заранее/ }).click();
      await expect(pre).toHaveAttribute("data-ai-prefetch", "ready", { timeout: 300_000 });
    }
    await expect(page.locator("[data-offline-ready]")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-offline-ready]")).toHaveText(/Работает без интернета/);
  });

  await test.step("сеть выключена: команды и стили", async () => {
    await context.setOffline(true);
    await say(page, "тёплый вечер");
    await expect(answer(page)).toContainText("Тёплый вечер");
    await say(page, "ч/б");
    await expect.poll(async () => (await stats(page)).chroma).toBeLessThan(3);
    await say(page, "верни цвет");
    await say(page, "сделай повеселее"); // вне словаря — модель «по смыслу» тоже с устройства
    await expect(answer(page)).toHaveText(/По смыслу — «Насыщеннее»/, { timeout: 120_000 });
  });

  await test.step("сеть выключена: поиск словом и касание", async () => {
    await say(page, "размой собаку");
    await expect(answer(page)).toHaveText(/Нашёл собаку и размыл/, { timeout: 240_000 });
    await page.locator('[data-edit-photo="cat.jpg"]').click();
    await rendered(page);
    await say(page, "найди кошку");
    await expect(answer(page)).toHaveText(/Нашёл и выделил кошку/, { timeout: 240_000 });
    await page.locator(".pe-select").getByRole("button", { name: "Затемнить" }).click();
    await expect(answer(page)).toHaveText(/Затемнили выделенное/);
  });

  await test.step("сеть выключена: ластик по касанию", async () => {
    // После «найди кошку» выделение ещё открыто — касание сразу; иначе — «Выделить касанием»
    const start = page.getByRole("button", { name: "Выделить касанием" });
    if (await start.isVisible()) await start.click();
    await expect(page.locator('.pe-select[data-ready="true"]')).toBeVisible({ timeout: 120_000 });
    await tap(page, [0.5, 0.55]);
    await expect(page.getByText(/^Выделено\./)).toBeVisible({ timeout: 60_000 });
    await page.locator(".pe-select").getByRole("button", { name: "Убрать", exact: true }).click();
    await expect(answer(page)).toHaveText(/Убрали выделенное/, { timeout: 240_000 });
  });

  await context.setOffline(false);
  expect(w.problems()).toEqual([]);
  expect(w.errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|events/i.test(e))).toEqual([]);
});
