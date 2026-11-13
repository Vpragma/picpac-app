// N11 · шаблоны оформления книги и обложка: автомакет учитывает поля шаблона (все фото на местах, ничего не вылезает,
// фото не налезают друг на друга), нормализация выбора (неизвестное → «Классика», длина названия и даты, невидимые
// символы), сохранение в настройках проекта (устройство ⇄ аккаунт) и снимок для заказа, «Осень» первой в сезон.
import assert from "node:assert/strict";
import { test } from "node:test";
import { autoLayout } from "../../lib/layout.js";
import { runChecks } from "../../lib/checks.js";
import {
  BOOK_TEMPLATES,
  COVER_LAYOUTS,
  DATE_MAX,
  TITLE_MAX,
  bookForOrder,
  bookFromSettings,
  bookTemplate,
  bookToSettings,
  initialBook,
  layoutOptions,
  normBook,
  templatesInOrder,
} from "../../lib/book.js";

const EPS = 1e-9;
// Набор фото: горизонтальные, вертикальные и квадратные вперемешку
const photos = (n) =>
  Array.from({ length: n }, (_, i) => {
    const kind = i % 3;
    return { id: "p" + i, name: `p${i}.jpg`, supported: true, w: kind === 0 ? 4000 : kind === 1 ? 3000 : 3000, h: kind === 0 ? 3000 : kind === 1 ? 4000 : 3000 };
  });

function overlap(a, b) {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

test("шаблоны: пять штук с названиями, поля и зазоры в разумных пределах", () => {
  assert.deepEqual(
    BOOK_TEMPLATES.map((t) => t.name),
    ["Классика", "Осень", "Свадьба", "Малыш", "Путешествие"],
  );
  for (const t of BOOK_TEMPLATES) {
    assert.ok(t.margin >= 0.05 && t.margin <= 0.15, `${t.id}: поле ${t.margin}`);
    assert.ok(t.gap >= 0.02 && t.gap <= 0.06, `${t.id}: зазор ${t.gap}`);
    assert.ok(t.hint && !/данн|осуществ|являет/i.test(t.hint), `${t.id}: подсказка без канцелярита`);
  }
  assert.equal(COVER_LAYOUTS.length, 3);
});

test("автомакет с каждым шаблоном: все фото на местах, внутри полей, без наложений", () => {
  for (const t of BOOK_TEMPLATES) {
    for (const [count, pages] of [
      [1, 20],
      [7, 20],
      [20, 20],
      [33, 20],
      [60, 20],
      [61, 30],
    ]) {
      const list = photos(count);
      const { pages: out, overflow } = autoLayout(list, pages, layoutOptions({ template: t.id }));
      assert.equal(out.length, pages, `${t.id}: число страниц`);
      assert.equal(overflow.length, Math.max(0, count - pages * 3), `${t.id}: ${count} фото на ${pages} стр.`);
      const placed = out.flatMap((p) => p.slots.map((s) => s.photoId));
      assert.deepEqual(placed, list.slice(0, Math.min(count, pages * 3)).map((p) => p.id), `${t.id}: порядок и ни одного потерянного фото`);
      for (const pg of out) {
        assert.ok(pg.slots.length <= 3);
        for (const s of pg.slots) {
          assert.ok(s.x >= t.margin - EPS && s.y >= t.margin - EPS, `${t.id}: место начинается в поле`);
          assert.ok(s.x + s.w <= 1 - t.margin + EPS && s.y + s.h <= 1 - t.margin + EPS, `${t.id}: место вылезает за поле`);
          assert.ok(s.w > 0.2 && s.h > 0.2, `${t.id}: место не слишком мелкое`);
        }
        for (let i = 0; i < pg.slots.length; i++)
          for (let j = i + 1; j < pg.slots.length; j++) assert.ok(!overlap(pg.slots[i], pg.slots[j]), `${t.id}: фото налезают друг на друга`);
      }
    }
  }
});

test("автомакет: поля шаблона меняют раскладку, без шаблона — как раньше («Классика»)", () => {
  const list = photos(2);
  const plain = autoLayout(list, 2);
  const classic = autoLayout(list, 2, layoutOptions({ template: "classic" }));
  const wedding = autoLayout(list, 2, layoutOptions({ template: "wedding" }));
  assert.deepEqual(plain, classic);
  assert.equal(plain.pages[0].slots[0].x, 0.06);
  assert.equal(wedding.pages[0].slots[0].x, 0.11);
  assert.ok(wedding.pages[0].slots[0].w < plain.pages[0].slots[0].w);
});

test("проверка перед заказом берёт поля шаблона из проекта", () => {
  const product = { kind: "book", sizes: [{ id: "20x20", w: 20, h: 20 }], pages: { min: 20, max: 100 }, slug: "layflat" };
  const draft = { photos: photos(5), pages: 20, sizeId: "20x20", book: { template: "travel" } };
  const { layout } = runChecks(draft, product);
  assert.equal(layout.pages[0].slots[0].x, bookTemplate("travel").margin);
  const { layout: noBook } = runChecks({ ...draft, book: undefined }, product);
  assert.equal(noBook.pages[0].slots[0].x, 0.06);
});

test("нормализация: неизвестный шаблон и вариант → умолчания, длина и невидимые символы", () => {
  assert.deepEqual(normBook(undefined), { template: "classic", cover: { title: "", date: "", layout: "photo" } });
  assert.deepEqual(normBook({ template: "<script>", cover: { layout: "x", title: 5 } }), { template: "classic", cover: { title: "", date: "", layout: "photo" } });
  const b = normBook({ template: "autumn", cover: { title: "  Лето‮ у\u0000 бабушки\n ", date: "август 2026", layout: "full" } });
  assert.deepEqual(b, { template: "autumn", cover: { title: "Лето у бабушки", date: "август 2026", layout: "full" } });
  const long = normBook({ cover: { title: "я".repeat(100), date: "1".repeat(100) } });
  assert.equal(Array.from(long.cover.title).length, TITLE_MAX);
  assert.equal(long.cover.date.length, DATE_MAX);
  // эмодзи не режется посередине
  assert.equal(Array.from(normBook({ cover: { title: "📷".repeat(50) } }).cover.title).length, TITLE_MAX);
});

test("сохранение выбора: проект → настройки аккаунта → другое устройство — то же оформление", () => {
  assert.equal(bookToSettings(undefined), undefined, "у проекта без выбора настройки не меняются (нет лишней синхронизации)");
  const local = { template: "baby", cover: { title: "Первый год ", date: "2026", layout: "title" } };
  const settings = { quantity: 1, book: bookToSettings(local) };
  const json = JSON.parse(JSON.stringify(settings)); // как в базе (jsonb)
  assert.deepEqual(bookFromSettings(json), { template: "baby", cover: { title: "Первый год", date: "2026", layout: "title" } });
  assert.equal(bookFromSettings({ quantity: 1 }), undefined);
});

test("снимок для заказа: шаблон с полями автомакета и обложка; без выбора — «Классика»", () => {
  const snap = bookForOrder({ size: "20x20", settings: { book: { template: "autumn", cover: { title: "Осень", date: "2026", layout: "full" } } } });
  assert.deepEqual(snap, {
    template: "autumn",
    templateName: "Осень",
    margin: 0.1,
    gap: 0.035,
    cover: { title: "Осень", date: "2026", layout: "full", layoutName: "Фото на всю обложку" },
  });
  assert.equal(bookForOrder({}).template, "classic");
  assert.equal(bookForOrder(null).cover.layoutName, "Фото и подпись");
});

test("сезон «Осень»: осенний шаблон первым и предложен в новом проекте, в другие сезоны — нет", () => {
  assert.equal(templatesInOrder("autumn")[0].id, "autumn");
  assert.equal(templatesInOrder("autumn").length, BOOK_TEMPLATES.length);
  assert.equal(templatesInOrder("none")[0].id, "classic");
  assert.equal(templatesInOrder("newyear")[0].id, "classic");
  assert.equal(initialBook("autumn").template, "autumn");
  assert.equal(initialBook("none"), null);
  assert.equal(initialBook("blackfriday"), null);
});

test("строка оформления для экранов заказа: шаблон, вариант обложки, название и дата; мусор не ломает", async () => {
  const { bookSummary } = await import("../../lib/book.js");
  const snap = bookForOrder({ settings: { book: { template: "wedding", cover: { title: "Наша свадьба", date: "июнь 2026", layout: "title" } } } });
  assert.equal(bookSummary(snap), "Оформление «Свадьба» · обложка «Только название»: «Наша свадьба», июнь 2026");
  assert.equal(bookSummary(bookForOrder({})), "Оформление «Классика» · обложка «Фото и подпись»");
  assert.equal(bookSummary({ template: "zzz", cover: "x" }), "Оформление «Классика» · обложка «Фото и подпись»");
  assert.equal(bookSummary(null), "");
});
