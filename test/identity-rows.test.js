"use strict";
// La tabla de identificadores, generada por codigo en vez de afirmada por el modelo.
//
// El estudio quiere ver la tabla completa y no solo las excepciones. Eso es razonable, pero
// una fila que dice "MATCH" escrita por un modelo es una afirmacion que puede estar mal — en
// una corrida documentada dos de ellas lo estaban. Estas pruebas fijan que las cuatro filas que
// se pueden decidir con una comparacion de texto las decida el codigo, y que cuando el codigo
// no puede leer un lado NO invente un MATCH. Entidades y numeros ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { identityRows, dominantName, COMPUTED_ITEMS } = require("../lib/identity-consistency");

function fakeReturn({ year, id, name = "MERIDIAN HOLDINGS LLC", pages = 30 }) {
  const out = [`Form 1065 ${year} U.S. Return of Partnership Income`, `For calendar year ${year}, or tax year beginning , ${year},`];
  for (let page = 1; page <= pages; page += 1) {
    out.push(`--- Page ${page} ---`);
    out.push(`${name} ${id}`);
    out.push(`1 Gross receipts or sales . . . . . . . . . . . 1a 4,812,000.`);
    out.push(`Schedule K-1 ${year} Partner's Share of Income`);
  }
  return out.join("\n");
}
const asFile = (name, text, role) => ({ name, fullText: text, text, reviewRole: role });

const CUR = fakeReturn({ year: 2025, id: "27-3513044" });
const PRI = fakeReturn({ year: 2024, id: "27-3513044" });
const pack = (cur, pri) => [asFile("2025.pdf", cur, "current_return"), asFile("2024.pdf", pri, "prior_return")];
const byItem = (rows, needle) => rows.find((r) => r.item.toLowerCase().includes(needle));

test("un paquete correcto produce las cuatro filas, todas MATCH", () => {
  const rows = identityRows(pack(CUR, PRI), { taxYear: "2025" });
  assert.strictEqual(rows.length, 4);
  for (const row of rows) assert.strictEqual(row.status, "MATCH", `${row.item} deberia coincidir`);
  // La tabla completa es el punto: el estudio tiene que VER que se verifico, no un conteo.
  for (const item of COMPUTED_ITEMS) {
    assert.ok(rows.some((r) => r.item === item), `falta la fila "${item}"`);
  }
});

test("cada fila trae los dos valores comparados, no solo el veredicto", () => {
  for (const row of identityRows(pack(CUR, PRI), { taxYear: "2025" })) {
    assert.ok(String(row.returnValue).length > 0, `${row.item} sin valor de la declaracion`);
    assert.ok(String(row.sourceValue).length > 0, `${row.item} sin valor de contraste`);
    assert.ok(String(row.note).length > 10, `${row.item} sin nota`);
    assert.match(row.source, /\S/);
  }
});

test("el numero de identificacion sale enmascarado, nunca completo", () => {
  const row = byItem(identityRows(pack(CUR, PRI), { taxYear: "2025" }), "identifying number");
  assert.match(row.returnValue, /^\*\*\*\d{4}$/);
  assert.ok(!JSON.stringify(row).includes("27-3513044"), "el numero completo no puede aparecer");
});

test("un numero distinto entre años se reporta MISMATCH", () => {
  const otro = fakeReturn({ year: 2024, id: "45-2577430", name: "CEDAR POINT PARTNERS LP" });
  const rows = identityRows(pack(CUR, otro), { taxYear: "2025" });
  assert.strictEqual(byItem(rows, "identifying number").status, "MISMATCH");
});

test("un nombre distinto entre años se reporta MISMATCH, aunque sea una inicial", () => {
  // Caso real del corpus: "VONNA TAYLOR" un año y "VONNA L TAYLOR" el otro. El name control
  // del e-file se arma con el nombre, asi que una inicial importa.
  const conInicial = fakeReturn({ year: 2024, id: "27-3513044", name: "MERIDIAN L HOLDINGS LLC" });
  const rows = identityRows(pack(CUR, conInicial), { taxYear: "2025" });
  const row = byItem(rows, "name");
  assert.strictEqual(row.status, "MISMATCH");
  assert.match(row.note, /name control/i);
});

test("el mismo año dos veces se reporta MISMATCH en la fila de distancia", () => {
  const rows = identityRows(pack(CUR, CUR), { taxYear: "2025" });
  const row = byItem(rows, "immediately preceding");
  assert.strictEqual(row.status, "MISMATCH");
  assert.match(row.note, /0 year\(s\) apart|unreliable/i);
});

test("el año elegido en la app que no coincide se reporta MISMATCH", () => {
  const rows = identityRows(pack(CUR, PRI), { taxYear: "2024" });
  assert.strictEqual(byItem(rows, "tax year on the return").status, "MISMATCH");
});

test("sin declaracion anterior solo sale la fila que no la necesita", () => {
  const rows = identityRows([asFile("2025.pdf", CUR, "current_return")], { taxYear: "2025" });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].item, "Tax year on the return");
});

test("un documento ilegible no produce una fila que diga MATCH", () => {
  const ilegible = asFile("escaneado.pdf", "\n\n\n", "prior_return");
  const rows = identityRows([asFile("2025.pdf", CUR, "current_return"), ilegible], { taxYear: "2025" });
  assert.ok(!rows.some((r) => r.item.includes("identifying number")), "sin poder leer el otro lado no se afirma nada");
  assert.ok(!rows.some((r) => r.item.includes("name")));
});

test("sin archivos no rompe", () => {
  assert.deepStrictEqual(identityRows([], {}), []);
  assert.deepStrictEqual(identityRows(null, {}), []);
});

test("el nombre se decide contando, y no decide cuando no hay margen", () => {
  assert.strictEqual(dominantName(CUR, "27-3513044").value, "MERIDIAN HOLDINGS LLC");
  // Dos nombres pegados al mismo numero con frecuencia pareja: cualquier eleccion es una
  // adivinanza, y adivinar es lo que este modulo existe para no hacer.
  const empate = [...Array(10)].map(() => "ACME ALPHA LLC 27-3513044").concat(
    [...Array(9)].map(() => "ACME BETA LLC 27-3513044")).join("\n");
  assert.strictEqual(dominantName(empate, "27-3513044"), null);
});

test("el nombre no se confunde con el encabezado del formulario", () => {
  const conFormulario = [...Array(12)].map((_, i) =>
    `Form 1065 (2025) MERIDIAN HOLDINGS LLC 27-3513044 Page ${i + 1}`).join("\n");
  assert.strictEqual(dominantName(conFormulario, "27-3513044").value, "MERIDIAN HOLDINGS LLC");
});
