/**
 * drakeFormat.js — Configuration for Drake TB import templates.
 *
 * Template layout (verified from real Drake 2025 templates):
 *   Row 1, col B  → Company / Entity Name
 *   Row 3, col B  → Year End (MM/DD/YYYY)
 *   Row 5         → Headers: col C = Account Title, col E = Debit, col H = Credit
 *   Row 7+        → Data rows (1120S/1065 start at row 7, 1120 starts at row 8)
 *
 * Template files (converted from Drake .TBI to .xlsx for ExcelJS compatibility):
 *   templates/drake_tb_1120S_template.xlsx  — S Corporation (462,848 bytes original)
 *   templates/drake_tb_1065_template.xlsx   — Partnership    (582,144 bytes original)
 *   templates/drake_tb_1120_template.xlsx   — C Corporation  (349,184 bytes original)
 */
const path = require('path');
const TMPL = path.join(__dirname, '..', 'templates');

module.exports = {
  trialBalanceColumns: ['Account Title', 'Debit', 'Credit', 'Import to', 'Reported on', 'Other information'],
  scheduleCColumns:    ['Date', 'Description', 'Amount', 'Category', 'ScheduleCLine'],
  trialBalanceTemplates: {
    '1065':  {
      templatePath: process.env.DRAKE_1065_TB_TEMPLATE  || path.join(TMPL, 'drake_tb_1065_template.xlsx'),
      sheetName: 'PTR TB',
    },
    '1120':  {
      templatePath: process.env.DRAKE_1120_TB_TEMPLATE  || path.join(TMPL, 'drake_tb_1120_template.xlsx'),
      sheetName: 'Corp TB',
    },
    '1120S': {
      templatePath: process.env.DRAKE_1120S_TB_TEMPLATE || path.join(TMPL, 'drake_tb_1120S_template.xlsx'),
      sheetName: 'SBS TB',
    },
  },
  fileNaming:          '{client}_TB_{entity}_{year}.xls',
  scheduleCFileNaming: 'schedule_c_{entity}_{year}.csv',
};
