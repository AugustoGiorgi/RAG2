"use strict";
// La conversion a Roth del Form 8606 contra los Form 5498 del paquete (lib/form8606-checks.js).
//
// Nombres, numeros de cuenta y cifras ficticios. El formato de los renglones es el que deja
// pdf.js: el importe despues del numero de linea repetido al final del renglon, y en el 5498
// la direccion del custodio intercalada entre el rotulo de la casilla y su importe.
const { test } = require("node:test");
const assert = require("node:assert");
const f = require("../lib/form8606-checks");
const ic = require("../lib/individual-checks");
const pd = require("../lib/package-docs");

const amount = (v) => (v === "" || v === undefined ? "" : ` ${v}`);

/** Un Form 8606 como lo imprime el programa: cada renglon se puede dejar en blanco. */
function form8606(name, o = {}) {
  const v = { l1: "", l2: "", l3: "", l5: "", l6: "", l7: "", l8: "", l9: "", l16: "", l17: "", l18: "", ...o };
  return [
    "OMB No. 1545-0074",
    "Form 8606",
    "Nondeductible IRAs",
    "2025",
    "Attach to 2025 Form 1040, 1040-SR, or 1040-NR.",
    "Name. If married, file a separate form for each spouse required to file 2025 Form 8606. See instructions. Your social security number",
    `${name} 000-11-2222`,
    "Home address (number and street, or P.O. box if mail is not delivered to your home) Apt. no.",
    "Part I Nondeductible Contributions to Traditional IRAs and Distributions From Traditional IRAs",
    "1 Enter your nondeductible contributions to traditional IRAs for 2025, including those made for 2025 from",
    `January 1, 2026, through April 15, 2026. See instructions . . . . . . . . . . . . . . . 1${amount(v.l1)}`,
    `2 Enter your total basis in traditional IRAs. See instructions . . . . . . . . . . . . . 2${amount(v.l2)}`,
    `3 Add lines 1 and 2 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 3${amount(v.l3)}`,
    "In 2025, did you take a distribution No Enter the amount from line 3 on line 14.",
    "Yes Go to line 4.",
    "4 Enter those contributions included on line 1 that were made from January 1, 2026, through April 15, 2026 . . . 4",
    `5 Subtract line 4 from line 3 . . . . . . . . . . . . . . . . . . . . . . . . . . . 5${amount(v.l5)}`,
    "6 Enter the value of all your traditional IRAs as of December 31, 2025, plus any outstanding rollovers.",
    "Subtract certain 2025 retirement plan distribution repayments treated as rollovers, if any. See",
    `instructions . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 6${amount(v.l6)}`,
    "7 Enter your distributions from traditional IRAs in 2025. Do not include rollovers (but do include certain 2025",
    `contributions; or recharacterizations of traditional IRA contributions. See instructions . . . . . . . 7${amount(v.l7)}`,
    "8 Enter the net amount you converted from traditional IRAs to Roth IRAs in 2025. Also, enter this amount",
    `on line 16 . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 8${amount(v.l8)}`,
    `9 Add lines 6, 7, and 8 . . . . . . . . . . . . . . . . . . . . . . 9${amount(v.l9)}`,
    "14 Subtract line 13 from line 3. This is your total basis in traditional IRAs for 2025 and earlier years . . . 14",
    `Form 8606 (2025) ${name} 000-11-2222 Page 2`,
    "Part II 2025 Conversions From Traditional IRAs to Roth IRAs",
    "16 If you completed Part I, enter the amount from line 8. Otherwise, enter the net amount you converted from",
    `traditional IRAs to Roth IRAs in 2025 . . . . . . . . . . . . . . . . . . . . . . . . 16${amount(v.l16)}`,
    "17 If you completed Part I, enter the amount from line 11. Otherwise, enter your basis in the amount on line 16",
    `See instructions . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 17${amount(v.l17)}`,
    "18 Taxable amount. Subtract line 17 from line 16 . If more than zero, also include this amount on 2025",
    `Form 1040, 1040-SR, or 1040-NR, line 4b . . . . . . . . . . . . . . . . . . . . . . 18${amount(v.l18)}`,
    "Part III Distributions From Roth IRAs",
  ].join("\n");
}

const RETURN_HEAD = [
  "Form 1040 U.S. Individual Income Tax Return 2025 OMB No. 1545-0074",
  "Your first name and middle initial Last name Your social security number",
  "MARA EXAMPLE 000-11-2222",
  "SCHEDULE 1 Additional Income and Adjustments to Income",
].join("\n");
const returnWith = (...forms) => [RETURN_HEAD, ...forms].join("\n");

/** Un Form 5498 con la direccion del custodio intercalada, como llega de verdad. */
function form5498(name, owner, o = {}) {
  const v = { box1: "0.00", box3: "0.00", box5: "0.00", box10: "0.00", year: 2025, ...o };
  return {
    name,
    reviewRole: "supporting_document",
    text: [
      "--- Page 1 ---",
      `${owner}`,
      "400 EXAMPLE AVENUE APT 2",
      `As the custodian of your IRA account, we provide the information submitted on Form 5498, including the fair market value of the account as of 12/31/${String(v.year).slice(2)}.`,
      "CORRECTED (if checked)",
      "1 IRA contributions (other than",
      "TRUSTEE'S or ISSUER'S name, street address, city or town, state or province, country, and OMB No. 1545-0747",
      "amounts in boxes 2-4, 8-10,",
      "13a, and 14a)",
      `$ ${v.box1} IRA`,
      "2 Rollover contributions Contribution",
      "Riverbend Custody LLC",
      `$ 0.00 Form 5498`,
      "3 Roth IRA conversion amount 4 Recharacterized contributions",
      "9th Floor",
      `Lakeside, IL 60000 $ ${v.box3} $ 0.00`,
      "5 Fair market value of account 6 Life insurance cost For",
      "TRUSTEE'S or ISSUER'S TIN PARTICIPANT'S TIN",
      "included in box 1 Participant",
      `XXX-XX-2222 $ ${v.box5} $ 0.00`,
      "PARTICIPANT'S name 7 IRA SEP SIMPLE Roth IRA This information",
      "X is being",
      `${owner}`,
      "8 SEP contributions 9 SIMPLE contributions",
      "$ 0.00 $ 0.00",
      "10 Roth IRA contributions 11 If checked, required",
      "minimum distribution for 2026.",
      `$ ${v.box10}`,
      `Form 5498 ${v.year}`,
    ].join("\n"),
  };
}

const ctxOf = (returnText, documents) => ({ text: returnText, taxYear: 2025, docs: pd.packageDocuments(documents) });
const TRADITIONAL = (owner, o = {}) => form5498(`${owner.split(" ")[0]} traditional IRA 5498.pdf`, owner, { box1: "7,000.00", box5: "0.02", ...o });
const ROTH = (owner, o = {}) => form5498(`${owner.split(" ")[0]} Roth IRA 5498.pdf`, owner, { box3: "7,000.00", box5: "61,480.25", ...o });

test("el Form 8606 se lee renglon por renglon, y un renglon en blanco no es un cero", () => {
  const [form] = f.forms8606(returnWith(form8606("MARA EXAMPLE", { l1: "7,000.", l3: "7,000.", l5: "7,000.", l6: "0.", l16: "7,000.", l17: "715.", l18: "6,285." })));
  assert.deepStrictEqual(form, { name: "MARA EXAMPLE", contributions: 7000, basis: null, yearEndValue: 0, distributions: null, converted: 7000, basisInConversion: 715, taxable: 6285 });
  // Dos formularios en una declaracion conjunta: cada uno con su titular.
  const both = f.forms8606(returnWith(form8606("MARA EXAMPLE", { l1: "7,000.", l16: "7,000.", l18: "0." }), form8606("JOEL P EXAMPLE", { l6: "40,000.", l8: "7,000.", l16: "7,000.", l18: "7,000." })));
  assert.deepStrictEqual(both.map((x) => [x.name, x.contributions, x.yearEndValue, x.taxable]), [["MARA EXAMPLE", 7000, null, 0], ["JOEL P EXAMPLE", null, 40000, 7000]]);
});

test("las casillas del 5498 se leen aunque el custodio intercale su direccion", () => {
  const [doc] = pd.packageDocuments([ROTH("MARA EXAMPLE")]);
  assert.deepStrictEqual(doc.types, ["5498"]);
  const account = f.form5498(doc);
  assert.deepStrictEqual([account.contributions, account.conversion, account.value, account.rothContributions], [0, 7000, 61480.25, 0]);
  // Un "aporte" mayor que el tope anual no es la casilla 1: se leyo otra cosa.
  assert.strictEqual(f.form5498(pd.packageDocuments([form5498("x 5498.pdf", "MARA EXAMPLE", { box1: "61,480.25" })])[0]).contributions, null);
});

test("el valor del Roth usado como saldo del IRA tradicional: linea 6 impresa", () => {
  const form = form8606("MARA EXAMPLE", { l1: "7,000.", l3: "7,000.", l5: "7,000.", l6: "61,480.", l8: "7,000.", l9: "68,480.", l16: "7,000.", l17: "715.", l18: "6,285." });
  const [x, ...rest] = f.checkForm8606(ctxOf(returnWith(form), [TRADITIONAL("MARA EXAMPLE"), ROTH("MARA EXAMPLE")]));
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(x.severity, "HIGH");
  assert.strictEqual(x.title, "Form 8606 — Roth IRA value used as the traditional IRA balance");
  assert.strictEqual(x.detail, "Form 8606 for MARA EXAMPLE taxes $6,285 of the $7,000 converted to a Roth IRA. To get there line 6 counts $61,480 of traditional IRA money at year-end, which is the Roth IRA's value on Form 5498; the traditional IRA held $0.");
  assert.match(x.action, /The taxable conversion becomes about \$0 instead of \$6,285, lowering Form 1040 line 4b by \$6,285\./);
  assert.match(x.evidence, /MARA Roth IRA 5498\.pdf box 5 \$61,480; MARA traditional IRA 5498\.pdf box 1 \$7,000, box 5 \$0\./);
  assert.ok(x.detail.length <= 320 && x.action.length <= 220 && x.evidence.length <= 240, "entra en lo que el informe deja escribir");
});

test("lo mismo cuando el programa calcula con la hoja de la Publicacion 590-B y deja la linea 6 en cero", () => {
  // 7,000 x 7,000 / 715 - 7,000 = 61,531: el valor que se uso se despeja de lo que si se imprime.
  const form = form8606("MARA EXAMPLE", { l1: "7,000.", l3: "7,000.", l5: "7,000.", l6: "0.", l16: "7,000.", l17: "715.", l18: "6,285." });
  assert.strictEqual(Math.round(f.valueUsed(f.forms8606(returnWith(form))[0], 7000).value), 61531);
  const [x] = f.checkForm8606(ctxOf(returnWith(form), [TRADITIONAL("MARA EXAMPLE"), ROTH("MARA EXAMPLE")]));
  assert.match(x.detail, /To get there the computation counts \$61,480 of traditional IRA money at year-end, which is the Roth IRA's value on Form 5498/);
  assert.strictEqual(x.severity, "HIGH");
});

test("el aporte no deducido que no esta en la linea 1: la conversion queda gravada entera", () => {
  const form = form8606("JOEL P EXAMPLE", { l8: "7,000.", l9: "7,000.", l16: "7,000.", l18: "7,000." });
  const [x, ...rest] = f.checkForm8606(ctxOf(returnWith(form), [TRADITIONAL("JOEL P EXAMPLE")]));
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(x.title, "Form 8606 — nondeductible IRA contribution left off line 1");
  assert.strictEqual(x.detail, "Form 8606 for JOEL P EXAMPLE taxes $7,000 of the $7,000 converted to a Roth IRA: line 1 is blank. Form 5498 shows $7,000 contributed to the traditional IRA for 2025 and the return does not deduct it on Schedule 1 line 20, so it is basis.");
  assert.match(x.action, /lowering Form 1040 line 4b by \$7,000\./);
  // Si el aporte se dedujo, no es base y la conversion esta bien gravada.
  const deducted = returnWith(form, "20 IRA deduction . . . . . . . . . . . . . . . . . . . 20 7,000.");
  assert.strictEqual(f.iraDeduction(deducted), 7000);
  assert.deepStrictEqual(f.checkForm8606(ctxOf(deducted, [TRADITIONAL("JOEL P EXAMPLE")])), []);
});

test("las dos cosas juntas en el formulario del conyuge: un solo hallazgo", () => {
  const form = form8606("JOEL P EXAMPLE", { l6: "61,480.", l8: "7,000.", l9: "68,480.", l16: "7,000.", l18: "7,000." });
  const [x, ...rest] = f.checkForm8606(ctxOf(returnWith(form), [TRADITIONAL("JOEL P EXAMPLE"), ROTH("JOEL P EXAMPLE")]));
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(x.title, "Form 8606 — Roth conversion taxed in full");
  assert.match(x.detail, /Line 1 is blank although Form 5498 shows \$7,000 contributed and not deducted, and line 6 counts \$61,480 of traditional IRA money at year-end that is the Roth IRA's value; the traditional IRA held \$0\./);
  assert.ok(x.detail.length <= 320);
});

test("una conversion bien cargada, o una que de verdad es gravada, no dan hallazgo", () => {
  // El caso normal: aporte en la linea 1, IRA tradicional vacio, casi nada gravado.
  const clean = form8606("MARA EXAMPLE", { l1: "7,000.", l3: "7,000.", l5: "7,000.", l6: "0.", l8: "7,000.", l9: "7,000.", l16: "7,000.", l17: "7,000.", l18: "0." });
  assert.deepStrictEqual(f.checkForm8606(ctxOf(returnWith(clean), [TRADITIONAL("MARA EXAMPLE"), ROTH("MARA EXAMPLE")])), []);
  // Otro IRA tradicional con saldo de verdad: el prorrateo grava casi todo, y esta bien.
  const proRata = form8606("MARA EXAMPLE", { l1: "7,000.", l3: "7,000.", l5: "7,000.", l6: "93,000.", l8: "7,000.", l9: "100,000.", l16: "7,000.", l17: "490.", l18: "6,510." });
  const rollover = form5498("MARA rollover IRA 5498.pdf", "MARA EXAMPLE", { box5: "93,000.00" });
  assert.deepStrictEqual(f.checkForm8606(ctxOf(returnWith(proRata), [TRADITIONAL("MARA EXAMPLE"), rollover, ROTH("MARA EXAMPLE")])), []);
});

test("el 5498 de un conyuge no se usa para el formulario del otro", () => {
  // El valor de la linea 6 coincide con el Roth de JOEL, no con el de MARA: no se sabe que
  // sea un error del formulario de ella.
  const form = form8606("MARA EXAMPLE", { l1: "7,000.", l3: "7,000.", l5: "7,000.", l6: "61,480.", l8: "7,000.", l9: "68,480.", l16: "7,000.", l17: "715.", l18: "6,285." });
  assert.deepStrictEqual(f.checkForm8606(ctxOf(returnWith(form), [TRADITIONAL("MARA EXAMPLE"), ROTH("JOEL P EXAMPLE")])), []);
  assert.strictEqual(f.mentions("PARTICIPANT'S name\nJOEL P EXAMPLE", "JOEL P EXAMPLE"), true);
  assert.strictEqual(f.mentions("PARTICIPANT'S name\nJOEL P EXAMPLE", "MARA EXAMPLE"), false);
  assert.strictEqual(f.mentions("EXAMPLES OF MARATHON", "MARA EXAMPLE"), false, "palabras enteras, no pedazos");
});

test("un 5498 de otro año, o un documento que solo nombra el 5498, no cuentan", () => {
  const form = form8606("MARA EXAMPLE", { l1: "7,000.", l3: "7,000.", l5: "7,000.", l6: "61,480.", l8: "7,000.", l9: "68,480.", l16: "7,000.", l17: "715.", l18: "6,285." });
  const lastYear = { ...ROTH("MARA EXAMPLE"), text: `2024 Form 5498\n${ROTH("MARA EXAMPLE", { year: 2024 }).text}` };
  assert.strictEqual(pd.packageDocuments([lastYear])[0].year, 2024);
  assert.deepStrictEqual(f.checkForm8606(ctxOf(returnWith(form), [TRADITIONAL("MARA EXAMPLE"), lastYear])), []);
  const letter = { name: "MARA 1099-R.pdf", reviewRole: "supporting_document", text: "MARA EXAMPLE\nForm 1099-R Gross distribution 7,000.00\nIRA contributions are reported separately on Form 5498 Contribution Information." };
  assert.deepStrictEqual(f.checkForm8606(ctxOf(returnWith(form), [letter])), []);
});

test("una conversion informada por el custodio y ningun Form 8606 en la declaracion", () => {
  const [x, ...rest] = f.checkForm8606(ctxOf(RETURN_HEAD, [TRADITIONAL("MARA EXAMPLE"), ROTH("MARA EXAMPLE")]));
  assert.strictEqual(rest.length, 0);
  assert.strictEqual(x.title, "Form 8606 — Roth conversion with no Form 8606");
  assert.match(x.detail, /^Form 5498 reports \$7,000 converted to a Roth IRA in 2025 \(MARA Roth IRA 5498\.pdf\), and the return has no Form 8606\./);
  // Sin conversion no hay nada que pedir.
  assert.deepStrictEqual(f.checkForm8606(ctxOf(RETURN_HEAD, [TRADITIONAL("MARA EXAMPLE")])), []);
  assert.deepStrictEqual(f.checkForm8606(ctxOf(RETURN_HEAD, [])), []);
});

test("corre con el resto de los cruces del 1040", () => {
  const form = form8606("MARA EXAMPLE", { l1: "7,000.", l3: "7,000.", l5: "7,000.", l6: "61,480.", l8: "7,000.", l9: "68,480.", l16: "7,000.", l17: "715.", l18: "6,285." });
  const files = [{ name: "Example 2025 return.pdf", reviewRole: "current_return", text: returnWith(form) }, TRADITIONAL("MARA EXAMPLE"), ROTH("MARA EXAMPLE")];
  const found = ic.runIndividualChecks(files, { taxYear: "2025", returnType: "1040", now: "2026-09-19T12:00:00Z" });
  assert.ok(found.some((x) => x.title === "Form 8606 — Roth IRA value used as the traditional IRA balance"));
});
