"use strict";

/**
 * sheet-text.js — las hojas completas de un Excel, a partir del texto que arma el navegador.
 *
 * El navegador convierte cada Excel dos veces: en texto ("--- Sheet: nombre ---" + CSV, la hoja
 * entera) y en una copia estructurada que se corta en 250 filas. Un mayor real tiene miles de
 * filas, asi que esa copia se quedaba con la mitad de las cuentas — y el prompt la presentaba
 * como la fuente de verdad, y la copia del archivo que se agrega al workbook salia cortada.
 *
 * Este modulo lee las hojas desde el texto, que si esta completo, y arma el aviso para el
 * modelo cuando la copia estructurada no lo esta.
 */

/** Parte un CSV (comillas dobles, "" como comilla escapada, saltos de linea dentro de comillas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = String(text ?? "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else { quoted = false; }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const SHEET_MARKER = /^--- Sheet: (.*) ---$/;

/**
 * Las hojas del texto extraido, como [{ name, rows }]. Sin marcadores (un CSV subido tal cual)
 * todo el texto es una sola hoja sin nombre.
 */
function sheetsFromExtractedText(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const sheets = [];
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current !== null) sheets.push({ name: current, rows: parseCsv(buffer.join("\n")).filter((r) => r.some((c) => String(c).trim())) });
  };
  for (const line of lines) {
    const marker = line.match(SHEET_MARKER);
    if (marker) {
      flush();
      current = marker[1];
      buffer = [];
    } else {
      if (current === null) current = "";
      buffer.push(line);
    }
  }
  flush();
  return sheets.filter((sheet) => sheet.rows.length);
}

/**
 * Las filas completas de una hoja, leidas del texto. Devuelve null si el texto no trae esa hoja
 * exactamente una vez.
 * Con mas de maxRows filas se corta ahi y la ultima fila lo dice, para que nadie la tome por
 * completa.
 */
function fullSheetRows(text, sheetName, maxRows = 10000) {
  // Un ZIP trae varios Excel en el mismo texto, y QuickBooks les pone "Sheet1" a todos: si el
  // nombre aparece mas de una vez no hay forma de saber cual es, y se devuelve null.
  const matches = sheetsFromExtractedText(text).filter((s) => s.name === String(sheetName ?? ""));
  if (matches.length !== 1) return null;
  const sheet = matches[0];
  if (sheet.rows.length <= maxRows) return sheet.rows;
  return [...sheet.rows.slice(0, maxRows), [`[Truncated: showing ${maxRows} of ${sheet.rows.length} rows of this sheet]`]];
}

/** Hojas cuya copia estructurada llego cortada: [{ name, kept, total }]. */
function partialSheets(templates) {
  const out = [];
  for (const template of Array.isArray(templates) ? templates : []) {
    for (const sheet of Array.isArray(template?.sheets) ? template.sheets : []) {
      const kept = Array.isArray(sheet?.rows) ? sheet.rows.length : 0;
      const total = Number(sheet?.totalRows);
      if (Number.isFinite(total) && total > kept) out.push({ name: String(sheet.name ?? ""), kept, total });
    }
  }
  return out;
}

/** El aviso para el modelo cuando alguna hoja de la copia estructurada esta incompleta, o "". */
function partialSheetsNote(templates) {
  const partial = partialSheets(templates);
  if (!partial.length) return "";
  const list = partial.map((s) => `"${s.name}" (first ${s.kept} of ${s.total} rows)`).join("; ");
  return `PARTIAL STRUCTURED COPY: this block does not have every row of ${list}. The complete sheet is the text version of this same file in this message — take every amount, transaction and total for those sheets from the text, and never treat this block as complete.`;
}

module.exports = { parseCsv, sheetsFromExtractedText, fullSheetRows, partialSheets, partialSheetsNote };
