/**
 * manualEntryGuideGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Genera un Excel de guía de entry manual para returns 1040 en Drake Tax.
 *
 * Para cada tipo de formulario (W2, 1099-INT, 1099-DIV, 1099-R, SSA, NEC)
 * genera una hoja con:
 *   - Instrucción de navegación en Drake (pantalla a abrir)
 *   - Campo por campo: label, valor a ingresar, notas
 *   - Código de acceso rápido de Drake (lo que se tipea en Data Entry)
 *
 * Estructura del input (uiPayload del drakeAdapter / workpaper 1040):
 * {
 *   client:     { ssn, first_name, last_name, ... },
 *   spouse:     { ssn, first_name, last_name, ... },
 *   w2s:        [{ employer, ein, box1, box2, box3, box4, box5, box6,
 *                  box12_code, box12_amount, box13_retirement,
 *                  box15_state, box16_state_wages, box17_state_wh, tsj }],
 *   int_1099s:  [{ payer, ein, box1, box2, box3, box4, tsj }],
 *   div_1099s:  [{ payer, ein, box1a, box1b, box2a, box4, tsj }],
 *   ret_1099rs: [{ payer, ein, box1, box2a, box4, box7_code, box7_ira, tsj }],
 *   ssa_1099s:  [{ box3, box4, tsj }],
 *   nec_1099s:  [{ payer, ein, box1, box4, tsj }],
 *   misc_1099s: [{ payer, ein, box3, box7, box4, tsj }],
 * }
 *
 * Alias de campos aceptados:
 *   W2: employer|employerName, ein|employerEin,
 *       box1|wages|box1_wages, box2|fedWH|box2_fedWH,
 *       box3|ssWages|box3_ss_wages, box4|ssWH|box4_ss_wh,
 *       box5|medWages|box5_medicare_wages, box6|medWH|box6_medicare_wh
 *
 *   1099-INT: payer|payerName, box1|interest|box1_interest, box4|fedWH
 *   1099-DIV: payer|payerName, box1a|totalDiv|box1a_total_div,
 *             box1b|qualDiv|box1b_qualified_div, box2a|capGain|box2a_cap_gain, box4|fedWH
 *   1099-R:   payer|payerName, box1|grossDist, box2a|taxable|box2a_taxable,
 *             box4|fedWH, box7|distCode|box7_dist_code, box7_ira|ira|iraFlag
 *   1099-SSA: box3|netBenefits, box4|fedWH
 *   1099-NEC: payer|payerName, box1|nec|box1_nec, box4|fedWH
 */

const ExcelJS = require('exceljs');

// ─── Color palette ────────────────────────────────────────────────────────────
const C = {
  DRAKE_BLUE:   'FF1F497D',  // Encabezado de sección Drake
  SCREEN_CODE:  'FF2E75B6',  // Código de pantalla Drake
  INST_BG:      'FFD9E2F3',  // Fondo instrucción
  FIELD_HDR:    'FF4472C4',  // Header de columnas
  VALUE_BG:     'FFFFFCE7',  // Celda con valor a ingresar
  EMPTY_BG:     'FFF2F2F2',  // Campo vacío / no aplica
  WARN_BG:      'FFFFC000',  // Advertencia
  WHITE:        'FFFFFFFF',
  DARK_TEXT:    'FF1F1F1F',
  LIGHT_TEXT:   'FFFFFFFF',
};

// ─── Drake screen access codes for 1040 data entry ───────────────────────────
const DRAKE_SCREENS = {
  W2:       { code: 'W2',   title: 'W-2 Wage and Tax Statement',                nav: 'En Data Entry Menu → tipear "W2" → Enter' },
  INT:      { code: 'INT',  title: '1099-INT Interest Income',                  nav: 'En Data Entry Menu → tipear "INT" → Enter' },
  DIV:      { code: 'DIV',  title: '1099-DIV Dividend Income',                  nav: 'En Data Entry Menu → tipear "DIV" → Enter' },
  RET:      { code: '1099', title: '1099-R Retirement/Pension Distribution',    nav: 'En Data Entry Menu → tipear "1099" → Enter → seleccionar 1099-R' },
  SSA:      { code: 'SSA',  title: 'SSA-1099 Social Security Benefits',         nav: 'En Data Entry Menu → tipear "SSA" → Enter' },
  NEC:      { code: '99N',  title: '1099-NEC Nonemployee Compensation',         nav: 'En Data Entry Menu → tipear "99N" → Enter' },
  MISC:     { code: '99M',  title: '1099-MISC Miscellaneous Income',            nav: 'En Data Entry Menu → tipear "99M" → Enter' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize field aliases to a single canonical value. */
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return '';
}

/** Format a number as dollar (no sign, 2 decimals). Blank if zero/empty. */
function fmt$(v) {
  if (v === '' || v == null) return '';
  const n = Number(String(v).replace(/[$,]/g, ''));
  if (!Number.isFinite(n) || n === 0) return '';
  return n.toFixed(2);
}

/** Apply a solid fill to a cell. */
function fill(cell, argb) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

/** Bold + optionally colored text. */
function bold(cell, fontColor = C.DARK_TEXT, sz = 11) {
  cell.font = { bold: true, color: { argb: fontColor }, size: sz };
}

/** Set column widths on a sheet. widths = [col1_width, col2_width, ...] */
function setCols(ws, widths) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

/** Write a section header row spanning all columns. */
function sectionHeader(ws, text, numCols, bgArgb = C.DRAKE_BLUE) {
  const row = ws.addRow([text]);
  ws.mergeCells(row.number, 1, row.number, numCols);
  const cell = row.getCell(1);
  fill(cell, bgArgb);
  cell.font = { bold: true, color: { argb: C.LIGHT_TEXT }, size: 12 };
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  row.height = 20;
  return row;
}

/** Write a Drake navigation instruction row. */
function navRow(ws, screen, numCols) {
  const row = ws.addRow([
    `▶  Drake: ${screen.nav}   |   Código rápido: "${screen.code}"`,
  ]);
  ws.mergeCells(row.number, 1, row.number, numCols);
  const cell = row.getCell(1);
  fill(cell, C.INST_BG);
  cell.font = { italic: true, color: { argb: C.SCREEN_CODE }, size: 10 };
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 2 };
  row.height = 18;
  return row;
}

/** Write a column header row. */
function colHeader(ws, headers) {
  const row = ws.addRow(headers);
  row.eachCell(cell => {
    fill(cell, C.FIELD_HDR);
    cell.font = { bold: true, color: { argb: C.LIGHT_TEXT }, size: 10 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: C.DARK_TEXT } },
    };
  });
  row.height = 18;
  return row;
}

/** Write a data row (label + value pair). */
function dataRow(ws, label, drakeField, value, note = '') {
  const hasValue = value !== '' && value !== null && value !== undefined;
  const row = ws.addRow([label, drakeField, hasValue ? value : '—', note]);

  // Label col
  row.getCell(1).font = { size: 10 };
  row.getCell(1).alignment = { indent: 2 };

  // Drake field col
  row.getCell(2).font = { size: 10, color: { argb: 'FF444444' } };
  row.getCell(2).alignment = { horizontal: 'center' };

  // Value col
  const vcell = row.getCell(3);
  if (hasValue) {
    fill(vcell, C.VALUE_BG);
    vcell.font = { bold: true, size: 11, color: { argb: C.DARK_TEXT } };
  } else {
    fill(vcell, C.EMPTY_BG);
    vcell.font = { size: 10, color: { argb: 'FF999999' } };
  }
  vcell.alignment = { horizontal: 'right' };

  // Note col
  row.getCell(4).font = { size: 9, color: { argb: 'FF666666' }, italic: true };

  row.height = 18;
  return row;
}

/** Add a blank separator row. */
function blankRow(ws, numCols) {
  const row = ws.addRow([]);
  row.height = 8;
}

// ─── Summary sheet ────────────────────────────────────────────────────────────
function buildSummarySheet(wb, payload, clientName, taxYear) {
  const ws = wb.addWorksheet('📋 Resumen');
  setCols(ws, [30, 20, 20, 20, 20]);

  // Title
  const titleRow = ws.addRow([`GUÍA DE ENTRY MANUAL — DRAKE TAX ${taxYear}`]);
  ws.mergeCells(1, 1, 1, 5);
  fill(titleRow.getCell(1), C.DRAKE_BLUE);
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: C.LIGHT_TEXT } };
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  titleRow.height = 30;

  // Client info
  const c = payload.client || {};
  ws.addRow([]);
  ws.addRow(['CLIENTE',        clientName]);
  ws.addRow(['SSN / EIN',      c.ssn || '']);
  ws.addRow(['AÑO FISCAL',     taxYear]);
  ws.addRow(['Filing Status',  c.filing_status || '']);
  if ((payload.spouse || {}).ssn) {
    ws.addRow(['Cónyuge',        `${payload.spouse.first_name || ''} ${payload.spouse.last_name || ''}`.trim()]);
    ws.addRow(['SSN Cónyuge',   payload.spouse.ssn]);
  }
  ws.addRow([]);

  // Counts table
  sectionHeader(ws, 'FORMULARIOS A INGRESAR', 5);
  colHeader(ws, ['Tipo', 'Cantidad', 'Pantalla Drake', 'Hoja en esta guía', 'Notas']);

  const sections = [
    ['W-2',             (payload.w2s || []).length,        'W2',   'W2'],
    ['1099-INT',        (payload.int_1099s || []).length,   'INT',  '1099-INT'],
    ['1099-DIV',        (payload.div_1099s || []).length,   'DIV',  '1099-DIV'],
    ['1099-R',          (payload.ret_1099rs || []).length,  '1099', '1099-R'],
    ['SSA-1099',        (payload.ssa_1099s || []).length,   'SSA',  '1099-SSA'],
    ['1099-NEC',        (payload.nec_1099s || []).length,   '99N',  '1099-NEC'],
    ['1099-MISC',       (payload.misc_1099s || []).length,  '99M',  '1099-MISC'],
  ];

  for (const [tipo, count, drake, hoja] of sections) {
    if (count === 0) continue;
    const row = ws.addRow([tipo, count, `"${drake}"`, hoja, '']);
    const hasItems = count > 0;
    fill(row.getCell(2), hasItems ? C.VALUE_BG : C.EMPTY_BG);
    row.getCell(2).font = { bold: hasItems, size: 11 };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).font = { color: { argb: C.SCREEN_CODE }, bold: true };
    row.height = 18;
  }

  ws.addRow([]);
  const warnRow = ws.addRow(['⚠️  IMPORTANTE: abrir cada return en Drake antes de ingresar datos. ESC guarda y sale de cada pantalla.']);
  ws.mergeCells(warnRow.number, 1, warnRow.number, 5);
  fill(warnRow.getCell(1), C.WARN_BG);
  warnRow.getCell(1).font = { bold: true, size: 10 };
  warnRow.height = 20;
}

// ─── W-2 sheet ────────────────────────────────────────────────────────────────
function buildW2Sheet(wb, w2s) {
  if (!w2s || w2s.length === 0) return;
  const ws  = wb.addWorksheet('W2');
  const SCR = DRAKE_SCREENS.W2;
  setCols(ws, [32, 22, 18, 40]);

  sectionHeader(ws, `W-2  —  ${w2s.length} employer(s)`, 4);
  navRow(ws, SCR, 4);
  ws.addRow([]);

  for (let i = 0; i < w2s.length; i++) {
    const w = w2s[i];
    const emp = pick(w, 'employer', 'employerName', 'employer_name', 'Employer_Name', 'EMPLOYER');
    const ein = pick(w, 'ein', 'employerEin', 'employer_ein', 'EIN');

    sectionHeader(ws, `Employer ${i + 1}${emp ? ': ' + emp : ''}`, 4, C.SCREEN_CODE);
    colHeader(ws, ['Campo en Drake', 'Box / Screen field', 'Valor a ingresar', 'Notas']);

    dataRow(ws, 'Employer Name',              'Box c — Employer name',       emp,  'Tal como aparece en el W2');
    dataRow(ws, 'Employer EIN',               'Box b — Employer EIN',        ein,  'XX-XXXXXXX');
    dataRow(ws, 'Wages, tips (Box 1)',         'Box 1',  fmt$(pick(w, 'box1','wages','box1_wages','Box1_Wages','Wages')));
    dataRow(ws, 'Federal tax withheld (Box 2)','Box 2',  fmt$(pick(w, 'box2','fedWH','fed_wh','box2_fedWH','Box2_FedWH','FedWH')), 'Retención federal');
    dataRow(ws, 'SS wages (Box 3)',            'Box 3',  fmt$(pick(w, 'box3','ssWages','box3_ss_wages','Box3_SS_Wages')));
    dataRow(ws, 'SS tax withheld (Box 4)',     'Box 4',  fmt$(pick(w, 'box4','ssWH','box4_ss_wh','Box4_SS_WH')));
    dataRow(ws, 'Medicare wages (Box 5)',      'Box 5',  fmt$(pick(w, 'box5','medWages','box5_medicare_wages','Box5_Medicare_Wages')));
    dataRow(ws, 'Medicare tax withheld (Box 6)','Box 6', fmt$(pick(w, 'box6','medWH','box6_medicare_wh','Box6_Medicare_WH')));

    // Box 12 (code + amount)
    const b12code = pick(w, 'box12_code','box12Code','Box12_Code');
    const b12amt  = fmt$(pick(w, 'box12_amount','box12Amount','Box12_Amount'));
    if (b12code || b12amt) {
      dataRow(ws, 'Box 12 Code',   'Box 12 — Code',   b12code, 'D=401k, S=SIMPLE, DD=HDHP, etc.');
      dataRow(ws, 'Box 12 Amount', 'Box 12 — Amount', b12amt,  '');
    }

    // Box 13 checkboxes
    const ret = pick(w, 'box13_retirement','box13Retirement','Box13_Retirement','retirement_plan');
    if (ret) dataRow(ws, 'Retirement plan (Box 13)', 'Box 13 — Retirement plan', 'X', 'Marcar si está activo');

    // State info
    const state     = pick(w, 'box15_state','box15State','Box15_State','state');
    const stWages   = fmt$(pick(w, 'box16_state_wages','box16StateWages','Box16_State_Wages','stateWages'));
    const stWH      = fmt$(pick(w, 'box17_state_wh','box17StateWH','Box17_State_WH','stateWH'));
    if (state || stWages || stWH) {
      sectionHeader(ws, `  State info — Box 15-17`, 4, 'FF5B9BD5');
      dataRow(ws, 'State (Box 15)',             'Box 15',  state,  '2 letras: OH, NY, CA, etc.');
      dataRow(ws, 'State wages (Box 16)',        'Box 16',  stWages);
      dataRow(ws, 'State tax withheld (Box 17)', 'Box 17',  stWH);
    }

    // TSJ
    const tsj = pick(w, 'tsj','TSJ','ts');
    if (tsj) dataRow(ws, 'T/S/J (owner)',   'Top of screen', tsj, 'T=taxpayer  S=spouse  J=joint');

    blankRow(ws, 4);
  }
}

// ─── 1099-INT sheet ───────────────────────────────────────────────────────────
function build1099INTSheet(wb, items) {
  if (!items || items.length === 0) return;
  const ws  = wb.addWorksheet('1099-INT');
  const SCR = DRAKE_SCREENS.INT;
  setCols(ws, [32, 22, 18, 40]);

  sectionHeader(ws, `1099-INT  —  ${items.length} payer(s)`, 4);
  navRow(ws, SCR, 4);
  ws.addRow([]);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const payer = pick(it, 'payer', 'payerName', 'payer_name', 'Payer_Name');
    const ein   = pick(it, 'ein', 'EIN');

    sectionHeader(ws, `Payer ${i + 1}${payer ? ': ' + payer : ''}`, 4, C.SCREEN_CODE);
    colHeader(ws, ['Campo', 'Box / Field', 'Valor', 'Notas']);

    dataRow(ws, 'Payer name',                 'Payer name',   payer);
    dataRow(ws, 'Payer EIN',                  "Payer's EIN",  ein);
    dataRow(ws, 'Interest income (Box 1)',     'Box 1',  fmt$(pick(it, 'box1','interest','box1_interest','Box1_Interest')));
    dataRow(ws, 'Early withdrawal penalty (Box 2)', 'Box 2', fmt$(pick(it, 'box2','earlyWithdrawal','box2_early_withdrawal')), 'Penalidad por retiro anticipado');
    dataRow(ws, 'US Savings Bonds (Box 3)',   'Box 3',  fmt$(pick(it, 'box3','usBonds','box3_us_bonds','Box3_US_Bonds')));
    dataRow(ws, 'Federal tax withheld (Box 4)','Box 4', fmt$(pick(it, 'box4','fedWH','Box4_FedWH')));
    const tsj = pick(it, 'tsj','TSJ');
    if (tsj) dataRow(ws, 'T/S/J', 'Top of screen', tsj);

    blankRow(ws, 4);
  }
}

// ─── 1099-DIV sheet ───────────────────────────────────────────────────────────
function build1099DIVSheet(wb, items) {
  if (!items || items.length === 0) return;
  const ws  = wb.addWorksheet('1099-DIV');
  const SCR = DRAKE_SCREENS.DIV;
  setCols(ws, [32, 22, 18, 40]);

  sectionHeader(ws, `1099-DIV  —  ${items.length} payer(s)`, 4);
  navRow(ws, SCR, 4);
  ws.addRow([]);

  for (let i = 0; i < items.length; i++) {
    const it    = items[i];
    const payer = pick(it, 'payer','payerName','payer_name','Payer_Name');
    const ein   = pick(it, 'ein','EIN');

    sectionHeader(ws, `Payer ${i + 1}${payer ? ': ' + payer : ''}`, 4, C.SCREEN_CODE);
    colHeader(ws, ['Campo', 'Box / Field', 'Valor', 'Notas']);

    dataRow(ws, 'Payer name',                    'Payer name',  payer);
    dataRow(ws, 'Payer EIN',                     "Payer's EIN", ein);
    dataRow(ws, 'Total ordinary dividends (Box 1a)', 'Box 1a',  fmt$(pick(it, 'box1a','totalDiv','total_div','Box1a_Total_Div')));
    dataRow(ws, 'Qualified dividends (Box 1b)',   'Box 1b',      fmt$(pick(it, 'box1b','qualDiv','qualified_div','Box1b_Qualified_Div')), 'Subset de 1a — no suma');
    dataRow(ws, 'Total capital gain (Box 2a)',    'Box 2a',      fmt$(pick(it, 'box2a','capGain','capital_gain','Box2a_Cap_Gain')));
    dataRow(ws, 'Federal tax withheld (Box 4)',   'Box 4',       fmt$(pick(it, 'box4','fedWH','Box4_FedWH')));
    const tsj = pick(it, 'tsj','TSJ');
    if (tsj) dataRow(ws, 'T/S/J', 'Top of screen', tsj);

    blankRow(ws, 4);
  }
}

// ─── 1099-R sheet ─────────────────────────────────────────────────────────────
function build1099RSheet(wb, items) {
  if (!items || items.length === 0) return;
  const ws  = wb.addWorksheet('1099-R');
  const SCR = DRAKE_SCREENS.RET;
  setCols(ws, [35, 28, 18, 40]);

  sectionHeader(ws, `1099-R  —  ${items.length} distribution(s)`, 4);
  navRow(ws, SCR, 4);
  const noteRow = ws.addRow(['  Después de ingresar 1099, Drake pregunta si es IRA/SEP/SIMPLE — contestar según Box 7 del formulario.']);
  ws.mergeCells(noteRow.number, 1, noteRow.number, 4);
  fill(noteRow.getCell(1), C.WARN_BG);
  noteRow.getCell(1).font = { size: 9, italic: true };
  ws.addRow([]);

  for (let i = 0; i < items.length; i++) {
    const it    = items[i];
    const payer = pick(it, 'payer','payerName','payer_name','Payer_Name');
    const ein   = pick(it, 'ein','EIN');
    const code  = pick(it, 'box7','box7_code','distCode','dist_code','Box7_Dist_Code');
    const ira   = pick(it, 'box7_ira','ira','iraFlag','IRA');

    sectionHeader(ws, `Distribution ${i + 1}${payer ? ': ' + payer : ''}`, 4, C.SCREEN_CODE);
    colHeader(ws, ['Campo', 'Box / Field', 'Valor', 'Notas']);

    dataRow(ws, 'Payer name',                    'Payer name',   payer);
    dataRow(ws, 'Payer EIN',                     "Payer's EIN",  ein);
    dataRow(ws, 'Gross distribution (Box 1)',     'Box 1',  fmt$(pick(it, 'box1','grossDist','gross_dist','Box1_Gross_Dist')));
    dataRow(ws, 'Taxable amount (Box 2a)',        'Box 2a', fmt$(pick(it, 'box2a','taxable','taxable_amount','Box2a_Taxable')), 'Blank si aplica "Taxable amount not determined"');
    dataRow(ws, 'Federal tax withheld (Box 4)',   'Box 4',  fmt$(pick(it, 'box4','fedWH','Box4_FedWH')));
    dataRow(ws, 'Distribution code (Box 7)',      'Box 7',  code, '1=Normal, 2=Early<59½, 4=Death, 7=Normal≥59½, G=Rollover, etc.');
    if (ira) dataRow(ws, 'IRA / SEP / SIMPLE (Box 7)', 'IRA checkbox', 'X', 'Marcar si está marcado en el formulario');
    const tsj = pick(it, 'tsj','TSJ');
    if (tsj) dataRow(ws, 'T/S/J', 'Top of screen', tsj);

    blankRow(ws, 4);
  }
}

// ─── SSA-1099 sheet ───────────────────────────────────────────────────────────
function build1099SSASheet(wb, items) {
  if (!items || items.length === 0) return;
  const ws  = wb.addWorksheet('1099-SSA');
  const SCR = DRAKE_SCREENS.SSA;
  setCols(ws, [35, 22, 18, 40]);

  sectionHeader(ws, `SSA-1099  —  ${items.length} recipient(s)`, 4);
  navRow(ws, SCR, 4);
  ws.addRow([]);

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    sectionHeader(ws, `SSA ${i + 1}`, 4, C.SCREEN_CODE);
    colHeader(ws, ['Campo', 'Box / Field', 'Valor', 'Notas']);

    dataRow(ws, 'Net SS benefits (Box 5)',         'Box 5',   fmt$(pick(it, 'box3','box5','netBenefits','net_benefits','Box3','Box5')), 'Monto neto recibido');
    dataRow(ws, 'Federal tax withheld (Box 6/4)',  'Box 6',   fmt$(pick(it, 'box4','box6','fedWH','Box4_FedWH')));
    const tsj = pick(it, 'tsj','TSJ');
    if (tsj) dataRow(ws, 'T/S/J', 'Top of screen', tsj, 'T=taxpayer, S=spouse — SS del cónyuge va en SSA separado');

    blankRow(ws, 4);
  }
}

// ─── 1099-NEC sheet ───────────────────────────────────────────────────────────
function build1099NECSheet(wb, items) {
  if (!items || items.length === 0) return;
  const ws  = wb.addWorksheet('1099-NEC');
  const SCR = DRAKE_SCREENS.NEC;
  setCols(ws, [32, 22, 18, 40]);

  sectionHeader(ws, `1099-NEC  —  ${items.length} payer(s)`, 4);
  navRow(ws, SCR, 4);
  const noteRow = ws.addRow(['  Nonemployee Compensation va directo a Schedule C/F si el cliente es self-employed.']);
  ws.mergeCells(noteRow.number, 1, noteRow.number, 4);
  fill(noteRow.getCell(1), C.WARN_BG);
  noteRow.getCell(1).font = { size: 9, italic: true };
  ws.addRow([]);

  for (let i = 0; i < items.length; i++) {
    const it    = items[i];
    const payer = pick(it, 'payer','payerName','payer_name','Payer_Name');
    const ein   = pick(it, 'ein','EIN');

    sectionHeader(ws, `Payer ${i + 1}${payer ? ': ' + payer : ''}`, 4, C.SCREEN_CODE);
    colHeader(ws, ['Campo', 'Box / Field', 'Valor', 'Notas']);

    dataRow(ws, 'Payer name',                      'Payer name',  payer);
    dataRow(ws, 'Payer EIN',                        "Payer's EIN", ein);
    dataRow(ws, 'Nonemployee compensation (Box 1)', 'Box 1',  fmt$(pick(it, 'box1','nec','box1_nec','Box1_NEC')));
    dataRow(ws, 'Federal tax withheld (Box 4)',     'Box 4',  fmt$(pick(it, 'box4','fedWH','Box4_FedWH')));
    const tsj = pick(it, 'tsj','TSJ');
    if (tsj) dataRow(ws, 'T/S/J', 'Top of screen', tsj);

    blankRow(ws, 4);
  }
}

// ─── 1099-MISC sheet ──────────────────────────────────────────────────────────
function build1099MISCSheet(wb, items) {
  if (!items || items.length === 0) return;
  const ws  = wb.addWorksheet('1099-MISC');
  const SCR = DRAKE_SCREENS.MISC;
  setCols(ws, [32, 22, 18, 40]);

  sectionHeader(ws, `1099-MISC  —  ${items.length} payer(s)`, 4);
  navRow(ws, SCR, 4);
  ws.addRow([]);

  for (let i = 0; i < items.length; i++) {
    const it    = items[i];
    const payer = pick(it, 'payer','payerName','payer_name','Payer_Name');
    const ein   = pick(it, 'ein','EIN');

    sectionHeader(ws, `Payer ${i + 1}${payer ? ': ' + payer : ''}`, 4, C.SCREEN_CODE);
    colHeader(ws, ['Campo', 'Box / Field', 'Valor', 'Notas']);

    dataRow(ws, 'Payer name',                   'Payer name',  payer);
    dataRow(ws, 'Payer EIN',                     "Payer's EIN", ein);
    dataRow(ws, 'Other income (Box 3)',          'Box 3',  fmt$(pick(it, 'box3','otherIncome','other_income')));
    dataRow(ws, 'Nonemployee comp (Box 7)',      'Box 7',  fmt$(pick(it, 'box7','nec','box7_nec')), '⚠️ Box 7 fue movido a 1099-NEC en 2020+');
    dataRow(ws, 'Federal tax withheld (Box 4)', 'Box 4',  fmt$(pick(it, 'box4','fedWH','Box4_FedWH')));
    const tsj = pick(it, 'tsj','TSJ');
    if (tsj) dataRow(ws, 'T/S/J', 'Top of screen', tsj);

    blankRow(ws, 4);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate the manual entry guide workbook as a Buffer.
 * @param {Object} payload   uiPayload from drakeAdapter (or raw object with same shape)
 * @param {string} clientName
 * @param {number|string} taxYear
 * @returns {Promise<Buffer>}
 */
async function generateManualEntryGuide(payload, clientName, taxYear) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RAG Tax Loader';
  wb.created = new Date();

  buildSummarySheet(wb, payload, clientName, taxYear);
  buildW2Sheet(wb,       payload.w2s        || []);
  build1099INTSheet(wb,  payload.int_1099s  || []);
  build1099DIVSheet(wb,  payload.div_1099s  || []);
  build1099RSheet(wb,    payload.ret_1099rs || payload.r_1099s || []);
  build1099SSASheet(wb,  payload.ssa_1099s  || []);
  build1099NECSheet(wb,  payload.nec_1099s  || []);
  build1099MISCSheet(wb, payload.misc_1099s || []);

  return wb.xlsx.writeBuffer();
}

/**
 * Build a complete artifact ready for DrakeLoader / companion.
 * @param {Object} payload      uiPayload
 * @param {string} clientName
 * @param {number|string} taxYear
 * @returns {Promise<{ buffer, filename, mimetype, meta }>}
 */
async function buildArtifact(payload, clientName, taxYear) {
  const buffer   = await generateManualEntryGuide(payload, clientName, taxYear);
  const safeName = String(clientName || 'client').replace(/[^A-Za-z0-9]/g, '_').slice(0, 40);
  const filename = `${safeName}_1040_${taxYear}_manual_entry.xlsx`;

  const counts = {
    w2:        (payload.w2s        || []).length,
    int_1099:  (payload.int_1099s  || []).length,
    div_1099:  (payload.div_1099s  || []).length,
    r_1099:    (payload.ret_1099rs || payload.r_1099s || []).length,
    ssa_1099:  (payload.ssa_1099s  || []).length,
    nec_1099:  (payload.nec_1099s  || []).length,
    misc_1099: (payload.misc_1099s || []).length,
  };

  return {
    buffer,
    filename,
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    meta: { counts, totalForms: Object.values(counts).reduce((a, b) => a + b, 0) },
  };
}

module.exports = { generateManualEntryGuide, buildArtifact };
