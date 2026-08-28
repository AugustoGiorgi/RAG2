"use strict";
// Cruces año-anterior / entre-formularios.
//
// Reproduce las fallas reales de un paquete 1040 revisado a mano contra los documentos:
// una pérdida suspendida que nunca se cargó al año siguiente, una distribución que superó
// la base sin ganancia de capital, y una actividad tratada como activa un año y pasiva al
// siguiente. Entidades y montos ficticios; el layout del texto extraído es el real.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  runPriorYearChecks, checkSuspendedLossCarryforward, checkExcessDistributions,
  checkNiitTreatmentChange, checkWagesFromPassiveEntity,
  extractUnallowedLossTotal, extractStockBasis, w2BoxOneWages, parseMoney,
} = require("../lib/prior-year-bridge");

// Texto tal como lo devuelve pdftotext -layout: etiqueta a la izquierda, importe lejos.
const PRIOR_8582_SUSPENDED = `
Part I 2024 Passive Activity Loss
b Activities with net loss (enter the amount from Part IV, column (b)). . . . . 1b (            31,500.)
3 Combine lines 1d and 2d . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 3          -31,500.
9 Enter the smaller of line 4 or line 8. . . . . . . . . . . . . . . . . . . . . . 9                0.
Part VII Allocation of Unallowed Losses. See instructions.
         Name of activity          Form or schedule            (a) Loss    (b) Ratio  (c) Unallowed loss
4120 Harbor View Rd                Sch E Ln 22                              1.000000     31,500.
Total. . . . . . . . . . . . . . . . . . . . . . .        31,500.            1.00        31,500.
Part VIII Allowed Losses. See instructions.
`;

const PRIOR_7203_EXCESS = `
Part I Shareholder Stock Basis
1 Stock basis at the beginning of the corporation's tax year. . . . . . . . . . 1              0.
3a Ordinary business income (enter losses in Part III). . . . . . . . . . 3a          410,000.
4 Add lines 3a through 3m. . . . . . . . . . . . . . . . . . . . . . . . . . . . 4        410,000.
5 Stock basis before distributions. Add lines 1, 2, and 4. . . . . . . . . . . . 5        410,000.
6 Distributions (excluding dividend distributions). . . . . . . . . . . . . . . 6        465,000.
    Note: If line 6 is larger than line 5, subtract line 5 from line 6 and report the result as a capital gain on
Form 8949 and Schedule D. See instructions.
7 Stock basis after distributions. Subtract line 6 from line 5 . . . . . . . . . 7              0.
`;

const PRIOR_8960_ACTIVE = `
4a Rental real estate, royalties, partnerships, S corporations, trusts . . .          410,000.
b Adjustment for net income or loss derived in the ordinary course of
   a trade or business not described in section 1411(c)(2) . . . . . . . . .         -410,000.
c Combine lines 4a and 4b . . . . . . . . . . . . . . . . . . . . . . . . . . .            0.
`;

const CURRENT_8960_PASSIVE = `
4a Rental real estate, royalties, partnerships, S corporations, trusts . . .          298,000.
b Adjustment for net income or loss derived in the ordinary course of
   a trade or business not described in section 1411(c)(2) . . . . . . . . .           -4,200.
c Combine lines 4a and 4b . . . . . . . . . . . . . . . . . . . . . . . . . . .      293,800.
`;

const CURRENT_8582_PASSIVE_ENTITY = `
Part I 2025 Passive Activity Loss
b Activities with net loss (enter the amount from Part IV, column (b)). . . . . 1b (            29,800.)
c Prior years' unallowed losses (enter the amount from Part IV, column (c)). . 1c (
                                                                                          )
2a Activities with net income (enter the amount from Part V, column (a)). . . 2a       302,000.
Part V Complete This Part Before Part I, Lines 2a, 2b, and 2c. See instructions.
         Name of activity            (a) Net income        (b) Net loss     (c) Unallowed loss
HARBORLINE ADVISORS LLC              302,000.                                          302,000.
Total. Enter on Part I, lines 2a, 2b, and 2c. . . .   302,000.
Part VI  Use This Part if an Amount Is Shown on Part II, Line 9.
`;

const CURRENT_SCHEDULE_E = `
28                    (a) Name                                    for S    identification number
A HARBORLINE ADVISORS LLC                                          S           47-3310582               X
                   Passive Income and Loss
A                                                                            302,000.
`;

const W2_FROM_ENTITY = {
  name: "Owner W2 2025.pdf",
  reviewRole: "supporting_document",
  text: `
                        a Employee's social security number
                             512-40-8890
                                                     1 Wages, tips, other compensation    2 Federal income tax withheld
  b Employer identification number (EIN)
                                                     288400.00                            51120.00
47-3310582
  c Employer's name, address, and ZIP code
Harborline Advisors LLC
`,
};

const currentReturn = (body) => ({ name: "Client 1040 2025.pdf", reviewRole: "current_return", text: `${body}\n${"filler line to clear the length gate. ".repeat(20)}` });
const priorReturn = (body) => ({ name: "Client 1040 2024.pdf", reviewRole: "prior_return", text: `${body}\n${"filler line to clear the length gate. ".repeat(20)}` });

test("parseMoney: formatos de formulario", () => {
  assert.strictEqual(parseMoney("31,500."), 31500);
  assert.strictEqual(parseMoney("(42,098)"), -42098);
  assert.strictEqual(parseMoney("-410,000."), -410000);
  assert.strictEqual(parseMoney("no es un monto"), null);
});

test("extrae el total de pérdidas no permitidas del año anterior", () => {
  assert.strictEqual(extractUnallowedLossTotal(PRIOR_8582_SUSPENDED), 31500);
  assert.strictEqual(extractUnallowedLossTotal("un return sin Form 8582"), null);
});

test("pérdida suspendida que no llegó al año siguiente", () => {
  const finding = checkSuspendedLossCarryforward(CURRENT_8582_PASSIVE_ENTITY, PRIOR_8582_SUSPENDED);
  assert.ok(finding, "debe detectar que los 31,500 no estan en el return actual");
  assert.strictEqual(finding.severity, "HIGH");
  assert.match(finding.detail, /\$31,500\.00/);
});

test("si el arrastre SÍ figura en el año actual, no dice nada", () => {
  // Deliberadamente generoso: alcanza con que la cifra aparezca en cualquier parte.
  const withCarryforward = CURRENT_8582_PASSIVE_ENTITY.replace("1c (\n", "1c (   31,500.\n");
  assert.strictEqual(checkSuspendedLossCarryforward(withCarryforward, PRIOR_8582_SUSPENDED), null);
});

test("distribución que supera la base sin ganancia de capital reportada", () => {
  assert.deepStrictEqual(extractStockBasis(PRIOR_7203_EXCESS), { basisBeforeDistributions: 410000, distributions: 465000 });
  const finding = checkExcessDistributions(PRIOR_7203_EXCESS, "2024");
  assert.ok(finding);
  assert.match(finding.detail, /\$55,000\.00/);
  // Si la ganancia figura en ese return, se calla.
  assert.strictEqual(checkExcessDistributions(`${PRIOR_7203_EXCESS}\n7 Capital gain or (loss) . . . 7   55,000.`, "2024"), null);
  // Distribuciones por debajo de la base: nada que reportar.
  assert.strictEqual(checkExcessDistributions(PRIOR_7203_EXCESS.replace("465,000.", "12,000."), "2024"), null);
});

test("tratamiento NIIT que se da vuelta entre años", () => {
  const finding = checkNiitTreatmentChange(CURRENT_8960_PASSIVE, PRIOR_8960_ACTIVE, "2024");
  assert.ok(finding);
  assert.match(finding.detail, /\$410,000\.00/);
  assert.match(finding.detail, /\$4,200\.00/);
  // Mismo tratamiento los dos años: silencio.
  assert.strictEqual(checkNiitTreatmentChange(PRIOR_8960_ACTIVE, PRIOR_8960_ACTIVE, "2024"), null);
  // Ajustes chicos en ambos años: no es un vuelco de criterio.
  const small = "b Adjustment for net income or loss derived in the ordinary course of . . . -900.";
  assert.strictEqual(checkNiitTreatmentChange(small, small, "2024"), null);
});

test("sueldo de una entidad cuyo ingreso se declara pasivo", () => {
  const text = `${CURRENT_8582_PASSIVE_ENTITY}\n${CURRENT_SCHEDULE_E}`;
  const finding = checkWagesFromPassiveEntity(text, [W2_FROM_ENTITY]);
  assert.ok(finding, "el EIN del W-2 esta en el return y la entidad esta en el 8582");
  assert.match(finding.detail, /HARBORLINE ADVISORS LLC/);
  assert.match(finding.detail, /47-3310582/);
  assert.match(finding.detail, /\$288,400\.00/);
});

test("sin W-2 de esa entidad, o sin sección pasiva, no inventa el hallazgo", () => {
  const text = `${CURRENT_8582_PASSIVE_ENTITY}\n${CURRENT_SCHEDULE_E}`;
  const otherW2 = { ...W2_FROM_ENTITY, text: W2_FROM_ENTITY.text.replace("47-3310582", "11-2223334") };
  assert.strictEqual(checkWagesFromPassiveEntity(text, [otherW2]), null);
  assert.strictEqual(checkWagesFromPassiveEntity(CURRENT_SCHEDULE_E, [W2_FROM_ENTITY]), null);
  assert.strictEqual(checkWagesFromPassiveEntity(text, []), null);
});

test("w2BoxOneWages lee la casilla 1, no el número de casilla", () => {
  // La etiqueta dice "1 Wages, tips, other compensation   2 Federal income tax withheld";
  // leer el importe de esa linea devuelve 2. Un hallazgo que dice "$2.00 de sueldo" se
  // desacredita solo.
  assert.strictEqual(w2BoxOneWages(W2_FROM_ENTITY.text), 288400);
  assert.strictEqual(w2BoxOneWages("sin nada parecido a un W-2"), null);
});

test("runPriorYearChecks: encadena todo y falla cerrado", () => {
  const files = [
    currentReturn(`${CURRENT_8582_PASSIVE_ENTITY}\n${CURRENT_SCHEDULE_E}\n${CURRENT_8960_PASSIVE}`),
    priorReturn(`${PRIOR_8582_SUSPENDED}\n${PRIOR_7203_EXCESS}\n${PRIOR_8960_ACTIVE}`),
    W2_FROM_ENTITY,
  ];
  const found = runPriorYearChecks(files, { taxYear: "2025" });
  assert.strictEqual(found.length, 4, "los cuatro cruces deben disparar");
  assert.ok(found.every((f) => f.severity === "HIGH" && f.action && f.authority));
  assert.match(found.find((f) => /2024 return/.test(f.title)).title, /2024/, "usa el año anterior real, no un literal");

  // Sin declaración anterior solo puede correr el cruce del año actual.
  assert.strictEqual(runPriorYearChecks(files.filter((f) => f.reviewRole !== "prior_return"), { taxYear: "2025" }).length, 1);
  // Sin nada, nada. Nunca un hallazgo adivinado.
  assert.deepStrictEqual(runPriorYearChecks([], {}), []);
  assert.deepStrictEqual(runPriorYearChecks(null, {}), []);
  assert.deepStrictEqual(runPriorYearChecks([{ name: "x.pdf", reviewRole: "current_return", text: "corto" }], {}), []);
});

test("los cruces leen el documento íntegro, no el recortado para el prompt", () => {
  // Falla real de produccion: los cruces corrian sobre `text`, que es lo que entro en el
  // presupuesto de tokens. La declaracion anterior se compacta de ~199k a ~34k caracteres
  // conservando principio y final, y su Form 8582 Parte VII cae al 90% del documento —
  // dentro de lo que la compactacion tira. Los cuatro cruces volvian vacios.
  const priorFull = `${PRIOR_8582_SUSPENDED}\n${PRIOR_7203_EXCESS}\n${PRIOR_8960_ACTIVE}`;
  const currentFull = `${CURRENT_8582_PASSIVE_ENTITY}\n${CURRENT_SCHEDULE_E}\n${CURRENT_8960_PASSIVE}`;
  const relleno = "linea de relleno que empuja las formas fuera del recorte. ".repeat(400);
  const compactar = (t) => `${t.slice(0, 200)}\n[...]\n${t.slice(-200)}`;

  const files = [
    { name: "Client 1040 2025.pdf", reviewRole: "current_return", text: compactar(`${relleno}\n${currentFull}\n${relleno}`), fullText: `${relleno}\n${currentFull}\n${relleno}` },
    { name: "Client 1040 2024.pdf", reviewRole: "prior_return", text: compactar(`${relleno}\n${priorFull}\n${relleno}`), fullText: `${relleno}\n${priorFull}\n${relleno}` },
    W2_FROM_ENTITY,
  ];
  assert.strictEqual(runPriorYearChecks(files, { taxYear: "2025" }).length, 4, "con fullText deben disparar los cuatro");

  // Sin fullText — el estado que produjo el fallo — los formularios no estan en el texto.
  const soloCompactado = files.map((f) => ({ ...f, fullText: undefined }));
  assert.strictEqual(runPriorYearChecks(soloCompactado, { taxYear: "2025" }).length, 0);
});
