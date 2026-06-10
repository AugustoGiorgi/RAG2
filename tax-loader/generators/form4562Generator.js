/**
 * form4562Generator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a CSV/XLSX for Drake's Form 4562 (depreciation) import.
 *
 * FORMATO VERIFICADO (Drake 2025 — fuente: IMPORT4562.DLL strings + soporte):
 *   - Formato de archivo: XLSX, CSV, o TAB
 *   - El orden de columnas determina el campo (no el header)
 *   - URL del template oficial de Drake: https://support.drakesoftware.com/Import4562
 *   - Ruta de import: Return → toolbar Import → Form 4562 Import
 *   - Ruta de archivo: C:\DRAKE25\IMPORT\
 *
 * 23 columnas federales en orden exacto de Drake (extraídas de IMPORT4562.DLL):
 *   1  Description                    Descripción del activo
 *   2  Date_Acquired                  MMDDYYYY (fecha de adquisición)
 *   3  Cost_Basis                     Costo del activo
 *   4  Business_Use                   Porcentaje de uso empresarial (0–100)
 *   5  Used_Property                  X si es propiedad usada | blank
 *   6  Listed_Prop_Type               V (vehicle) | E (electric) | X (other) | blank
 *   7  Property_Type                  1–5 (per Drake property type codes) | blank
 *   8  Building_Qualifies_for_        X si califica para Section 1263A | blank
 *        Section_1263
 *   9  Method                         SL | 200DB | 150DB | MACRS | HY | blank
 *   10 Life                           Vida útil: 5 | 7 | 10 | 15 | 27.5 | 39 | etc.
 *   11 Prior_depreciation             Depreciación acumulada de años anteriores
 *   12 Salvage_value                  Valor de rescate (normalmente 0 o blank)
 *   13 Override_regular_depreciation  Override del cálculo automático | blank
 *   14 SEC179_expense_elected_        Deducción Sec. 179 elegida este año
 *        this_year
 *   15 SEC179_expense_allowed_        Deducción Sec. 179 permitida este año
 *        this_year
 *   16 SEC179_expense_elected_        Deducción Sec. 179 elegida en años anteriores
 *        in_prior_years
 *   17 SEC179_expense_allowed_        Deducción Sec. 179 permitida en años anteriores
 *        in_prior_years
 *   18 Bonus_depreciation             Bonus depreciation (Special 100%) este año
 *   19 Prior_bonus_depr_Safe_Harbor   Prior bonus depreciation (Safe Harbor method)
 *   20 Prior_bonus_depreciation       Prior bonus depreciation
 *   21 Basis_ONLY_if_different_       Base alternativa (solo si difiere del Cost_Basis)
 *        from_cost
 *   22 Land_cost                      Costo del terreno (no depreciable)
 *   23 Date_placed_in_service         MMDDYYYY (fecha de puesta en servicio)
 *
 * Nota: Hay columnas adicionales (24+) para State, AMT, Book variants.
 * Este generador cubre las 23 columnas federales core.
 *
 * Input object per asset (assets4562 array):
 * {
 *   description:          string,
 *   dateInService:        string,   // MMDDYYYY | MM/DD/YYYY | YYYY-MM-DD
 *   cost:                 number,
 *   dateAcquired?:        string,   // defaults to dateInService
 *   businessUsePct?:      number,   // 0–100, default 100
 *   usedProperty?:        boolean,  // default false
 *   listedPropType?:      string,   // 'V' | 'E' | 'X' | blank
 *   propertyType?:        string|number,  // 1–5
 *   method?:              string,   // 'SL' | '200DB' | '150DB' | etc., default 'SL'
 *   life?:                number,   // 5 | 7 | 10 | 15 | 27.5 | 39, default 5
 *   priorDepreciation?:   number,   // default 0
 *   salvageValue?:        number,   // default blank
 *   section179?:          number,   // Section 179 elected this year
 *   bonusDepreciation?:   number,   // Bonus depreciation this year
 *   landCost?:            number,   // Land cost (non-depreciable)
 * }
 */

const ExcelJS = require('exceljs');

// Exact Drake column names in the required order (cols 1–23)
const HEADERS = [
  'Description',
  'Date_Acquired',
  'Cost_Basis',
  'Business_Use',
  'Used_Property',
  'Listed_Prop_Type',
  'Property_Type',
  'Building_Qualifies_for_Section_1263',
  'Method',
  'Life',
  'Prior_depreciation',
  'Salvage_value',
  'Override_regular_depreciation',
  'SEC179_expense_elected_this_year',
  'SEC179_expense_allowed_this_year',
  'SEC179_expense_elected_in_prior_years',
  'SEC179_expense_allowed_in_prior_years',
  'Bonus_depreciation',
  'Prior_bonus_depreciation_Safe_Harbor_Method',
  'Prior_bonus_depreciation',
  'Basis_ONLY_if_different_from_cost',
  'Land_cost',
  'Date_placed_in_service',
];

/**
 * Format a date to MMDDYYYY (Drake's required format for 4562 dates).
 * @param {string} raw
 * @returns {string}
 */
function formatDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();

  // Already MMDDYYYY
  if (/^\d{8}$/.test(s)) return s;

  // MM/DD/YYYY → MMDDYYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return slash[1].padStart(2, '0') + slash[2].padStart(2, '0') + slash[3];

  // ISO YYYY-MM-DD → MMDDYYYY
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return iso[2] + iso[3] + iso[1];

  // Native Date parse as last resort
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}${dd}${yyyy}`;
  }

  return s;
}

/**
 * Return a number or empty string (never NaN/null/undefined).
 * @param {*} v
 * @param {*} [defaultVal]
 * @returns {number|string}
 */
function numOrEmpty(v, defaultVal) {
  if (v === null || v === undefined) return defaultVal ?? '';
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : (defaultVal ?? '');
}

/**
 * Build a 23-element row array for a single asset.
 * @param {Object} asset
 * @returns {Array}  23 elements matching HEADERS order
 */
function assetToRow(asset) {
  // Date_Acquired defaults to dateInService if not explicitly provided
  const acqDate = asset.dateAcquired || asset.dateInService;

  return [
    /* 1  Description     */ String(asset.description || ''),
    /* 2  Date_Acquired   */ formatDate(acqDate),
    /* 3  Cost_Basis      */ numOrEmpty(asset.cost, ''),
    /* 4  Business_Use    */ numOrEmpty(asset.businessUsePct, 100),
    /* 5  Used_Property   */ asset.usedProperty ? 'X' : '',
    /* 6  Listed_Prop_Type*/ String(asset.listedPropType || '').toUpperCase(),
    /* 7  Property_Type   */ asset.propertyType != null ? String(asset.propertyType) : '',
    /* 8  Bldg_1263       */ '',
    /* 9  Method          */ String(asset.method || 'SL'),
    /* 10 Life            */ numOrEmpty(asset.life, 5),
    /* 11 Prior_depr      */ numOrEmpty(asset.priorDepreciation, 0),
    /* 12 Salvage_value   */ asset.salvageValue != null ? numOrEmpty(asset.salvageValue, '') : '',
    /* 13 Override_depr   */ '',
    /* 14 SEC179_elected  */ asset.section179 != null ? numOrEmpty(asset.section179, '') : '',
    /* 15 SEC179_allowed  */ '',
    /* 16 SEC179_prior_el */ '',
    /* 17 SEC179_prior_al */ '',
    /* 18 Bonus_depr      */ asset.bonusDepreciation != null
                               ? numOrEmpty(asset.bonusDepreciation, '') : '',
    /* 19 Prior_bonus_SH  */ '',
    /* 20 Prior_bonus     */ '',
    /* 21 Alt_basis       */ '',
    /* 22 Land_cost       */ asset.landCost != null ? numOrEmpty(asset.landCost, '') : '',
    /* 23 Date_in_svc     */ formatDate(asset.dateInService),
  ];
}

/**
 * Generate the Form 4562 XLSX buffer.
 * @param {Array}  assets    Array of asset objects (see format above)
 * @returns {Promise<Buffer>}
 */
async function generate4562(assets) {
  if (!Array.isArray(assets)) throw new Error('generate4562: assets must be an array');

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('4562');

  // Row 1: exact Drake column names (position is what matters, headers aid audit)
  ws.addRow(HEADERS);

  // Rows 2+: one asset per row
  for (const asset of assets) {
    ws.addRow(assetToRow(asset));
  }

  // Style header row
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.commit();

  // Column widths
  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 35 : (i <= 1 || i === 22 ? 14 : 12);
  });

  return wb.xlsx.writeBuffer();
}

/**
 * Build a complete artifact ready for DrakeLoader / companion.
 * @param {Array}  assets
 * @param {string} clientName
 * @returns {Promise<{ buffer: Buffer, filename: string, mimetype: string, meta: Object }>}
 */
async function buildArtifact(assets, clientName) {
  const buffer   = await generate4562(assets);
  const safeName = String(clientName || 'client').replace(/[^A-Za-z0-9]/g, '_').slice(0, 40);
  const filename = `${safeName}_4562.xlsx`;

  return {
    buffer,
    filename,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    meta: { assetCount: assets.length },
  };
}

module.exports = { generate4562, buildArtifact, assetToRow, formatDate, HEADERS };
