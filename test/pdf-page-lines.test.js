"use strict";
// pdfPageLines: reconstruccion de lineas visuales desde items de pdf.js.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const src = fs.readFileSync(require("node:path").join(__dirname, "..", "app.js"), "utf8");
// pdfPageLines ya no se basta sola: llama a annotateYesNoAnswers y a lastIndexWithWords, asi
// que se toma el bloque entero de app.js en vez de la funcion suelta.
const blockStart = src.indexOf("function pdfPageLines(content) {");
const blockEnd = src.indexOf("\n}", src.indexOf("function lastIndexWithWords(rendered, from) {")) + 2;
// eslint-disable-next-line no-new-func
const { pdfPageLines } = new Function(`${src.slice(blockStart, blockEnd)}\nreturn { pdfPageLines };`)();
const item = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });

test("junta la etiqueta con su importe pese al orden de dibujado", () => {
  // pdf.js entrega el formulario en blanco primero y las cifras despues. Aqui el importe
  // llega ultimo y con la baseline 1.7 unidades mas abajo, como en un 7203 real.
  const content = { items: [
    item("5 Stock basis before distributions", 59.6, 399.6),
    item("6 Distributions (excluding dividend distributions)", 59.6, 387.6),
    item("704,091.", 527.5, 385.9),
    item("621,409.", 527.5, 397.9),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "5 Stock basis before distributions 621,409.",
    "6 Distributions (excluding dividend distributions) 704,091.",
  ]);
});

test("no fusiona filas contiguas ni pierde el orden horizontal", () => {
  const content = { items: [
    item("b", 300, 500), item("a", 100, 500),
    item("fila siguiente", 100, 488),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), ["a b", "fila siguiente"]);
});

test("descarta items vacios y pagina sin texto", () => {
  assert.deepStrictEqual(pdfPageLines({ items: [item("   ", 10, 10)] }), []);
  assert.deepStrictEqual(pdfPageLines({ items: [] }), []);
  assert.deepStrictEqual(pdfPageLines({}), []);
});

// Respuestas Si/No. Vienen de un 1065 real: la app leyo "electing out of the centralized
// audit regime" como Yes cuando la tilde estaba en la columna No, y le pidio al cliente un
// Schedule B-2 que nunca hizo falta. Aplanar la pagina tiraba la coordenada x, que era lo
// unico que distinguia una respuesta de la otra.
//
// Coordenadas tomadas del PDF real: encabezado Yes en x=536.3 y No en x=560.0, tildes en
// x=540.4 y x=562.3.

test("la tilde bajo el encabezado Yes/No se resuelve por columna", () => {
  const content = { items: [
    item("Schedule B Other Information", 60, 734.9), item("Yes", 536.3, 734.9), item("No", 560.0, 734.9),
    item("2a Did any corporation own 50% or more?", 60, 700), item("X", 540.4, 700),
    item("2b Did any individual own 50% or more?", 60, 688), item("X", 562.3, 688),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "Schedule B Other Information Yes No",
    "2a Did any corporation own 50% or more? X [ANSWER: Yes]",
    "2b Did any individual own 50% or more? X [ANSWER: No]",
  ]);
});

test("la tilde que cae en su propio renglon se pega a la pregunta de arriba", () => {
  // El formulario imprime la casilla un pelo mas abajo que la frase, mas de las 3 unidades
  // de tolerancia, y la tilde termina sola en una linea. Fue exactamente el caso de la
  // pregunta 33.
  const content = { items: [
    item("Schedule B Other Information", 60, 734.9), item("Yes", 536.6, 734.9), item("No", 560.5, 734.9),
    item("33 Is the partnership electing out of the audit regime?", 60, 579.5),
    item("X", 562.8, 576.2),
    item("If \"Yes,\" complete Schedule B-2.", 70, 568.7),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "Schedule B Other Information Yes No",
    "33 Is the partnership electing out of the audit regime? [ANSWER: No]",
    "X",
    "If \"Yes,\" complete Schedule B-2.",
  ]);
});

test("pregunta con su propio Yes/No en la misma linea", () => {
  // Form 6765 linea A: no hay encabezado de columna, la respuesta es la palabra mas cercana.
  const content = { items: [
    item("A Are you electing the reduced credit under section 280C?", 55, 640),
    item("Yes", 520, 640), item("X", 540, 640), item("No", 545, 640),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "A Are you electing the reduced credit under section 280C? Yes X No [ANSWER: No]",
  ]);
});

test("una X que no esta en ninguna columna no se responde", () => {
  // Fail-closed: la X de un checkbox cualquiera del formulario no es una respuesta Si/No.
  const content = { items: [
    item("Schedule B", 60, 734.9), item("Yes", 536.3, 734.9), item("No", 560.0, 734.9),
    item("H Check accounting method: (1)", 60, 700), item("X", 200, 700), item("Cash", 210, 700),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "Schedule B Yes No",
    "H Check accounting method: (1) X Cash",
  ]);
});

test("sin encabezado no se inventa una respuesta", () => {
  const content = { items: [
    item("16a Did you make any payments requiring Form 1099?", 60, 467), item("X", 562.3, 467),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "16a Did you make any payments requiring Form 1099? X",
  ]);
});

test("la casilla que va DESPUES de la palabra tambien se resuelve", () => {
  // Los formularios no se ponen de acuerdo con que lado de la palabra lleva la casilla. El
  // Form 6765 la pone antes (la tilde cae 10 unidades a la izquierda de "No"); el IT-204 de
  // NY la pone despues, 22.5 a la derecha. Coordenadas del PDF real.
  const content = { items: [
    item("H Did the partnership have an interest in real property in NYS?", 55, 338.9),
    item("Yes", 496.1, 338.9), item("No", 543.1, 338.9), item("X", 565.6, 338.9),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "H Did the partnership have an interest in real property in NYS? Yes No X [ANSWER: No]",
  ]);
});

test("la tilde que cae en el medio no se responde", () => {
  // Justamente porque las dos convenciones conviven, una tilde equidistante es ilegible. Esta
  // estaba a 18.3 de "No" y 19.2 de "Yes": por distancia ganaba "No", y la respuesta correcta
  // era "Yes" en un formulario que nombraba al designado, su telefono y su PIN.
  const content = { items: [
    item("Yes", 42.5, 261.6), item("X", 61.7, 261.6), item("No", 80.0, 261.6),
    item("Email: SOMEONE@EXAMPLE.COM", 120, 261.6),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), ["Yes X No Email: SOMEONE@EXAMPLE.COM"]);
});

/* --- La tilde que queda un renglon ARRIBA de su propio "Yes No" -----------------
 * Formularios estatales a dos columnas: la casilla se dibuja unas unidades mas alta que las
 * palabras y la tilde cae en el renglon de arriba, junto al texto de la otra columna. Una
 * revision real leyo una de esas como Yes y pidio cambiar una casilla que estaba en No. */

test("dos columnas: la tilde un pelo arriba de su Yes/No responde esa pregunta", () => {
  const content = { items: [
    // Columna derecha, pregunta D1; su tilde cae en el renglon del estado civil (izquierda).
    item("D1 Did you have a financial account located", 329, 527),
    item("A", 36, 523), item("Filing", 51, 523), item("X", 118, 520), item("Single", 132, 520), item("X", 565, 521),
    item("in a foreign country?", 329, 519), item("Yes", 503, 518), item("No", 547, 518),
    // Columna izquierda, pregunta B; su tilde queda sola en un renglon propio.
    item("B Did you itemize your deductions on", 36, 405),
    item("X", 280, 400),
    item("your federal income tax return?", 54, 396), item("Yes", 218, 396), item("No", 261, 396),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "D1 Did you have a financial account located",
    "A Filing X Single X",
    "in a foreign country? Yes No [ANSWER: No]",
    "B Did you itemize your deductions on",
    "X",
    "your federal income tax return? Yes No [ANSWER: No]",
  ]);
});

test("dos columnas: la tilde de otra pregunta no se toma prestada", () => {
  const content = { items: [
    // La X es de la casilla del estado civil (columna izquierda): cae en el renglon de esta
    // pregunta, lejos de su Yes/No, y no la contesta.
    item("Married filing joint return", 132, 500), item("X", 118, 496),
    item("quarters in Sampletown for any part of the year?", 329, 493), item("Yes", 503, 493), item("No", 547, 493),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "Married filing joint return",
    "X quarters in Sampletown for any part of the year? Yes No",
  ]);
});

test("dos columnas: mas arriba de unas pocas unidades ya es otro renglon del formulario", () => {
  const content = { items: [
    item("Some other line of the form", 54, 412), item("X", 280, 412),
    item("your federal income tax return?", 54, 396), item("Yes", 218, 396), item("No", 261, 396),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "Some other line of the form X",
    "your federal income tax return? Yes No",
  ]);
});

test("dos columnas: una tilde a mitad de camino sigue sin responderse", () => {
  const content = { items: [
    item("X", 240, 400),
    item("your federal income tax return?", 54, 396), item("Yes", 218, 396), item("No", 261, 396),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), ["X", "your federal income tax return? Yes No"]);
});

test("dos columnas: una tilde contesta una sola pregunta", () => {
  // La tilde ya respondio la pregunta de su propio renglon; la de abajo, con las mismas
  // columnas, no la vuelve a usar.
  const content = { items: [
    item("Did you live there all year?", 54, 400), item("Yes", 218, 400), item("No", 261, 400), item("X", 280, 400),
    item("Did you work there too?", 54, 396), item("Yes", 218, 396), item("No", 261, 396),
  ] };
  const lines = pdfPageLines(content);
  assert.strictEqual(lines.filter((l) => l.includes("[ANSWER:")).length, 1);
});

test("el encabezado Yes/No de una columna no se responde con la tilde de arriba", () => {
  // Sin signo de pregunta es un encabezado: sigue sirviendo para las tildes de abajo, igual
  // que antes, y no se le pega la respuesta de un renglon anterior.
  const content = { items: [
    item("X", 562, 738),
    item("Schedule B Other Information", 60, 734.9), item("Yes", 536.6, 734.9), item("No", 560.5, 734.9),
    item("7a Did the partnership have a foreign account?", 60, 600), item("X", 562.8, 600),
  ] };
  assert.deepStrictEqual(pdfPageLines(content), [
    "X",
    "Schedule B Other Information Yes No",
    "7a Did the partnership have a foreign account? X [ANSWER: No]",
  ]);
});
