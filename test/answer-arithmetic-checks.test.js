"use strict";
// Cuando una casilla marcada contradice la aritmetica de la misma declaracion.
//
// Esto se volvio posible al notar que el extractor de la app resuelve la posicion del tilde y
// escribe " [ANSWER: Yes]" / " [ANSWER: No]" sobre la linea de la pregunta. Hasta entonces las
// casillas eran territorio exclusivo del modelo — y el modelo se equivoca justo ahi: sobre un
// 1120-S real razono en circulo sobre la pregunta 11 del Schedule B, que es la comparacion de
// dos numeros contra $250.000.
//
// Lo que estas pruebas protegen sobre todo es la asimetria: en el 1065 la pregunta tiene cuatro
// condiciones y solo dos son aritmeticas, asi que un "Yes" con una condicion fallada es
// demostrable y un "No" no prueba nada. Reportar la direccion que no se puede probar seria
// exactamente el falso positivo que este modulo vino a reemplazar.
// Entidades y montos ficticios; el layout es el que produce el extractor de la app.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  checkSmallReturnExemption, runAnswerArithmeticChecks, printedAnswer, endingAssets,
  EXEMPTION_QUESTION,
} = require("../lib/answer-arithmetic-checks");

/** Un 1120-S chico: ingresos y activos por debajo del tope. */
const CHICO_1120S = (answer, receipts, assets) => `
1 a Gross receipts or sales ${receipts}. b Less returns and allowances c Balance 1 c ${receipts}.
11 Does the corporation satisfy both of the following conditions? . . . . . . . . . . X [ANSWER: ${answer}]
a The corporation's total receipts (see instructions) for the tax year were less than $250,000.
b The corporation's total assets at the end of the tax year were less than $250,000.
15 Total assets . . . . . . . . . . . . . . . . . . . 181,311. ${assets}.
`;

const CHICO_1065 = (answer, receipts, assets) => `
1 a Gross receipts or sales ${receipts}. b Less returns and allowances c Balance 1c ${receipts}.
4 Does the partnership satisfy all four of the following conditions? . . . . . . . . X [ANSWER: ${answer}]
a The partnership's total receipts for the tax year were less than $250,000.
b The partnership's total assets at the end of the tax year were less than $1 million.
14 Total assets . . . . . . . . . . . . . . . . . . . 900,000. ${assets}.
`;

test("1120-S: contestar Yes con los ingresos por encima del tope es un error demostrable", () => {
  const found = checkSmallReturnExemption(CHICO_1120S("Yes", "412,880", "244,630"), { returnType: "1120-S" });
  assert.ok(found, "esperaba un hallazgo");
  assert.strictEqual(found.severity, "HIGH");
  assert.match(found.detail, /total receipts are \$412,880, over the \$250,000 limit/);
  assert.match(found.action, /complete Schedules L and M-1/);
});

test("1120-S: y tambien con los activos por encima", () => {
  const found = checkSmallReturnExemption(CHICO_1120S("Yes", "242,270", "618,488"), { returnType: "1120-S" });
  assert.ok(found);
  assert.match(found.detail, /ending total assets are \$618,488/);
});

test("1120-S: contestar Yes cumpliendo las dos condiciones no dispara nada", () => {
  assert.strictEqual(checkSmallReturnExemption(CHICO_1120S("Yes", "242,270", "244,630"), { returnType: "1120-S" }), null);
});

test("1120-S: contestar No cumpliendo las dos se reporta como LOW, sin consecuencia fiscal", () => {
  // Caso real: el modelo levantaba esto en corrida tras corrida razonando en circulo.
  const found = checkSmallReturnExemption(CHICO_1120S("No", "242,270", "244,630"), { returnType: "1120-S" });
  assert.ok(found);
  assert.strictEqual(found.severity, "LOW");
  assert.match(found.detail, /\$242,270/);
  assert.match(found.detail, /\$244,630/);
  assert.match(found.action, /No tax consequence/);
});

test("1120-S: contestar No con una condicion fallada es correcto y no dispara nada", () => {
  assert.strictEqual(checkSmallReturnExemption(CHICO_1120S("No", "257,983", "181,311"), { returnType: "1120-S" }), null);
});

test("1065: solo se reporta la direccion demostrable", () => {
  // Yes con los ingresos pasados: demostrable, porque esa condicion es aritmetica.
  const malo = checkSmallReturnExemption(CHICO_1065("Yes", "2,409,388", "937,579"), { returnType: "1065" });
  assert.ok(malo, "un Yes con los ingresos por encima del tope si es demostrable");
  assert.strictEqual(malo.severity, "HIGH");
  // No con las dos aritmeticas cumplidas: NO prueba nada, porque quedan dos condiciones de
  // procedimiento que este modulo no puede ver.
  const callado = checkSmallReturnExemption(CHICO_1065("No", "180,000", "500,000"), { returnType: "1065" });
  assert.strictEqual(callado, null, "las otras dos condiciones pueden ser las que fallan");
});

test("sin tilde resuelto no se adivina", () => {
  const sinRespuesta = CHICO_1120S("Yes", "412,880", "244,630").replace(/\[ANSWER: Yes\]/, "");
  assert.strictEqual(checkSmallReturnExemption(sinRespuesta, { returnType: "1120-S" }), null);
});

test("sin poder leer los importes no se opina", () => {
  const sinCifras = "11 Does the corporation satisfy both of the following conditions? X [ANSWER: Yes]";
  assert.strictEqual(checkSmallReturnExemption(sinCifras, { returnType: "1120-S" }), null);
});

test("un tipo de declaracion sin esta pregunta no se toca", () => {
  assert.strictEqual(checkSmallReturnExemption(CHICO_1120S("Yes", "412,880", "244,630"), { returnType: "1120" }), null);
  assert.strictEqual(checkSmallReturnExemption(CHICO_1120S("Yes", "412,880", "244,630"), { returnType: "1040" }), null);
  assert.strictEqual(checkSmallReturnExemption(CHICO_1120S("Yes", "412,880", "244,630"), { returnType: "" }), null);
});

test("los activos que valen son los del CIERRE, no los de apertura", () => {
  // La linea trae las dos columnas: 181,311 al inicio y 618,488 al cierre.
  assert.strictEqual(endingAssets("15 Total assets . . . . . 181,311. 618,488."), 618488);
});

test("printedAnswer lee el tilde resuelto y nada mas", () => {
  const q = EXEMPTION_QUESTION["1120-S"].question;
  assert.strictEqual(printedAnswer("11 Does the corporation satisfy both of the following conditions? X [ANSWER: No]", q), "No");
  assert.strictEqual(printedAnswer("11 Does the corporation satisfy both of the following conditions? Yes No", q), null);
  assert.strictEqual(printedAnswer("otra cosa", q), null);
});

test("el runner necesita una declaracion corriente legible", () => {
  assert.deepStrictEqual(runAnswerArithmeticChecks([], { returnType: "1120-S" }), []);
  assert.deepStrictEqual(runAnswerArithmeticChecks(null, {}), []);
  const corto = [{ name: "x.pdf", reviewRole: "current_return", text: "nada" }];
  assert.deepStrictEqual(runAnswerArithmeticChecks(corto, { returnType: "1120-S" }), []);
});

test("el runner encuentra el hallazgo por el camino completo", () => {
  // Con el relleno a proposito: el runner exige 500 caracteres antes de opinar, porque un
  // documento que no se pudo extraer llega casi vacio y no hay que sacarle conclusiones.
  const relleno = Array(20).fill("2 Cost of goods sold . . . . . . . . . . . . . . . . . . . . . 2 703,631.").join("\n");
  const text = CHICO_1120S("Yes", "412,880", "244,630") + relleno;
  const out = runAnswerArithmeticChecks([{ name: "cur.pdf", reviewRole: "current_return", fullText: text, text }], { returnType: "1120-S" });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].severity, "HIGH");
});
