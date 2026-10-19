"use strict";

/**
 * La planilla del banco de pruebas: `npm run banco`.
 *
 * Por cada paquete, cada error plantado con lo que encontro el codigo, lo que queda para el
 * modelo (la Review completa, subiendo los archivos a la app) y cualquier hallazgo de mas.
 * Sale con codigo 1 si un error que el codigo tiene que ver no aparece, si hay un hallazgo de
 * mas o si una lectura esperada falla: es lo que hay que mirar antes de subir un cambio.
 */

const { calificar, leerFixtures } = require("./calificar.cjs");

let problems = 0;
for (const fixture of leerFixtures()) {
  const r = calificar(fixture);
  const byCode = r.clave.filter((c) => c.codigo);
  const found = byCode.filter((c) => c.encontrado);
  console.log(`\n${r.titulo}`);
  console.log(`  codigo: ${found.length} de ${byCode.length} esperados; modelo: ${r.clave.length - byCode.length} para la corrida completa`);
  for (const c of r.clave) {
    const mark = !c.codigo ? "  · " : c.encontrado ? "  ✓ " : "  ✗ ";
    const tie = c.tieout ? (c.tieOk ? " [tie-out ✓]" : " [tie-out ✗]") : "";
    console.log(`${mark}${c.id} ${c.error}${c.codigo ? (c.encontrado ? ` — ${c.severidad}` : " — NO LO ENCONTRO") : " — modelo"}${tie}`);
    if (c.codigo && !c.encontrado) problems += 1;
    if (c.tieout && !c.tieOk) problems += 1;
  }
  for (const f of r.extra) { console.log(`  + de mas: [${f.severity}] ${f.title} (${f.module})`); problems += 1; }
  for (const e of r.errors) { console.log(`  ! ${e}`); problems += 1; }
  if (r.estadoCivil) {
    const ok = r.estadoCivil.leido === r.estadoCivil.esperado;
    console.log(`  ${ok ? "✓" : "✗"} estado civil leido por codigo: ${r.estadoCivil.leido || "nada"}`);
    if (!ok) problems += 1;
  }
  if (r.tasaMarginal) {
    const ok = r.tasaMarginal.leida === r.tasaMarginal.esperado;
    console.log(`  ${ok ? "✓" : "✗"} tasa marginal: ${r.tasaMarginal.leida === null ? "sin tasa" : `${Math.round(r.tasaMarginal.leida * 1000) / 10}%`}`);
    if (!ok) problems += 1;
  }
}
console.log(problems ? `\n${problems} problema(s): revisar antes de subir.` : "\nTodo como se esperaba.");
process.exitCode = problems ? 1 : 0;
