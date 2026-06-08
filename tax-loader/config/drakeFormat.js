/*
 * REQUIERE-DOC-OFICIAL
 * Replace these tentative columns with the official Drake import templates from
 * Drake Software support/KB. Do not rely on these placeholders for production.
 */
module.exports = {
  trialBalanceColumns: ["Account Title", "Debit", "Credit", "Import to", "Reported on", "Other information"],
  scheduleCColumns: ["Date", "Description", "Amount", "Category", "ScheduleCLine"],
  trialBalanceTemplates: {
    "1065": { templatePath: process.env.DRAKE_1065_TB_TEMPLATE || "C:\\DRAKE25\\TB\\PTRTEMP.TBI", sheetName: "PTR TB" },
    "1120": { templatePath: process.env.DRAKE_1120_TB_TEMPLATE || "C:\\DRAKE25\\TB\\CRPTEMP.TBI", sheetName: "Corp TB" },
    "1120S": { templatePath: process.env.DRAKE_1120S_TB_TEMPLATE || "C:\\DRAKE25\\TB\\SBSTEMP.TBI", sheetName: "SBS TB" },
  },
  fileNaming: "{client}_TB_{entity}_{year}.xls",
  scheduleCFileNaming: "schedule_c_{entity}_{year}.csv",
};
