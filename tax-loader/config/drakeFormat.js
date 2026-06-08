/*
 * REQUIERE-DOC-OFICIAL
 * Replace these tentative columns with the official Drake import templates from
 * Drake Software support/KB. Do not rely on these placeholders for production.
 */
module.exports = {
  trialBalanceColumns: ["AccountNumber", "Description", "Balance", "DrakeScreen", "DrakeField"],
  scheduleCColumns: ["Date", "Description", "Amount", "Category", "ScheduleCLine"],
  fileNaming: "trial_balance_{entity}_{year}.csv",
  scheduleCFileNaming: "schedule_c_{entity}_{year}.csv",
};
