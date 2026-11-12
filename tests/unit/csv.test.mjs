// N9: строки CSV выгрузки заказов — кавычки, разделитель, защита от «формул» Excel (CSV injection)
import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, csvLine } from "../../lib/csv.js";

test("обычные значения — как есть, «;», кавычки и переносы — в кавычках", () => {
  assert.equal(csvCell("Минск"), "Минск");
  assert.equal(csvCell("84,90"), "84,90");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell("a;b"), '"a;b"');
  assert.equal(csvCell('Он сказал "да"'), '"Он сказал ""да"""');
  assert.equal(csvCell("две\nстроки"), '"две\nстроки"');
  assert.equal(csvLine(["PP-261112-10023", "12.11.2026 09:33", "Lite", "84,90", "Модерация", "Минск"]), "PP-261112-10023;12.11.2026 09:33;Lite;84,90;Модерация;Минск");
});

test("формулы Excel обезврежены апострофом, отрицательные числа — нет", () => {
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
  assert.equal(csvCell("+375291234567"), "'+375291234567");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvCell("-1+2"), "'-1+2");
  assert.equal(csvCell("-12,50"), "-12,50");
});
