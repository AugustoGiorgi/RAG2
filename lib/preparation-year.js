"use strict";

/**
 * preparation-year.js — que año se prepara, y que hacer con la informacion de otros años.
 *
 * Por que existe: la tab de Preparation mandaba siempre el mismo año, un campo oculto que
 * decia 2024, y el servidor lo corregia tomando el año mas alto que apareciera en los NOMBRES
 * de los archivos. Un mayor de QuickBooks exportado hasta marzo de 2026, con "2026" en el
 * nombre, convertia un workpaper de 2025 en uno de 2026 — y el prompt le decia al modelo que
 * los archivos con "2025" en el nombre eran solo de referencia. Justo al reves.
 *
 * Ahora el preparador elige el año en la tab y esa eleccion manda: ningun nombre de archivo la
 * cambia. Y como se sabe cual es el año, se le pide al modelo que deje afuera las columnas, los
 * saldos y las transacciones de cualquier otro periodo, y que diga en AI Notes que dejo afuera.
 *
 * Sin eleccion (una pestaña con la pagina vieja abierta, una llamada por API) todo sigue como
 * antes: se reconcilia contra los nombres de los archivos.
 */

// El año del workpaper cuando nadie lo eligio: el mayor entre el año que llego y el mas
// reciente que aparezca en los nombres de los archivos. El año que llegaba podia ser el valor
// por defecto de un campo oculto ("2024" mientras se suben balances de 2025), por eso se toma
// el mas tardio. Si no hay ninguno, devuelve lo que llego, o "".
function reconcilePreparationYear(metaYearStr, files) {
  const metaYear = Number(String(metaYearStr || "").match(/\b(20\d{2})\b/)?.[1] || 0);
  let maxFileYear = 0;
  for (const file of Array.isArray(files) ? files : []) {
    const matches = String(file?.name || "").match(/\b(20\d{2})\b/g);
    if (matches) for (const y of matches) maxFileYear = Math.max(maxFileYear, Number(y));
  }
  const reconciled = Math.max(metaYear, maxFileYear);
  return reconciled ? String(reconciled) : String(metaYearStr || "").trim();
}

/** El año elegido, si es un año de cuatro cifras entre 2000 y 2099; si no, "". */
function explicitPreparationYear(value) {
  const text = String(value ?? "").trim();
  return /^20\d{2}$/.test(text) ? text : "";
}

/**
 * Con que año se prepara el workpaper. Devuelve { taxYear, selected }.
 *
 * selected es true solo cuando el preparador eligio el año en la tab y lo que llego es un año
 * valido: entonces ese año manda y los nombres de los archivos no lo tocan. Cualquier otro
 * caso sigue la regla de siempre.
 */
function resolvePreparationYear(metadata = {}, files = []) {
  const received = String(metadata?.taxYear ?? "").trim();
  const chosen = metadata?.taxYearSelected ? explicitPreparationYear(received) : "";
  if (chosen) return { taxYear: chosen, selected: true };
  return { taxYear: reconcilePreparationYear(received, files), selected: false };
}

/**
 * Lo que el modelo tiene que hacer con la informacion que no es del año elegido.
 *
 * Cubre los tres lugares por donde entra otro año en un paquete real: el P&L con columnas
 * comparativas o mensuales que se pasan al año siguiente, el balance a otra fecha, y el detalle
 * de transacciones exportado con un rango de fechas de mas. Para un ejercicio irregular el año
 * es el ejercicio que empieza ese año: si no, un cierre al 30 de junio dejaria afuera la mitad
 * del ejercicio.
 *
 * Lo que no se puede separar no se inventa: si un total mezcla periodos y no esta el detalle, el
 * importe queda en blanco y se explica. Un numero equivocado en el workpaper es peor que uno
 * que falta y dice por que.
 */
function preparationPeriodRule(year) {
  const y = Number(explicitPreparationYear(year));
  if (!y) return "";
  return [
    `SELECTED TAX YEAR: the preparer chose tax year ${y} in the app. Use only financial data that belongs to the ${y} tax year.`,
    `- The ${y} tax year is January 1 through December 31, ${y}, unless the files clearly show a fiscal year that begins in ${y}; in that case the ${y} tax year is that fiscal year, and AI Notes must say so.`,
    `- P&L / income statement: when a report shows more than one period (${y} next to ${y - 1}, or months or quarters that run into ${y + 1}), use only the columns for the ${y} tax year. Never add another period's column into a ${y} amount.`,
    `- Balance sheet: ending balances are the ones dated at the end of the ${y} tax year (December 31, ${y} for a calendar year). A column dated at the end of the prior tax year may be used only as beginning-of-year balances. Ignore balance sheets and columns dated at any other date.`,
    `- Transaction-level reports (general ledger detail, bank or credit card registers, transaction lists): leave out every transaction dated outside the ${y} tax year and compute totals from the remaining transactions only.`,
    `- If a report's totals mix the ${y} tax year with another period and the files do not have the detail to separate them, do not use those totals as ${y} amounts: leave the amount blank and explain why in AI Notes.`,
    `- If a current-year file has no data for the ${y} tax year, do not substitute another year's figures: flag that file in AI Notes.`,
    `- In AI Notes, list each file where data from another period was found and what was left out (the period and the total excluded).`,
  ].join("\n");
}

module.exports = { reconcilePreparationYear, explicitPreparationYear, resolvePreparationYear, preparationPeriodRule };
