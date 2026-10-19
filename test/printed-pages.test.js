"use strict";
// Lo que no viaja al modelo porque no puede traer un error de la declaracion: las instrucciones
// que el IRS imprime al dorso de un W-2 o un 1099 (iguales en todas las copias) y las
// autorizaciones de e-file estatales. Del lado seguro: nada sale de una declaracion salvo esas
// autorizaciones, y una hoja con un renglon lleno se queda. Textos inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const { dropPrintedPages, printedPagesNotice } = require("../lib/package-trim");

const instructions = [
  "Instructions for Employee",
  ...Array.from({ length: 10 }, (_, i) => `Box ${i + 1}. Shows the amount reported to you. This amount is reported on your return. Keep this copy for your records.`),
].join("\n");
const w2 = `--- Page 1 ---\nForm W-2 Wage and Tax Statement 2025\nWages, tips, other compensation\n52,000.00\nFederal income tax withheld\n5,400.00\n--- Page 2 ---\n${instructions}\n`;

test("el dorso del W-2 no viaja; la cara si, y el modelo recibe el aviso", () => {
  const out = dropPrintedPages([{ name: "W2.pdf", role: "supporting_document", text: w2 }]);
  assert.strictEqual(out.removedPages, 1);
  const doc = out.documents[0];
  assert.match(doc.text, /52,000\.00/);
  assert.doesNotMatch(doc.text, /Instructions for Employee/);
  assert.match(printedPagesNotice(doc.printed), /PRINTED PAGES NOT SENT\. 1 page\(s\).*pages 2\.\nDo not report these pages as missing/);
});

test("de una declaracion no salen instrucciones, aunque las parezca", () => {
  const out = dropPrintedPages([{ name: "return.pdf", role: "current_return", text: w2 }]);
  assert.strictEqual(out.removedPages, 0);
  assert.strictEqual(out.documents[0].text, w2);
});

test("una hoja con renglones llenos se queda aunque sus rotulos tengan instrucciones", () => {
  const filled = [
    "Step 6: Figure your replacement tax after credits",
    "40 Replacement tax. Multiply Line 39 by 2.5% (.025). 40 0. 00",
    "42 Replacement tax before credits. Add Lines 40 and 41. 42 0. 00",
    "44 Replacement tax after credits. Subtract Line 43 from Line 42. If the amount is negative, enter zero. 44 0. 00",
    "39 Net income. Subtract Line 38 from Line 37. 39 -197,267. 00",
    ...Array.from({ length: 6 }, (_, i) => `Line ${i + 1}. If you have an amount, enter it here. The total is carried to the return. See instructions.`),
  ].join("\n");
  const out = dropPrintedPages([{ name: "state.pdf", role: "supporting_document", text: `--- Page 1 ---\nFace\n--- Page 2 ---\n${filled}\n` }]);
  assert.strictEqual(out.removedPages, 0);
});

test("la autorizacion de e-file estatal sale de la declaracion; un voucher de extension se queda", () => {
  const ret = [
    "--- Page 1 ---\nForm 1040 U.S. Individual Income Tax Return 2025\nWages 52,000.",
    "--- Page 2 ---\nNJ-8879 NJ e-file Signature Authorization\nDo not send to New Jersey. Keep for your records.\nI declare that I have examined this return.",
    "--- Page 3 ---\n2025 NJ-630-V PAYMENT VOUCHER\n0139101010\nAmount of payment 1,500.00",
  ].join("\n");
  const out = dropPrintedPages([{ name: "return.pdf", role: "current_return", text: ret }]);
  assert.deepStrictEqual(out.documents[0].printed.map((p) => [p.page, p.kind]), [[2, "state paperwork"]]);
  assert.match(out.documents[0].text, /NJ-630-V PAYMENT VOUCHER/);
  assert.match(printedPagesNotice(out.documents[0].printed), /state e-file authorizations/);
});

test("en un ZIP, una declaracion que viene adentro se trata como declaracion", () => {
  const entry = (name, pages) => `--- ZIP ENTRY: ${name} ---\n${pages.map((p, i) => `--- Page ${i + 1} ---\n${p}\n`).join("")}`;
  const zip = [
    entry("W2 Acme.pdf", ["Form W-2 Wage and Tax Statement\n52,000.00", instructions]),
    entry("1040 2024.pdf", ["Form 1040 U.S. Individual Income Tax Return 2024\nWages 50,000.", instructions]),
    entry("1099-INT.pdf", ["Form 1099-INT Interest Income\n420.00", "Bank statement\n1,000.00", "More detail\n2,000.00", "Year-end summary\n3,000.00", "Fees\n12.00"]),
  ].join("");
  const out = dropPrintedPages([{ name: "support.zip", role: "supporting_document", text: zip }]);
  assert.deepStrictEqual(out.documents[0].printed.map((p) => p.entry), ["W2 Acme.pdf"]);
  assert.match(out.documents[0].text, /--- ZIP ENTRY: W2 Acme\.pdf ---/, "el encabezado del archivo se conserva");
  assert.match(printedPagesNotice(out.documents[0].printed), /"W2 Acme\.pdf" \(page 2 of 2\)/);
  // Un ZIP tan chico que no se parte por archivo no se toca.
  const small = entry("W2 Acme.pdf", ["Form W-2\n52,000.00", instructions]);
  assert.strictEqual(dropPrintedPages([{ name: "w2.zip", role: "supporting_document", text: small }]).removedPages, 0);
});
