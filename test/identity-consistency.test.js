"use strict";
// Integridad del paquete: quien es el contribuyente y de que año es cada declaracion.
//
// Los treinta y seis cruces deterministicos de la revision dan por sentado que las dos
// declaraciones del paquete son del mismo contribuyente y estan a un año de distancia. Nadie
// lo verificaba. Estas pruebas cubren las tres formas en que eso puede ser falso y, sobre
// todo, cubren el caso normal: un paquete bien armado tiene que producir CERO hallazgos, o el
// modulo es ruido. Entidades, numeros y montos ficticios; el layout del texto extraido es el
// que produce pdf.js sobre una declaracion presentada.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  runIdentityChecks, checkPriorReturnYearGap, checkIdentifyingNumberMatches,
  checkStatedYearMatchesReturn, dominantIdentifier, masked,
} = require("../lib/identity-consistency");

/**
 * Una declaracion como sale del extractor: el encabezado con nombre y numero se repite en
 * cada pagina, y en el medio aparecen numeros de terceros — el EIN del empleador, el de la
 * sociedad que emite el K-1 — que no son del contribuyente y no tienen que ganar.
 */
function fakeReturn({ year, id, name = "MERIDIAN HOLDINGS LLC", pages = 30, others = [] }) {
  const out = [`Form 1065 ${year} U.S. Return of Partnership Income OMB No. 1545-0123`,
    `For calendar year ${year}, or tax year beginning , ${year},`];
  for (let page = 1; page <= pages; page += 1) {
    out.push(`--- Page ${page} ---`);
    out.push(`${name} ${id}`);
    out.push(`1 Gross receipts or sales . . . . . . . . . . . 1a 4,812,000.`);
    out.push(`Schedule K-1 ${year} Partner's Share of Income, Deductions, Credits`);
  }
  for (const other of others) out.push(`Payer's TIN ${other}`);
  return out.join("\n");
}

const asFile = (name, text, role) => ({ name, fullText: text, text, reviewRole: role });

const CURRENT = fakeReturn({ year: 2025, id: "27-3513044", others: ["13-4200392", "55-0832550", "13-4200392"] });
const PRIOR = fakeReturn({ year: 2024, id: "27-3513044", others: ["13-4200392"] });
const OTHER_CLIENT = fakeReturn({ year: 2024, id: "45-2577430", name: "CEDAR POINT PARTNERS LP" });

const pack = (cur, pri) => [asFile("2025.pdf", cur, "current_return"), asFile("2024.pdf", pri, "prior_return")];

test("un paquete bien armado no produce ningun hallazgo", () => {
  assert.deepStrictEqual(runIdentityChecks(pack(CURRENT, PRIOR), { taxYear: "2025" }), []);
});

test("el numero dominante es el del encabezado, no el de un tercero", () => {
  const found = dominantIdentifier(CURRENT);
  assert.strictEqual(found.value, "27-3513044");
  assert.ok(found.count >= 30, `esperaba el numero en cada pagina, conte ${found.count}`);
});

test("no decide cuando el numero del contribuyente no le saca margen a otro", () => {
  // Dos numeros con la misma frecuencia: cualquier eleccion seria una adivinanza.
  const empatado = ["11-1111111", "22-2222222"].flatMap((id) => Array(8).fill(`ACME LLC ${id}`)).join("\n");
  assert.strictEqual(dominantIdentifier(empatado), null);
});

test("no decide cuando el numero aparece pocas veces", () => {
  assert.strictEqual(dominantIdentifier("ACME LLC 27-3513044\nnada mas"), null);
});

test("el mismo año dos veces se reporta como HIGH y dice que invalida la continuidad", () => {
  const found = checkPriorReturnYearGap(asFile("a.pdf", CURRENT), asFile("b.pdf", CURRENT));
  assert.ok(found, "esperaba un hallazgo cuando las dos declaraciones son del mismo año");
  assert.strictEqual(found.severity, "HIGH");
  assert.match(found.detail, /mismo año fiscal \(2025\)/);
  assert.match(found.action, /volver a correr la revision/i);
});

test("una brecha de dos años tambien se reporta, con la distancia", () => {
  const dosAtras = fakeReturn({ year: 2023, id: "27-3513044" });
  const found = checkPriorReturnYearGap(asFile("a.pdf", CURRENT), asFile("b.pdf", dosAtras));
  assert.ok(found);
  assert.match(found.detail, /2025 y la adjuntada como año anterior es 2023: 2 años/);
});

test("el año anterior correcto no dispara nada", () => {
  assert.strictEqual(checkPriorReturnYearGap(asFile("a.pdf", CURRENT), asFile("b.pdf", PRIOR)), null);
});

test("una declaracion de otro contribuyente se detecta por el numero", () => {
  const found = checkIdentifyingNumberMatches(asFile("a.pdf", CURRENT), asFile("b.pdf", OTHER_CLIENT));
  assert.ok(found, "esperaba un hallazgo cuando los numeros no coinciden");
  assert.strictEqual(found.severity, "HIGH");
  // El informe muestra solo los ultimos cuatro digitos: el resto no tiene por que estar ahi.
  assert.match(found.detail, /\*\*\*3044/);
  assert.match(found.detail, /\*\*\*7430/);
  assert.ok(!found.detail.includes("27-3513044"), "el numero completo no puede aparecer en el informe");
});

test("el mismo contribuyente en los dos años no dispara nada", () => {
  assert.strictEqual(checkIdentifyingNumberMatches(asFile("a.pdf", CURRENT), asFile("b.pdf", PRIOR)), null);
});

test("un documento ilegible no produce un hallazgo adivinado", () => {
  const ilegible = asFile("escaneado.pdf", "\n\n\n", "prior_return");
  assert.strictEqual(checkIdentifyingNumberMatches(asFile("a.pdf", CURRENT), ilegible), null);
  assert.strictEqual(checkPriorReturnYearGap(asFile("a.pdf", CURRENT), ilegible), null);
});

test("el año elegido en la aplicacion que no coincide se reporta como MEDIUM", () => {
  const found = checkStatedYearMatchesReturn(asFile("a.pdf", CURRENT), { taxYear: "2024" });
  assert.ok(found);
  assert.strictEqual(found.severity, "MEDIUM");
  assert.match(found.detail, /corrio para el año 2024 y la declaracion cargada como corriente es de 2025/);
});

test("sin año elegido no se inventa un desajuste", () => {
  assert.strictEqual(checkStatedYearMatchesReturn(asFile("a.pdf", CURRENT), {}), null);
  assert.strictEqual(checkStatedYearMatchesReturn(asFile("a.pdf", CURRENT), { taxYear: "" }), null);
});

test("sin declaracion anterior el modulo se queda callado", () => {
  const solo = [asFile("2025.pdf", CURRENT, "current_return")];
  assert.deepStrictEqual(runIdentityChecks(solo, { taxYear: "2025" }), []);
});

test("sin archivos no rompe", () => {
  assert.deepStrictEqual(runIdentityChecks([], {}), []);
  assert.deepStrictEqual(runIdentityChecks(null, {}), []);
});

test("el enmascarado deja solo los ultimos cuatro digitos", () => {
  assert.strictEqual(masked("099-72-3045"), "***3045");
  assert.strictEqual(masked("27-3513044"), "***3044");
  assert.strictEqual(masked("12"), "el numero");
});
