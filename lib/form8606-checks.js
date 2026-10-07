"use strict";

/**
 * form8606-checks.js — la conversion a Roth del Form 8606 contra los Form 5498 del paquete.
 *
 * El "backdoor Roth" es mecanico: se aporta a un IRA tradicional sin deducirlo y se convierte
 * a Roth. Bien cargado casi no paga impuesto, porque lo aportado es base. Se carga mal de dos
 * maneras que el formulario solo no delata:
 *
 *   - el aporte no deducido no se escribe en la linea 1, y la conversion entera queda gravada;
 *   - como valor a fin de año de los IRA tradicionales (linea 6) se usa el del Roth, y el
 *     prorrateo le asigna casi toda la base a un saldo que no existe.
 *
 * Las dos se ven contra el Form 5498 que manda el custodio: la casilla 1 dice lo aportado al
 * IRA tradicional, la 3 lo convertido y la 5 lo que valia cada cuenta el 31 de diciembre. El
 * modelo las dio por verificadas en una declaracion conjunta en la que pasaban las dos, una en
 * el formulario de cada conyuge.
 *
 * Un tercer cruce, el mas simple: un 5498 con conversion y ningun Form 8606 en la declaracion.
 *
 * Mismo criterio que el resto: si un renglon no se deja leer, o no se sabe de quien es una
 * cuenta, no hay hallazgo. Nunca se adivina de quien es un 5498: tiene que nombrar al titular
 * del formulario.
 */

const rf = require("./return-facts");
const { parseMoney } = require("./prior-year-bridge");

const fmt = (n) => `$${Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US")}`;
const sum = (list) => list.reduce((total, n) => total + (Number(n) || 0), 0);
const finding = (severity, category, title, detail, action, authority, evidence) => ({ severity, category, title, detail, action, authority, evidence });

/** Debajo de esto la diferencia no vale un hallazgo; desde aca es HIGH. */
const MIN_EXCESS = 100;
const HIGH_EXCESS = 1000;
/** Un aporte anual a un IRA no pasa de esto: si la casilla 1 "dice" mas, se leyo otra casilla. */
const MAX_IRA_CONTRIBUTION = 8600;

const LINE_1 = /Enter your nondeductible contributions to traditional IRAs for \d{4}/i;

/** El nombre del titular, sin su numero de seguro social ni puntos de iniciales. */
function cleanName(line) {
  const name = String(line || "")
    .replace(/[\dXx*]{3}\s*-\s*[\dXx*]{2}\s*-\s*[\dXx*]{4}/g, " ")
    .replace(/[^A-Za-z '-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = name.split(" ").filter(Boolean);
  // Un renglon que no es un nombre (una etiqueta del formulario) no se toma por uno.
  if (words.length < 2 || words.length > 5 || /\b(?:address|instructions|form|name|married)\b/i.test(name)) return "";
  return name;
}

/** De quien es el formulario: el renglon que sigue al rotulo "Name. If married, ...". */
function ownerName(lines, from) {
  for (let i = from; i >= Math.max(0, from - 45); i -= 1) {
    if (!/^\s*Name\.\s+If married, file a separate form/i.test(lines[i])) continue;
    return cleanName(lines.slice(i + 1, i + 4).find((line) => line.trim()));
  }
  return "";
}

/**
 * Cada Form 8606 de la declaracion, con sus renglones. null en lo que no se lee.
 * Una declaracion conjunta puede traer dos: uno por conyuge.
 */
function forms8606(text) {
  const lines = rf.linesOf(text);
  const starts = [];
  lines.forEach((line, i) => { if (LINE_1.test(line)) starts.push(i); });
  return starts.map((from, k) => {
    const range = { from, to: Math.min(lines.length, k + 1 < starts.length ? starts[k + 1] : from + 130) };
    const read = (label, no) => rf.lineAmount(lines, label, no, range);
    const converted = read(/\b16\s+If you completed Part I, enter the amount from line 8/i, "16");
    return {
      name: ownerName(lines, from),
      contributions: read(LINE_1, "1"),
      basis: read(/Enter your total basis in traditional IRAs/i, "2"),
      yearEndValue: read(/Enter the value of all your traditional IRAs as of December 31/i, "6"),
      distributions: read(/\b7\s+Enter your distributions from traditional IRAs in \d{4}/i, "7"),
      converted: converted !== null ? converted : read(/Enter the net amount you converted from traditional IRAs to Roth IRAs in \d{4}\.\s*Also/i, "8"),
      basisInConversion: read(/\b17\s+If you completed Part I, enter the amount from line 11/i, "17"),
      taxable: read(/Taxable amount\.\s*Subtract line 17 from line 16/i, "18"),
    };
  });
}

/** Lo deducido como aporte a un IRA: Schedule 1, linea 20. 0 si esta en blanco o no hay Schedule 1. */
function iraDeduction(text) {
  for (const line of rf.linesOf(text)) {
    if (!/^\s*20\s+IRA deduction\b/i.test(line)) continue;
    const amount = rf.tailAmount(line, "20");
    if (amount !== null) return amount;
  }
  return 0;
}

/**
 * Las casillas de un Form 5498: el primer importe en dolares despues del rotulo de la casilla.
 * El custodio intercala su direccion entre el rotulo y el importe, y pone dos rotulos en un
 * renglon con los dos importes en el siguiente; en los dos casos el primero es el de la
 * casilla de la izquierda, que es la que se busca.
 */
function form5498(doc) {
  const text = String((doc && doc.text) || "");
  const first = (label) => {
    const m = label.exec(text);
    if (!m) return null;
    const amount = /\$\s*(-?[\d,]+(?:\.\d{1,2})?)/.exec(text.slice(m.index + m[0].length, m.index + m[0].length + 420));
    return amount ? parseMoney(amount[1]) : null;
  };
  const contributions = first(/\b1\s+IRA contributions/i);
  return {
    name: String((doc && doc.name) || ""),
    text,
    contributions: contributions !== null && contributions <= MAX_IRA_CONTRIBUTION ? contributions : null,
    conversion: first(/\b3\s+Roth IRA conversion\s+amount/i),
    value: first(/\b5\s+Fair market value of\s+account/i),
    rothContributions: first(/\b10\s+Roth IRA contributions/i),
  };
}

/** Un Roth se reconoce por lo que recibio: una conversion o aportes Roth. */
const isRoth = (account) => account.conversion > 0 || account.rothContributions > 0;

/** El documento nombra a esa persona: todas las palabras de su nombre, salvo iniciales. */
function mentions(text, name) {
  const words = String(name || "").split(" ").filter((word) => word.length >= 2);
  if (words.length < 2) return false;
  const hay = String(text || "");
  return words.every((word) => new RegExp(`(^|[^A-Za-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, "i").test(hay));
}

/**
 * El valor a fin de año con que se hizo el prorrateo. Es la linea 6 cuando esta impresa. Un
 * programa que calcula con la hoja de la Publicacion 590-B deja la linea 6 en cero, y entonces
 * se despeja de lo que si imprime: base x convertido / parte no gravada, menos lo convertido.
 */
function valueUsed(form, basis) {
  if (form.yearEndValue > 0) return { value: form.yearEndValue, printed: true };
  const nontaxable = form.basisInConversion;
  if (!(nontaxable > 0) || !(basis > 0) || !(form.converted > 0) || nontaxable >= Math.min(basis, form.converted)) return null;
  const implied = (basis * form.converted) / nontaxable - form.converted - (form.distributions || 0);
  return implied > 0 ? { value: implied, printed: false } : null;
}

function checkForm8606(ctx) {
  const out = [];
  const year = ctx.taxYear;
  // Solo un 5498 del que se leyo alguna casilla: un 1099-R o un transcript del IRS que nombran
  // el 5498 no son una cuenta. Y la misma cuenta mandada dos veces cuenta una.
  const seen = new Set();
  const accounts = (ctx.docs || [])
    .filter((doc) => doc && doc.text && doc.types.includes("5498") && (!doc.year || !year || doc.year === year))
    .map(form5498)
    .filter((account) => {
      if (account.value === null && account.contributions === null && account.conversion === null) return false;
      const key = [account.contributions, account.conversion, account.value, account.rothContributions].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  if (!accounts.length) return out;
  const forms = forms8606(ctx.text);

  // Una conversion informada por el custodio y ningun Form 8606: la Parte II es obligatoria.
  // "Ninguno" es que la declaracion ni lo nombra: si lo nombra y no se pudo leer, no se opina.
  const conversions = accounts.filter((account) => account.conversion > 0);
  if (!forms.length && conversions.length && !/\bForm\s+8606\b/i.test(ctx.text)) {
    out.push(finding(
      "HIGH", "Retirement", "Form 8606 — Roth conversion with no Form 8606",
      `Form 5498 reports ${fmt(sum(conversions.map((a) => a.conversion)))} converted to a Roth IRA in ${year || "the year"} (${conversions.map((a) => a.name).join("; ")}), and the return has no Form 8606. Part II of that form is where the taxable part of a conversion is computed.`,
      "Complete Form 8606: Part I if any traditional IRA contribution was not deducted, and Part II for the conversion. Carry line 18 to Form 1040 line 4b.",
      "Form 8606 instructions, Who Must File; IRC §408A(d)(3)",
      `Form 5498 box 3: ${conversions.map((a) => `${a.name} ${fmt(a.conversion)}`).join("; ")}.`,
    ));
    return out;
  }

  const deducted = iraDeduction(ctx.text);
  for (const form of forms) {
    if (!(form.converted > 0) || form.taxable === null || !form.name) continue;
    const own = accounts.filter((account) => mentions(account.text, form.name));
    if (!own.length) continue;
    const roth = own.filter(isRoth);
    const others = own.filter((account) => !isRoth(account));

    // Lo aportado al IRA tradicional que no se dedujo y tampoco esta en la linea 1.
    const contributed = sum(others.map((account) => account.contributions));
    const missingBasis = !(form.contributions > 0) && !(form.basis > 0) && contributed > 0 && !(deducted > 0) ? contributed : 0;
    const basis = (form.contributions || 0) + (form.basis || 0) + missingBasis;

    // El valor a fin de año que se uso es el de la cuenta Roth.
    const used = valueUsed(form, (form.contributions || 0) + (form.basis || 0));
    const rothUsed = used ? roth.find((account) => account.value > 0 && Math.abs(account.value - used.value) <= Math.max(50, account.value * 0.01)) : null;
    if (!missingBasis && !rothUsed) continue;

    const traditionalValue = sum(others.map((account) => account.value));
    const yearEnd = rothUsed ? traditionalValue : (form.yearEndValue || 0);
    const denominator = yearEnd + form.converted + (form.distributions || 0);
    const ratio = denominator > 0 ? Math.min(1, basis / denominator) : 0;
    const expected = Math.max(0, form.converted - form.converted * ratio);
    const excess = form.taxable - expected;
    if (excess < MIN_EXCESS) continue;

    const taxed = `Form 8606 for ${form.name} taxes ${fmt(form.taxable)} of the ${fmt(form.converted)} converted to a Roth IRA`;
    // La cifra del 5498, que es la que el revisor va a encontrar en el documento. Cuando la
    // linea 6 no la imprime, se dice que es la que sale del calculo.
    const counted = rothUsed ? `${used.printed ? "line 6 counts" : "the computation counts"} ${fmt(rothUsed.value)}` : "";
    let title;
    let detail;
    if (rothUsed && missingBasis) {
      title = "Form 8606 — Roth conversion taxed in full";
      detail = `${taxed}. Line 1 is blank although Form 5498 shows ${fmt(missingBasis)} contributed and not deducted, and ${counted} of traditional IRA money at year-end that is the Roth IRA's value; the traditional IRA held ${fmt(traditionalValue)}.`;
    } else if (rothUsed) {
      title = "Form 8606 — Roth IRA value used as the traditional IRA balance";
      detail = `${taxed}. To get there ${counted} of traditional IRA money at year-end, which is the Roth IRA's value on Form 5498; the traditional IRA held ${fmt(traditionalValue)}.`;
    } else {
      title = "Form 8606 — nondeductible IRA contribution left off line 1";
      detail = `${taxed}: line 1 is blank. Form 5498 shows ${fmt(missingBasis)} contributed to the traditional IRA${year ? ` for ${year}` : ""} and the return does not deduct it on Schedule 1 line 20, so it is basis.`;
    }
    const sources = [...(rothUsed ? [rothUsed] : []), ...others].map((account) => `${account.name} ${account.contributions > 0 ? `box 1 ${fmt(account.contributions)}, ` : ""}box 5 ${fmt(account.value)}`);
    out.push(finding(
      excess >= HIGH_EXCESS ? "HIGH" : "MEDIUM", "Retirement", title, detail,
      `Put the contribution that was not deducted on line 1 and only traditional IRA balances on line 6. The taxable conversion becomes about ${fmt(expected)} instead of ${fmt(form.taxable)}, lowering Form 1040 line 4b by ${fmt(excess)}.`,
      "IRC §408(d)(2) and §408A(d)(3); Form 8606 instructions, lines 1, 6 and 16-18",
      `Form 5498 — ${sources.join("; ")}.`,
    ));
  }
  return out;
}

module.exports = { checkForm8606, forms8606, form5498, iraDeduction, mentions, valueUsed };
