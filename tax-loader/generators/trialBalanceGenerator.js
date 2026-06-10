/**
 * trialBalanceGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a Trial Balance .xlsx file in Drake's import format.
 *
 * CRÍTICO — Template strategy:
 *   Drake's importer requires the official template structure.
 *   Modifying rows/columns outside the editable cells corrupts the import.
 *
 *   Strategy A (recommended):
 *     Pass the real Drake template path.  The generator opens it with ExcelJS,
 *     locates account-title rows in column C, writes debit/credit values into
 *     columns E and H, and saves to outputPath.
 *
 *   Strategy B (test / preview):
 *     Pass templatePath = null.  The generator builds a minimal synthetic
 *     workbook with the same column layout so tests can run without a real
 *     Drake installation.  ⚠️ Drake will NOT accept this file for import.
 *
 * Known Drake TB template layout (confirmed from drakeFormat.js):
 *   Row 1, col B  → Company Name
 *   Row 3, col B  → Year End (MM/DD/YYYY)
 *   Col C          → Account Title (used for row lookup)
 *   Col E          → Debit amount
 *   Col H          → Credit amount
 *
 * 🔒 Exact column positions must be verified against the real template.
 *    See PENDING.md → "Templates de Drake".
 */

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');

const { loadDrakeFieldMap, lookupField, drakeLabel } = require('../lib/drakeFieldMap');

/** Normalize a title string for fuzzy row matching (strip non-alphanumeric). */
function normalizeTitle(t) {
  return String(t || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Parse a numeric value (accepts number, string with $, commas, etc.).
 * @param {*} v
 * @returns {number}
 */
function numVal(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Determine debit/credit side for a canonical key + amount.
 * @param {string} canonicalKey
 * @param {number} amount  (signed; negative flips side)
 * @param {string|undefined} mappedSide  'debit' | 'credit' from field map
 */
function determineSide(canonicalKey, amount, mappedSide) {
  let normal;
  if (mappedSide === 'debit' || mappedSide === 'credit') {
    normal = mappedSide;
  } else {
    const creditPrefixes = [
      'income.', 'balance.ap', 'balance.other_liabilities',
      'balance.retained_earnings', 'capital.', 'm2.',
      'm1.tax_exempt_interest',
    ];
    normal = creditPrefixes.some(p => canonicalKey.startsWith(p)) ? 'credit' : 'debit';
  }
  // Negative amount flips the side
  if (amount < 0) return normal === 'credit' ? 'debit' : 'credit';
  return normal;
}

/**
 * Build the list of { accountTitle, debit, credit } rows from canonical data.
 * @param {Object} data  CanonicalReturn
 * @param {Object} fieldMap  result of loadDrakeFieldMap
 * @returns {{ rows: Array, skipped: string[] }}
 */
function buildRows(data, fieldMap) {
  const rows    = [];
  const skipped = [];

  for (const field of data.fields || []) {
    if (field.flag === 'manual' || field.flag === 'error') {
      skipped.push(field.canonicalKey);
      continue;
    }
    const entry = lookupField(fieldMap, field.canonicalKey);
    if (!entry) {
      skipped.push(field.canonicalKey);
      continue;
    }
    const amount = numVal(field.value);
    if (!amount) continue;
    const side  = determineSide(field.canonicalKey, amount, entry.drakeDebitCredit);
    const title = drakeLabel(entry) || field.canonicalKey;
    rows.push({
      canonicalKey: field.canonicalKey,
      accountTitle: title,
      debit:  side === 'debit'  ? Math.abs(amount) : null,
      credit: side === 'credit' ? Math.abs(amount) : null,
    });
  }

  return { rows, skipped };
}

/**
 * Create a minimal synthetic workbook that mimics Drake's TB column layout.
 * Used for testing only — Drake will reject this file as an import.
 * @param {string} clientName
 * @param {string} yearEnd
 * @param {Array}  rows  [{ accountTitle, debit, credit }]
 * @returns {ExcelJS.Workbook}
 */
function buildSyntheticWorkbook(clientName, yearEnd, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('TB');

  // Mimic Drake's known layout
  ws.getCell(1, 2).value = clientName;
  ws.getCell(3, 2).value = yearEnd;

  // Header row at row 5 (typical Drake TB layout)
  ws.getCell(5, 3).value = 'Account Title';
  ws.getCell(5, 5).value = 'Debit';
  ws.getCell(5, 8).value = 'Credit';

  rows.forEach((row, i) => {
    const r = 6 + i;
    ws.getCell(r, 3).value = row.accountTitle;
    if (row.debit  !== null) ws.getCell(r, 5).value = row.debit;
    if (row.credit !== null) ws.getCell(r, 8).value = row.credit;
  });

  return wb;
}

/**
 * Write rows into an existing workbook by matching account titles in col C.
 * @param {ExcelJS.Workbook} wb
 * @param {string} sheetName  tab name in the template
 * @param {string} clientName
 * @param {string} yearEnd
 * @param {Array}  rows
 * @returns {{ missing: string[] }}
 */
function writeIntoTemplate(wb, sheetName, clientName, yearEnd, rows) {
  // Try to find the sheet; fall back to first sheet
  const ws = wb.getWorksheet(sheetName) || wb.worksheets[0];
  if (!ws) throw new Error(`Template sheet "${sheetName}" not found.`);

  if (clientName) ws.getCell(1, 2).value = clientName;
  if (yearEnd)    ws.getCell(3, 2).value = yearEnd;

  // Build title index from col C
  const titleIndex = {};
  ws.eachRow((row, rowNum) => {
    const cellVal = row.getCell(3).value;
    if (!cellVal) return;
    const key = normalizeTitle(String(cellVal));
    if (key && !(key in titleIndex)) titleIndex[key] = rowNum;
  });

  const missing = [];
  for (const row of rows) {
    const key = normalizeTitle(row.accountTitle);
    const rowNum = titleIndex[key];
    if (!rowNum) {
      missing.push(row.accountTitle);
      continue;
    }
    if (row.debit  !== null) ws.getCell(rowNum, 5).value = row.debit;
    if (row.credit !== null) ws.getCell(rowNum, 8).value = row.credit;
  }

  return { missing };
}

/**
 * Generate a Trial Balance workbook buffer from canonical return data.
 *
 * @param {Object}      data          CanonicalReturn (from workpaperParser)
 * @param {string|null} templatePath  Path to Drake .xls template (null = synthetic)
 * @param {string}      [sheetName]   Worksheet name in the template
 * @returns {Promise<{ buffer: Buffer, filename: string, meta: Object }>}
 */
async function generateTrialBalance(data, templatePath, sheetName) {
  if (!data || !data.client) throw new Error('generateTrialBalance: data is required');

  const entityType = data.client.entityType;
  if (!['1120S', '1065', '1120'].includes(entityType)) {
    throw new Error(`Trial Balance import is for business entities only (got "${entityType}")`);
  }

  // 🔒 REQUIERE TEMPLATE REAL — load field map
  const fieldMap = loadDrakeFieldMap(entityType);
  const { rows, skipped } = buildRows(data, fieldMap);

  const clientName = data.client.name || data.client.ein || 'Client';
  const yearEnd    = data.taxYear ? `12/31/${data.taxYear}` : '';
  const filename   = `${clientName.replace(/[^A-Za-z0-9]/g, '_').slice(0, 40)}TB.xls`;

  // Verify debits = credits
  const totalDebits  = rows.reduce((s, r) => s + (r.debit  ?? 0), 0);
  const totalCredits = rows.reduce((s, r) => s + (r.credit ?? 0), 0);
  const balanced     = Math.abs(totalDebits - totalCredits) < 0.01;

  let wb;
  let missing = [];

  if (templatePath) {
    // Strategy A — use real Drake template
    if (!fs.existsSync(templatePath)) {
      throw new Error(
        `Template de Drake no encontrado en: ${templatePath}\n` +
        'Para obtenerlo: Drake → Import → Trial Balance Import → Create New.\n' +
        'Ver PENDING.md → "Templates de Drake (BLOQUEANTE)".'
      );
    }
    wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);
    const result = writeIntoTemplate(wb, sheetName || 'TB', clientName, yearEnd, rows);
    missing = result.missing;
  } else {
    // Strategy B — synthetic (tests / preview only)
    wb = buildSyntheticWorkbook(clientName, yearEnd, rows);
  }

  const buffer = await wb.xlsx.writeBuffer();

  return {
    buffer,
    filename,
    mimetype: 'application/vnd.ms-excel',
    meta: {
      entityType,
      fieldCount: rows.length,
      skipped,
      missing,
      totalDebits,
      totalCredits,
      balanced,
      templateUsed: templatePath || 'SYNTHETIC',
      clientName,
      taxYear: data.taxYear,
    },
  };
}

/**
 * Sum debits and credits for a set of rows — used by tests to verify balance.
 * @param {Array} rows
 * @returns {{ debits: number, credits: number, balanced: boolean }}
 */
function checkBalance(rows) {
  const debits  = rows.reduce((s, r) => s + (r.debit  ?? 0), 0);
  const credits = rows.reduce((s, r) => s + (r.credit ?? 0), 0);
  return { debits, credits, balanced: Math.abs(debits - credits) < 0.01 };
}

module.exports = { generateTrialBalance, buildRows, checkBalance, normalizeTitle };
