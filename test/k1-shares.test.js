"use strict";
// Los porcentajes de participacion de los K-1 tienen que sumar 100%.
//
// Es aritmetica pura, pero el resguardo que importa es de EXTRACCION y no de impuestos: sobre
// una declaracion real el extractor devolvio un porcentaje de ganancia donde habia dos socios y
// la suma dio 50% — un hallazgo que no existe. Por eso la cantidad de porcentajes leidos tiene
// que coincidir con la cantidad de K-1 que la propia declaracion declara; si no coincide, el
// que fallo fue el lector y no la declaracion. Entidades y porcentajes ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { checkK1SharesFootTo100, declaredK1Count, k1Shares } = require("../lib/entity-return-checks");

const cabecera = (n) => `I Number of Schedules K-1. Attach one for each person who was a partner at any time during the tax year:${" ".repeat(120)}${n}`;
/** El K-1 imprime apertura y cierre en la misma linea: "Profit 64.42 % 64.42 %". */
const socio = (p, l, c) => `Profit ${p} % ${p} %\nLoss ${l} % ${l} %\nCapital ${c} % ${c} %`;

test("porcentajes que cierran en 100 no disparan nada", () => {
  const text = [cabecera(3), socio("64.42", "64.42", "64.42"), socio("30.00", "30.00", "30.00"), socio("5.58", "5.58", "5.58")].join("\n");
  assert.strictEqual(declaredK1Count(text), 3);
  assert.strictEqual(checkK1SharesFootTo100(text), null);
});

test("una columna que no cierra se reporta, y dice cual", () => {
  const text = [cabecera(2), socio("60.00", "50.00", "50.00"), socio("30.00", "50.00", "50.00")].join("\n");
  const found = checkK1SharesFootTo100(text);
  assert.ok(found, "ganancias suman 90%");
  assert.strictEqual(found.severity, "HIGH");
  assert.match(found.detail, /profit adds to 90\.00%/);
  assert.ok(!/loss adds/.test(found.detail), "perdidas y capital cierran, no tienen que figurar");
});

test("las tres columnas fuera se reportan juntas", () => {
  const text = [cabecera(2), socio("60.00", "60.00", "60.00"), socio("30.00", "30.00", "30.00")].join("\n");
  const found = checkK1SharesFootTo100(text);
  assert.match(found.detail, /profit adds to 90\.00%/);
  assert.match(found.detail, /loss adds to 90\.00%/);
  assert.match(found.detail, /capital adds to 90\.00%/);
});

test("el redondeo del formulario no es un hallazgo", () => {
  // Tres socios a 33.33 suman 99.99: eso es como imprime el software, no un error.
  const text = [cabecera(3), socio("33.33", "33.33", "33.33"), socio("33.33", "33.33", "33.33"), socio("33.34", "33.34", "33.34")].join("\n");
  assert.strictEqual(checkK1SharesFootTo100(text), null);
});

test("si se leyeron menos porcentajes que K-1, el que fallo fue el lector", () => {
  // El caso real: dos socios declarados, un solo porcentaje de ganancia extraido.
  const text = [cabecera(2), "Profit 50.00 % 50.00 %", "Loss 50.00 % 50.00 %\nLoss 50.00 % 50.00 %"].join("\n");
  const shares = k1Shares(text);
  assert.strictEqual(shares.Profit.length, 1, "el extractor leyo uno solo");
  assert.strictEqual(checkK1SharesFootTo100(text), null, "no se opina sobre una lectura incompleta");
});

test("sin la linea que declara cuantos K-1 hay, no se opina", () => {
  const text = [socio("60.00", "60.00", "60.00"), socio("30.00", "30.00", "30.00")].join("\n");
  assert.strictEqual(declaredK1Count(text), null);
  assert.strictEqual(checkK1SharesFootTo100(text), null);
});

test("una declaracion sin K-1 no produce nada", () => {
  assert.strictEqual(checkK1SharesFootTo100("1 Gross receipts or sales 242,270."), null);
  assert.strictEqual(checkK1SharesFootTo100(""), null);
});

test("el hueco entre la etiqueta y el numero puede ser muy ancho", () => {
  // En las declaraciones medidas llega a 180 espacios de columna.
  assert.strictEqual(declaredK1Count(cabecera(23)), 23);
  assert.strictEqual(declaredK1Count("I Number of Schedules K-1. Attach one for each person who was a shareholder at any time during the tax year: 2"), 2);
});
