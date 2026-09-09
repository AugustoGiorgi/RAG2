"use strict";

/**
 * depreciation-check.js — recalcular la depreciacion MACRS en vez de opinar sobre ella.
 *
 * Por que existe: un informe de produccion reporto como HIGH que la depreciacion de un vehiculo
 * "parece subestimada", y estaba exactamente bien. El Form 4562 Parte V imprime, en la misma
 * linea, el costo, la BASE DEPRECIABLE, el periodo de recuperacion, el metodo y la deduccion:
 *
 *   TESLA MODEL 4/20/24 100.0 40,540. 4,016. 5.0 200DB HY 1,285.
 *
 * El modelo leyo la base de 4.016 como "depreciacion acumulada", se calculo una base propia de
 * 3.213, y concluyo que 1.285 era poco. La cuenta correcta es 4.016 x 32% = 1.285,12 — año dos
 * de una tabla de cinco años, 200DB, medio año, clavado al centavo. Y en el mismo hallazgo, la
 * recomendacion decia "recalcular sobre la base de 4.016", contradiciendo su propio calculo.
 *
 * Esto es aritmetica de tabla, no criterio profesional, asi que sale del modelo y pasa al
 * codigo. El modulo hace dos cosas: reporta una deduccion que supera lo que la tabla permite, y
 * —igual de importante— deja constancia de las que RECALCULO Y DAN BIEN, para que un hallazgo
 * del modelo que diga lo contrario se pueda bajar de categoria con la cuenta a la vista.
 *
 * Fail-closed: un metodo que no esta en las tablas, una linea que no se puede parsear o un año
 * fuera del periodo de recuperacion no producen ni hallazgo ni verificacion.
 */

/**
 * La linea de propiedad listada del Form 4562 Parte V, tal como la imprime el software:
 * descripcion, fecha en servicio, % de uso, costo, base depreciable, recuperacion, metodo y
 * convencion, deduccion, y opcionalmente la seccion 179.
 */
const LISTED_PROPERTY_LINE = /^(.{2,44}?)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,3}(?:\.\d+)?)\s+([\d,]+)\.?\s+([\d,]+)\.?\s+(\d{1,2}(?:\.\d)?)\s+(200DB|150DB|S\/L|SL)\s+(HY|MQ|MM)\s+([\d,]+)\.?/;

/**
 * Las tablas del Rev. Proc. 87-57, en porcentaje de la base depreciable por año.
 * Solo convencion de medio año, que es la que aplica a casi toda la propiedad listada.
 */
const MACRS_HALF_YEAR = {
  "200DB": {
    3: [33.33, 44.45, 14.81, 7.41],
    5: [20.00, 32.00, 19.20, 11.52, 11.52, 5.76],
    7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
    10: [10.00, 18.00, 14.40, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
  },
  "150DB": {
    5: [15.00, 25.50, 17.85, 16.66, 16.66, 8.33],
    7: [10.71, 19.13, 15.03, 12.25, 12.25, 12.25, 12.25, 6.13],
    15: [5.00, 9.50, 8.55, 7.70, 6.93, 6.23, 5.90, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 5.90, 5.91, 2.95],
  },
};

/** Tolerancia: el formulario imprime en dolares enteros y la tabla trae dos decimales. */
const CENTS_TOLERANCE = 2;

function parseAmount(raw) {
  const n = Number(String(raw || "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function yearOf(dateText) {
  const parts = String(dateText || "").split("/");
  if (parts.length !== 3) return null;
  const raw = Number(parts[2]);
  if (!Number.isFinite(raw)) return null;
  return raw < 100 ? 2000 + raw : raw;
}

/** La depreciacion que la tabla permite para ese año, o null si no se puede saber. */
function tableAmount({ method, recovery, basis, yearIndex }) {
  const table = MACRS_HALF_YEAR[method];
  if (!table) return null;
  const row = table[Math.round(recovery)];
  if (!row) return null;
  if (yearIndex < 1 || yearIndex > row.length) return null;
  return Math.round(basis * (row[yearIndex - 1] / 100) * 100) / 100;
}

/**
 * Cada linea de propiedad listada que se pudo recalcular.
 * Devuelve { label, basis, method, recovery, yearIndex, claimed, expected, agrees }.
 */
function listedProperty(text, taxYear) {
  const year = Number(String(taxYear || "").match(/\d{4}/)?.[0]);
  if (!Number.isFinite(year)) return [];
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const hit = LISTED_PROPERTY_LINE.exec(line.trim());
    if (!hit) continue;
    const placedYear = yearOf(hit[2]);
    const basis = parseAmount(hit[5]);
    const recovery = Number(hit[6]);
    const method = hit[7] === "SL" ? "S/L" : hit[7];
    const convention = hit[8];
    const claimed = parseAmount(hit[9]);
    if (placedYear === null || basis === null || claimed === null || !Number.isFinite(recovery)) continue;
    // Solo medio año: las otras convenciones tienen tablas propias y no vale adivinar.
    if (convention !== "HY") continue;
    const yearIndex = year - placedYear + 1;
    const expected = tableAmount({ method, recovery, basis, yearIndex });
    if (expected === null) continue;
    out.push({
      label: hit[1].trim(),
      basis,
      method,
      recovery,
      yearIndex,
      claimed,
      expected,
      agrees: Math.abs(claimed - expected) <= CENTS_TOLERANCE,
    });
  }
  return out;
}

/**
 * Una deduccion que supera lo que la tabla permite.
 *
 * Solo se reporta el exceso, nunca el defecto: una deduccion MENOR que la tabla tiene
 * explicaciones legitimas — el tope del §280F para automoviles, un año corto, una baja a mitad
 * de año — y marcarlas seria exactamente el falso positivo que este modulo vino a evitar.
 */
function checkListedPropertyDepreciation(text, meta = {}) {
  const rows = listedProperty(text, meta.taxYear);
  const over = rows.filter((row) => row.claimed - row.expected > CENTS_TOLERANCE);
  if (!over.length) return null;
  const first = over[0];
  const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const list = over.slice(0, 3).map((row) =>
    `${row.label}: the return deducts ${money(row.claimed)} where ${money(row.basis)} of basis in year ${row.yearIndex} of a ${row.recovery}-year ${row.method} half-year schedule allows ${money(row.expected)}`).join("; ");
  return {
    severity: "HIGH",
    category: "Depreciation",
    title: "Listed property depreciation exceeds the MACRS table",
    detail: `${list}. The excess is ${money(first.claimed - first.expected)} on the first item.`,
    action: "Recompute the year's depreciation from the basis printed on Form 4562 Part V using the applicable MACRS percentage, or identify the election that supports the larger figure. An amount above the table is either a wrong recovery year, a wrong method, or a basis that no longer matches the schedule.",
    authority: "IRC §168; Rev. Proc. 87-57 MACRS percentage tables; Form 4562 Part V",
    dedupe: /depreciation|form 4562|macrs/i,
  };
}

/**
 * Las lineas que se recalcularon y dan bien. Sirven para que un hallazgo del modelo que diga
 * que esa misma cifra esta mal se pueda bajar de categoria mostrando la cuenta.
 */
function verifiedDepreciation(text, meta = {}) {
  return listedProperty(text, meta.taxYear).filter((row) => row.agrees);
}

module.exports = {
  checkListedPropertyDepreciation, verifiedDepreciation, listedProperty, tableAmount,
  LISTED_PROPERTY_LINE, MACRS_HALF_YEAR, CENTS_TOLERANCE,
};
