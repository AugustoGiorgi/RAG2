"use strict";
// Que reglas del master prompt recibe cada revision: las comunes y las de su formulario, nada
// de los otros. El separador estuvo mal codificado y un 1065, un 1120 y un 1120-S recibian
// reglas del 1040, del 1041, del 709 y del 720 sin que nada fallara a la vista.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { selectFormRules, formSection, sharedRules, FORM_SEPARATOR } = require("../lib/master-prompt");

const SEP = "═".repeat(40);
const FICTICIO = [
  "REGLAS COMUNES",
  "Aplican a toda declaracion.",
  "",
  SEP,
  "FORM 1040 — Individual",
  "Reglas del 1040.",
  SEP,
  "FORM 1120 — Corporation",
  "Reglas del 1120.",
  SEP,
  "FORM 1120-S — S Corporation",
  "Reglas del 1120-S.",
  SEP,
  "FORM 1040-NR — Nonresident",
  "Reglas del 1040-NR.",
].join("\r\n");

test("las reglas comunes terminan donde empieza el primer formulario", () => {
  assert.strictEqual(sharedRules(FICTICIO), "REGLAS COMUNES\r\nAplican a toda declaracion.");
});

test("cada formulario recibe solo su seccion", () => {
  assert.match(formSection(FICTICIO, "1120"), /^FORM 1120 — Corporation\r?\nReglas del 1120\.$/);
  assert.doesNotMatch(formSection(FICTICIO, "1120"), /1120-S/, "el 1120 no se lleva la seccion del 1120-S");
  assert.match(formSection(FICTICIO, "1120-S"), /^FORM 1120-S/);
  assert.doesNotMatch(formSection(FICTICIO, "1040"), /1040-NR/, "el 1040 no se lleva la del 1040-NR");
  assert.strictEqual(formSection(FICTICIO, "990"), "", "un formulario que no esta no devuelve nada");
  assert.strictEqual(formSection(FICTICIO, ""), "");
});

test("sobre el master prompt real, cada tipo recibe su formulario y ningun otro", () => {
  const real = fs.readFileSync(path.join(__dirname, "..", "senior-review-master-prompt.txt"), "utf8");
  const shared = sharedRules(real);
  assert.ok(shared.length > 1000 && shared.length < real.length / 2, "las comunes son solo el principio");
  assert.doesNotMatch(shared, /\n\s*FORM\s+\d{3,4}/, "las comunes no traen secciones de formulario");
  for (const type of ["1040", "1065", "1120", "1120-S"]) {
    const { form } = selectFormRules(real, type);
    assert.ok(form.startsWith(`FORM ${type}`), `${type}: la seccion empieza por su titulo`);
    const others = (form.match(/\n\s*FORM\s+[\d-]+[A-Z]*/g) || []);
    assert.deepStrictEqual(others, [], `${type}: no trae otra seccion de formulario`);
    assert.ok(shared.length + form.length < 26000, `${type}: entra sin recorte`);
  }
});

test("el separador reconoce el renglon de ═ y va escrito como escape", () => {
  assert.ok(FORM_SEPARATOR.test("\n" + "═".repeat(12) + "\r\nFORM 1065 — Partnership"));
  assert.ok(!FORM_SEPARATOR.test("\n" + "=".repeat(12) + "\nFORM 1065"), "solo el renglon de ═ separa formularios");
  assert.match(FORM_SEPARATOR.source, /\\u2550/, "una conversion de codificacion no puede romper un escape");
});
