"use strict";
// El banco de pruebas (scripts/banco): un paquete inventado por tipo de declaracion (1040, 1040-NR,
// 1065, 1120, 1120-S y 990) con errores plantados y su clave. Cada cambio a los cruces tiene que
// seguir encontrando lo que el codigo encontraba y no agregar hallazgos de mas. Para regenerar los
// paquetes: `npm run banco:armar`; para ver la planilla: `npm run banco`.
const { test } = require("node:test");
const assert = require("node:assert");
const { calificar, leerFixtures } = require("../scripts/banco/calificar.cjs");

const fixtures = leerFixtures();

test("el banco tiene un paquete por tipo de declaracion", () => {
  assert.deepStrictEqual(fixtures.map((f) => f.returnType).sort(), ["1040", "1040-NR", "1065", "1120", "1120-S", "990"]);
});

for (const fixture of fixtures) {
  test(`banco: ${fixture.titulo}`, () => {
    const r = calificar(fixture);
    const missing = r.clave.filter((c) => c.codigo && !c.encontrado).map((c) => `${c.id} ${c.error}`);
    assert.deepStrictEqual(missing, [], "errores plantados que el codigo dejo de ver");
    const tie = r.clave.filter((c) => c.tieout && !c.tieOk).map((c) => `${c.id} tie-out ${c.tieout}`);
    assert.deepStrictEqual(tie, [], "filas del tie-out que el codigo tenia que decidir");
    assert.deepStrictEqual(r.extra.map((f) => `[${f.severity}] ${f.title}`), [], "hallazgos de mas: un falso positivo o el caso mal armado");
    assert.deepStrictEqual(r.errors, []);
    if (r.estadoCivil) assert.strictEqual(r.estadoCivil.leido, r.estadoCivil.esperado);
    if (r.tasaMarginal) assert.strictEqual(r.tasaMarginal.leida, r.tasaMarginal.esperado);
  });
}
