/**
 * scheduleCGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a CSV for Drake's Schedule C import (1040 / sole proprietors).
 *
 * IMPORTANTE:
 *   Drake NO soporta TXF para Sch C.  El único camino para 1040 es:
 *     a) Transacciones individuales mapeadas a líneas de Sch C (este módulo)
 *     b) Trial Balance si el cliente tiene contabilidad formal — pero Drake
 *        no ofrece TB import para 1040; usar este CSV.
 *
 * Columnas CSV (posición determina el campo):
 *   1  Date             — MM/DD/YYYY de la transacción  o vacío para totales
 *   2  Merchant         — Nombre del comerciante / payer
 *   3  Description      — Descripción
 *   4  Amount           — Monto (positivo para ingresos, negativo para gastos)
 *   5  Category         — Categoría del campo (label del canonical key)
 *   6  Tax_Category     — Categoría Drake (ej. "Schedule C")
 *   7  Schedule_C_Line  — Número de línea de Sch C (8, 9, 10, …, 27a)
 *   8  TXF_Reference    — Referencia TXF (no aplica, pero Drake puede usarla)
 *   9  AI_Confidence    — 0.0–1.0 del proceso de extracción (referencia)
 *   10 Review_Required  — true | false
 *
 * Cuando se genera desde canonical data (workpaper con totales),
 * cada campo del workpaper produce una fila de resumen (Date vacío).
 *
 * 🔒 Verificar el orden exacto de columnas contra:
 *    Drake → transaction import screen documentation.
 *    Ver PENDING.md → "Verificación de column order (Schedule C)".
 */

const { loadDrakeFieldMap, lookupField, drakeLabel } = require('../lib/drakeFieldMap');

/** Map canonicalKey → Schedule C line number. */
const SCH_C_LINE = {
  'schC.gross_receipts':    '1',
  'schC.returns':           '2',
  'schC.cogs':              '4',
  'schC.advertising':       '8',
  'schC.car_truck':         '9',
  'schC.commissions':       '10',
  'schC.contract_labor':    '11',
  'schC.depreciation':      '13',
  'schC.insurance':         '15',
  'schC.interest_mortgage': '16a',
  'schC.interest_other':    '16b',
  'schC.legal_professional':'17',
  'schC.office_expense':    '18',
  'schC.rent_lease_vehicle':'20a',
  'schC.rent_lease_other':  '20b',
  'schC.rent':              '20',
  'schC.repairs':           '21',
  'schC.supplies':          '22',
  'schC.taxes_licenses':    '23',
  'schC.travel':            '24a',
  'schC.meals':             '24b',
  'schC.utilities':         '25',
  'schC.wages':             '26',
  'schC.other_expenses':    '27a',
};

/** CSV cell escaping. */
function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function numVal(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const HEADERS = [
  'Date',
  'Merchant',
  'Description',
  'Amount',
  'Category',
  'Tax_Category',
  'Schedule_C_Line',
  'TXF_Reference',
  'AI_Confidence',
  'Review_Required',
];

/**
 * Generate Schedule C CSV from canonical return data.
 *
 * @param {Object}  data              CanonicalReturn (from workpaperParser)
 * @param {Object}  [options]
 * @param {boolean} [options.includeHeader=true]
 * @param {boolean} [options.includeIncome=false]  Include non-schC income fields
 * @returns {string}  CSV content
 */
function generateScheduleC(data, options = {}) {
  if (!data || data.client?.entityType !== '1040') {
    throw new Error('generateScheduleC: entityType must be 1040');
  }

  const { includeHeader = true, includeIncome = false } = options;

  let fieldMap;
  try {
    fieldMap = loadDrakeFieldMap('1040');
  } catch (_) {
    fieldMap = { map: {} };
  }

  const lines = [];
  if (includeHeader) lines.push(HEADERS.map(csvCell).join(','));

  const skipped = [];

  for (const field of data.fields || []) {
    if (field.flag === 'manual' || field.flag === 'error') {
      skipped.push(field.canonicalKey);
      continue;
    }
    // Include schC.* always; income.* only if requested
    const isSchC   = field.canonicalKey.startsWith('schC.');
    const isIncome = field.canonicalKey.startsWith('income.');
    if (!isSchC && !(includeIncome && isIncome)) continue;

    const amount   = numVal(field.value);
    if (!amount) continue;

    const entry    = lookupField(fieldMap, field.canonicalKey);
    const label    = entry ? drakeLabel(entry) : field.canonicalKey;
    const schCLine = SCH_C_LINE[field.canonicalKey] || '';

    // Income fields go positive, expense fields go negative in accounting
    const isExpense = field.canonicalKey.startsWith('schC.') &&
                      !['schC.gross_receipts', 'schC.returns'].includes(field.canonicalKey);
    const signedAmount = isExpense ? -Math.abs(amount) : Math.abs(amount);

    const row = [
      csvCell(''),                      // Date — empty for summary totals
      csvCell(''),                      // Merchant
      csvCell(label),                   // Description
      csvCell(signedAmount.toFixed(2)), // Amount
      csvCell(label),                   // Category
      csvCell('Schedule C'),            // Tax_Category
      csvCell(schCLine),                // Schedule_C_Line
      csvCell(''),                      // TXF_Reference
      csvCell('1.0'),                   // AI_Confidence (workpaper = reviewed)
      csvCell(field.flag === 'review' ? 'true' : 'false'), // Review_Required
    ];
    lines.push(row.join(','));
  }

  return lines.join('\n');
}

/**
 * Build a complete artifact ready for DrakeLoader / companion.
 * @param {Object} data  CanonicalReturn
 * @returns {{ content: string, filename: string, mimetype: string, meta: Object }}
 */
function buildArtifact(data) {
  const content  = generateScheduleC(data);
  const safeName = String(data.client?.name || data.client?.ein || 'client')
    .replace(/[^A-Za-z0-9]/g, '_').slice(0, 40);
  const filename = `${safeName}_ScheduleC.csv`;
  const rowCount = content.split('\n').length - 1; // exclude header

  return {
    content,
    filename,
    mimetype: 'text/csv',
    meta: { rowCount, entityType: '1040', taxYear: data.taxYear },
  };
}

module.exports = { generateScheduleC, buildArtifact, SCH_C_LINE, HEADERS };
