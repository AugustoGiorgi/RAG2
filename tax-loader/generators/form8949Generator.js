/**
 * form8949Generator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a CSV for Drake's Form 8949 / Schedule D import.
 *
 * FORMATO VERIFICADO (Drake 2025 — fuente: DRAKEHLP.CHM + IMPORTD.DLL):
 *   - Formato de archivo: CSV, TAB, o XLSX
 *   - El orden de columnas determina el campo (no el header)
 *   - Fechas: MMDDYYYY (8 dígitos, SIN separadores) — diferente a TB import
 *   - Ruta de import: Return → toolbar Import → Form 8949/GruntWorx Trade
 *   - Ruta de archivo: C:\DRAKE25\IMPORT\
 *
 * 40 columnas en orden exacto de Drake (verificado desde DRAKEHLP.CHM):
 *   1  TSJ              T (taxpayer) | S (spouse) | J (joint) | blank→T
 *   2  F                blank = include federal | 0 = exclude
 *   3  State            State routing (e.g. "OH") — where gain is taxable
 *   4  City             City code (state-specific)
 *   5  Form_8949_Box    1=Box A/D (basis reported) | 2=Box B/E | 3=Box C/F
 *   6  Description      Description of property (as shown on 1099-B)
 *   7  Date_Acquired    MMDDYYYY | VARIOUS | INHERIT | INH2010
 *   8  Date_Sold        MMDDYYYY | BANKRUPT | WORTHLESS | EXPIRED
 *   9  Type             S (short-term) | L (long-term) | blank (auto from dates)
 *   10 Ordinary         X if ordinary-gain checkbox | blank
 *   11 Proceeds         Sale proceeds — no $ or commas
 *   12 Cost             Cost or adjusted basis
 *   13 AMT_Cost_Basis   AMT cost basis (if different)
 *   14 Accrued_Discount Accrued market discount
 *   15 Wash_Sale_Loss   Wash sale loss disallowed amount
 *   16 US_Real_Property X if US real property sold by nonresident | blank
 *   17 Adj_1_Code       Adj code 1: B/H/L1/L2/N/O/R1/R2/R3/R4/T/X1/X2/X3/28
 *   18 Adj_1_Amount     Adjustment 1 amount
 *   19 Adj_1_AMT        Adjustment 1 AMT amount
 *   20 Adj_2_Code       Adjustment 2 code
 *   21 Adj_2_Amount     Adjustment 2 amount
 *   22 Adj_2_AMT        Adjustment 2 AMT amount
 *   23 Adj_3_Code       Adjustment 3 code
 *   24 Adj_3_Amount     Adjustment 3 amount
 *   25 Adj_3_AMT        Adjustment 3 AMT amount
 *   26 Fed_WH           Federal tax withheld
 *   27 Loss_Not_Allowed X if loss not allowed | blank
 *   28 Collectibles     X if collectibles transaction | blank
 *   29 QSBS_Code        Q1 | Q2 | Q3 | blank
 *   30 QSBS_Amount      QSB 1202 gain amount
 *   31 State_1          State 1 code (state withholding)
 *   32 State_1_ID       State 1 ID number
 *   33 State_1_WH       State 1 tax withheld
 *   34 State_2          State 2 code
 *   35 State_2_ID       State 2 ID number
 *   36 State_2_WH       State 2 tax withheld
 *   37 State_Use_Code   State use code (e.g. CG for Idaho)
 *   38 State_Adjustment State adjustment to gain/loss
 *   39 State_Cost_Basis State cost basis (if different from federal)
 *   40 LLC_Number       LLC number for state purposes
 *
 * Input object per transaction (transactions8949 array):
 * {
 *   description:    string,
 *   dateAcquired:   string,   // MMDDYYYY | MM/DD/YYYY | YYYY-MM-DD | VARIOUS | INHERIT
 *   dateSold:       string,   // MMDDYYYY | MM/DD/YYYY | YYYY-MM-DD | BANKRUPT | WORTHLESS
 *   proceeds:       number,
 *   basis:          number,
 *   form8949Box?:   string,   // 'A'|'D'→1  'B'|'E'→2  'C'|'F'→3  '1'|'2'|'3'  default:'A'
 *   longShort?:     string,   // 'S'|'SHORT' | 'L'|'LONG' — required when dateAcquired=VARIOUS
 *   ts?:            string,   // 'T'|'S'|'J'  default blank (→T)
 *   adjCode?:       string,   // Adj 1 code
 *   adjAmount?:     number,   // Adj 1 amount
 *   adj2Code?:      string,
 *   adj2Amount?:    number,
 *   adj3Code?:      string,
 *   adj3Amount?:    number,
 *   washSaleLoss?:  number,
 *   fedWH?:         number,
 *   stateCode?:     string,   // State routing (col 3)
 *   state1Code?:    string,   // State 1 for withholding (col 31)
 *   state1WH?:      number,
 *   state2Code?:    string,
 *   state2WH?:      number,
 * }
 */

const HEADERS = [
  'TSJ',
  'F',
  'State',
  'City',
  'Form_8949_Box',
  'Description',
  'Date_Acquired',
  'Date_Sold',
  'Type',
  'Ordinary',
  'Proceeds',
  'Cost',
  'AMT_Cost_Basis',
  'Accrued_Discount',
  'Wash_Sale_Loss',
  'US_Real_Property',
  'Adj_1_Code',
  'Adj_1_Amount',
  'Adj_1_AMT',
  'Adj_2_Code',
  'Adj_2_Amount',
  'Adj_2_AMT',
  'Adj_3_Code',
  'Adj_3_Amount',
  'Adj_3_AMT',
  'Fed_WH',
  'Loss_Not_Allowed',
  'Collectibles',
  'QSBS_Code',
  'QSBS_Amount',
  'State_1',
  'State_1_ID',
  'State_1_WH',
  'State_2',
  'State_2_ID',
  'State_2_WH',
  'State_Use_Code',
  'State_Adjustment',
  'State_Cost_Basis',
  'LLC_Number',
];

/**
 * Format a date to MMDDYYYY (8-digit no-separator format required by Drake).
 * Drake docs: "Enter the date acquired as an eight-digit number MMDDYYYY format."
 *
 * Accepts: MMDDYYYY (pass-through), MM/DD/YYYY, YYYY-MM-DD, native Date string,
 *          or special values: VARIOUS, INHERIT, INH2010, BANKRUPT, WORTHLESS, EXPIRED
 * @param {string} raw
 * @returns {string}
 */
function formatDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim().toUpperCase();

  // Special Drake values — pass through unchanged
  const SPECIALS = ['VARIOUS', 'INHERIT', 'INH2010', 'BANKRUPT', 'WORTHLESS', 'EXPIRED'];
  if (SPECIALS.includes(s)) return s;

  // Already MMDDYYYY (8 digits, no separators)
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

  return s; // Return as-is and let Drake validate
}

/**
 * Map form8949Box input to Drake numeric code.
 * Drake: 1 = Box A or D (basis reported to IRS)
 *        2 = Box B or E (basis NOT reported to IRS)
 *        3 = Box C or F (transaction NOT reported on Form 1099-B)
 * @param {string|number} box
 * @returns {string}  '1' | '2' | '3'
 */
function mapBoxCode(box) {
  const b = String(box || '').trim().toUpperCase();
  if (b === '1' || b === 'A' || b === 'D') return '1';
  if (b === '2' || b === 'B' || b === 'E') return '2';
  if (b === '3' || b === 'C' || b === 'F') return '3';
  return '1'; // default: Box A (basis reported to IRS, short-term)
}

/**
 * Format Type (S/L) from longShort input.
 * @param {string} v
 * @returns {string}  'S' | 'L' | ''
 */
function mapType(v) {
  if (!v) return '';
  const s = String(v).trim().toUpperCase();
  if (s === 'S' || s === 'SHORT' || s === 'SHORT-TERM') return 'S';
  if (s === 'L' || s === 'LONG'  || s === 'LONG-TERM')  return 'L';
  return '';
}

/**
 * Format a numeric dollar value: no $ sign, no commas, 2 decimal places.
 * @param {*} v
 * @returns {string}
 */
function formatDollar(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(String(v).replace(/[$,]/g, ''));
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2);
}

/**
 * Escape a CSV cell value.
 * @param {*} value
 * @returns {string}
 */
function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Build a single 40-column row for one transaction.
 * @param {Object} tx
 * @returns {string[]}  40-element array of CSV cell strings
 */
function txToRow(tx) {
  const row = new Array(40).fill('');

  row[0]  = csvCell(tx.ts || '');                                    // TSJ
  row[1]  = csvCell('');                                             // F (blank = include federal)
  row[2]  = csvCell(tx.stateCode || '');                             // State routing
  row[3]  = csvCell('');                                             // City
  row[4]  = csvCell(mapBoxCode(tx.form8949Box));                     // Form 8949 Check Box
  row[5]  = csvCell(tx.description || '');                           // Description
  row[6]  = csvCell(formatDate(tx.dateAcquired));                    // Date Acquired (MMDDYYYY)
  row[7]  = csvCell(formatDate(tx.dateSold));                        // Date Sold (MMDDYYYY)
  row[8]  = csvCell(mapType(tx.longShort));                          // Type (S/L)
  row[9]  = csvCell('');                                             // Ordinary
  row[10] = csvCell(formatDollar(tx.proceeds));                      // Proceeds
  row[11] = csvCell(formatDollar(tx.basis));                         // Cost / Basis
  row[12] = csvCell('');                                             // AMT Cost Basis
  row[13] = csvCell('');                                             // Accrued Discount
  row[14] = csvCell(formatDollar(tx.washSaleLoss ?? ''));            // Wash Sale Loss
  row[15] = csvCell('');                                             // US Real Property
  row[16] = csvCell(tx.adjCode  || '');                              // Adj 1 Code
  row[17] = csvCell(formatDollar(tx.adjAmount  ?? ''));              // Adj 1 Amount
  row[18] = csvCell('');                                             // Adj 1 AMT
  row[19] = csvCell(tx.adj2Code || '');                              // Adj 2 Code
  row[20] = csvCell(formatDollar(tx.adj2Amount ?? ''));              // Adj 2 Amount
  row[21] = csvCell('');                                             // Adj 2 AMT
  row[22] = csvCell(tx.adj3Code || '');                              // Adj 3 Code
  row[23] = csvCell(formatDollar(tx.adj3Amount ?? ''));              // Adj 3 Amount
  row[24] = csvCell('');                                             // Adj 3 AMT
  row[25] = csvCell(formatDollar(tx.fedWH ?? ''));                   // Fed W/H
  row[26] = csvCell('');                                             // Loss Not Allowed
  row[27] = csvCell('');                                             // Collectibles
  row[28] = csvCell('');                                             // QSBS Code
  row[29] = csvCell('');                                             // QSBS Amount
  row[30] = csvCell(tx.state1Code || tx.stateCode || '');           // State 1
  row[31] = csvCell('');                                             // State 1 ID
  row[32] = csvCell(formatDollar(tx.state1WH ?? ''));                // State 1 W/H
  row[33] = csvCell(tx.state2Code || '');                            // State 2
  row[34] = csvCell('');                                             // State 2 ID
  row[35] = csvCell(formatDollar(tx.state2WH ?? ''));                // State 2 W/H
  row[36] = csvCell('');                                             // State Use Code
  row[37] = csvCell('');                                             // State Adjustment
  row[38] = csvCell('');                                             // State Cost Basis
  row[39] = csvCell('');                                             // LLC Number

  return row;
}

/**
 * Generate the Form 8949 CSV content string from an array of transactions.
 * @param {Array}  transactions
 * @param {Object} [options]
 * @param {boolean} [options.includeHeader=true]  Include a header row
 * @returns {string}  CSV content (UTF-8, LF line endings)
 */
function generate8949CSV(transactions, options = {}) {
  const { includeHeader = true } = options;

  if (!Array.isArray(transactions)) {
    throw new Error('generate8949CSV: transactions must be an array');
  }

  const lines = [];
  if (includeHeader) lines.push(HEADERS.map(csvCell).join(','));

  for (const tx of transactions) {
    lines.push(txToRow(tx).join(','));
  }

  return lines.join('\n');
}

/**
 * Validate date values in the transactions array.
 * Drake requires MMDDYYYY (8 digits) or a special value (VARIOUS/INHERIT/etc.).
 * @param {Array} transactions
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateDates(transactions) {
  const errors = [];
  const SPECIALS = ['VARIOUS', 'INHERIT', 'INH2010', 'BANKRUPT', 'WORTHLESS', 'EXPIRED'];
  const datePattern = /^\d{8}$/;

  transactions.forEach((tx, i) => {
    const acq  = formatDate(tx.dateAcquired);
    const sold = formatDate(tx.dateSold);
    if (acq  && !datePattern.test(acq)  && !SPECIALS.includes(acq))
      errors.push(`Row ${i + 1} dateAcquired "${tx.dateAcquired}" → "${acq}" is not MMDDYYYY`);
    if (sold && !datePattern.test(sold) && !SPECIALS.includes(sold))
      errors.push(`Row ${i + 1} dateSold "${tx.dateSold}" → "${sold}" is not MMDDYYYY`);
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Build a complete artifact ready for DrakeLoader / companion.
 * @param {Array}  transactions
 * @param {string} clientName
 * @returns {{ content: string, filename: string, mimetype: string, meta: Object }}
 */
function buildArtifact(transactions, clientName) {
  const content  = generate8949CSV(transactions);
  const safeName = String(clientName || 'client').replace(/[^A-Za-z0-9]/g, '_').slice(0, 40);
  const filename = `${safeName}_8949.csv`;

  const dateCheck = validateDates(transactions);

  return {
    content,
    filename,
    mimetype: 'text/csv',
    meta: {
      transactionCount: transactions.length,
      datesValid:       dateCheck.valid,
      dateErrors:       dateCheck.errors,
    },
  };
}

module.exports = {
  generate8949CSV,
  validateDates,
  formatDate,
  formatDollar,
  mapBoxCode,
  buildArtifact,
  HEADERS,
};
