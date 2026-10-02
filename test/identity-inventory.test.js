"use strict";
// El cruce de todos los SSN y EIN del paquete (lib/identity-inventory.js). La Review comparaba
// una docena de datos del encabezado; esto cruza cada persona de la declaracion contra el año
// anterior, el SSN y el nombre de cada documento, y el EIN de cada K-1. Personas, numeros y
// entidades ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { identityInventoryRows, oneSlipApart, nameFor } = require("../lib/identity-inventory");

const TP = "400-00-1111";
const SP = "400-00-2222";
const KID = "400-00-3333";
const FUND_EIN = "12-3456789";

function fakeReturn(year, { extraLines = [], kid = true, oldKid = false } = {}) {
  const out = [`Form 1040 ${year} U.S. Individual Income Tax Return`];
  for (let page = 1; page <= 6; page += 1) {
    out.push(`--- Page ${page} ---`, `JOHN Q SAMPLE AND JANE R SAMPLE ${TP}`);
  }
  out.push(`JANE R SAMPLE ${SP}`, `JANE R SAMPLE ${SP}`, `JANE R SAMPLE ${SP}`);
  if (kid) out.push(`10c TIMMY SAMPLE ${KID} SON`, `10c TIMMY SAMPLE ${KID} SON`);
  if (oldKid) out.push(`10d SALLY SAMPLE 400-00-4444 DAUGHTER`, `10d SALLY SAMPLE 400-00-4444 DAUGHTER`);
  out.push(`Schedule E Part II ACME FUND LP P ${FUND_EIN} 12,500.`);
  return [...out, ...extraLines].join("\n");
}
const file = (name, text, role = "supporting_document") => ({ name, text, fullText: text, reviewRole: role });
const pack = (current, prior, docs = []) => [file("2025.pdf", current, "current_return"), file("2024.pdf", prior, "prior_return"), ...docs];
const K1 = (entity, ein, partnerTin, partnerName) => `Schedule K-1 (Form 1065) 2025 Partner's Share of Income, Deductions, Credits
A Partnership's employer identification number ${ein}
B ${entity}
E Partner's identifying number ${partnerTin}
F ${partnerName}`;

test("un paquete en orden: ninguna diferencia y la fila de alcance con la cuenta exacta", () => {
  const docs = [
    file("W-2 John.pdf", `Form W-2 Wage and Tax Statement 2025\na Employee's SSN ${TP}\nJOHN Q SAMPLE`),
    file("K-1 Acme.pdf", K1("ACME FUND LP", FUND_EIN, TP, "JOHN Q SAMPLE")),
  ];
  const rows = identityInventoryRows(pack(fakeReturn(2025), fakeReturn(2024), docs), { taxYear: "2025" });
  assert.deepStrictEqual(rows.map((r) => r.status), ["MATCH"]);
  const scope = rows[0];
  assert.strictEqual(scope.item, "Identifiers verified by code");
  // 3 personas + 2 documentos con SSN de la declaracion + 1 nombre (el W-2; el K-1 no se exige) + 1 K-1.
  assert.match(scope.note, /^7 — SSNs matching the prior-year return: 3; documents whose SSN is on the return: 2; documents carrying the name the return prints: 1; K-1s whose EIN is on the return: 1\./);
});

test("un SSN a un digito de otro conocido es un error de tipeo", () => {
  const current = fakeReturn(2025, { extraLines: ["Form 8606 JOHN Q SAMPLE 400-00-1112"] });
  const rows = identityInventoryRows(pack(current, fakeReturn(2024)), { taxYear: "2025" });
  const typo = rows.find((r) => r.status === "MISMATCH");
  assert.strictEqual(typo.item, "SSN ***1112 on the return");
  assert.strictEqual(typo.sourceValue, "***1111");
  assert.match(typo.note, /typo/);
  assert.ok(!JSON.stringify(rows).includes("400-00-1112"), "nunca el SSN completo");
});

test("un SSN que estaba el año pasado y desaparecio se marca para confirmar", () => {
  const rows = identityInventoryRows(pack(fakeReturn(2025), fakeReturn(2024, { oldKid: true })), { taxYear: "2025" });
  const gone = rows.find((r) => r.item === "SSN ***4444 from the prior-year return");
  assert.strictEqual(gone.status, "MISMATCH");
  assert.strictEqual(gone.returnValue, "Not on this return");
});

test("un dependiente nuevo no es un error: se cuenta como nuevo, sin comparar", () => {
  const rows = identityInventoryRows(pack(fakeReturn(2025), fakeReturn(2024, { kid: false })), { taxYear: "2025" });
  assert.ok(!rows.some((r) => r.status === "MISMATCH"));
  assert.match(rows[rows.length - 1].note, /New this year, not compared: \*\*\*3333/);
});

test("documento con el SSN a un digito del de la declaracion", () => {
  const docs = [file("1099-INT.pdf", `Form 1099-INT 2025\nRECIPIENT'S TIN 400-00-1121\nJOHN Q SAMPLE`)];
  const rows = identityInventoryRows(pack(fakeReturn(2025), fakeReturn(2024), docs), { taxYear: "2025" });
  const row = rows.find((r) => r.item === "SSN on 1099-INT.pdf");
  assert.strictEqual(row.status, "MISMATCH");
  assert.deepStrictEqual([row.returnValue, row.sourceValue], ["***1111", "***1121"]);
});

test("un documento con el SSN del conyuge a otro apellido: se muestra la linea con su nombre", () => {
  const docs = [file("5498 Jane.pdf", `Form 5498 IRA Contribution Information 2025\nPARTICIPANT'S TIN XXX-XX-2222\nJANE R MAIDEN\n100 MAIN ST`)];
  const rows = identityInventoryRows(pack(fakeReturn(2025), fakeReturn(2024), docs), { taxYear: "2025" });
  const row = rows.find((r) => r.item === "Name on 5498 Jane.pdf");
  assert.strictEqual(row.status, "MISMATCH");
  assert.strictEqual(row.returnValue, "SAMPLE");
  assert.strictEqual(row.sourceValue, "JANE R MAIDEN");
});

test("un K-1 a nombre de un trust con el SSN del titular no es una diferencia de nombre", () => {
  const docs = [file("K-1 Trust.pdf", K1("ACME FUND LP", FUND_EIN, TP, "SAMPLE FAMILY TRUST"))];
  const rows = identityInventoryRows(pack(fakeReturn(2025), fakeReturn(2024), docs), { taxYear: "2025" });
  assert.ok(!rows.some((r) => r.status === "MISMATCH"));
});

test("un K-1 cuyo EIN no figura en la declaracion", () => {
  const docs = [file("K-1 Other.pdf", K1("OTHER FUND LLC", "98-7654321", TP, "JOHN Q SAMPLE"))];
  const rows = identityInventoryRows(pack(fakeReturn(2025), fakeReturn(2024), docs), { taxYear: "2025" });
  const row = rows.find((r) => r.item === "K-1 K-1 Other.pdf");
  assert.strictEqual(row.status, "MISMATCH");
  assert.strictEqual(row.sourceValue, "***4321");
  assert.match(row.note, /missing from Schedule E/);
});

test("sin declaracion del año anterior igual cruza los documentos", () => {
  const docs = [file("W-2 John.pdf", `Form W-2 2025\nEmployee's SSN ${TP}\nJOHN Q SAMPLE`)];
  const rows = identityInventoryRows([file("2025.pdf", fakeReturn(2025), "current_return"), ...docs], { taxYear: "2025" });
  assert.match(rows[rows.length - 1].note, /^2 — SSNs matching the prior-year return: 0; documents whose SSN is on the return: 1; documents carrying the name the return prints: 1/);
});

test("sin declaracion corriente no hay nada", () => {
  assert.deepStrictEqual(identityInventoryRows([file("W-2.pdf", `Employee's SSN ${TP}`)], {}), []);
});

test("un digito distinto o dos vecinos intercambiados; nada mas", () => {
  assert.strictEqual(oneSlipApart("400-00-1111", "400-00-1112"), true);
  assert.strictEqual(oneSlipApart("400-00-1234", "400-00-1243"), true);
  assert.strictEqual(oneSlipApart("400-00-1234", "400-00-4321"), false);
  assert.strictEqual(oneSlipApart("400-00-1111", "400-00-1111"), false);
});

test("el nombre de una persona es el que la declaracion imprime delante de su SSN", () => {
  assert.deepStrictEqual(nameFor(fakeReturn(2025), TP), { first: "JOHN", last: "SAMPLE" });
  assert.deepStrictEqual(nameFor(fakeReturn(2025), SP), { first: "JANE", last: "SAMPLE" });
  assert.strictEqual(nameFor("UNA SOLA VEZ 400-00-9999", "400-00-9999"), null, "con una sola aparicion no se decide");
});
