/**
 * Descarga los reportes financieros de QBO necesarios para el workpaper.
 *
 * @param {Function} requestFn  función (path, params) => Promise<Object>
 *                              Provista por server.js: (p, q) => qboRequest(username, realmId, p, q)
 * @param {string}   realmId    ID de la empresa en QBO
 * @param {number}   taxYear    Año fiscal (ej: 2025)
 * @param {string}   entityType "1040" | "1120S" | "1065" | "1120"
 * @returns {Promise<QBOFinancials>}
 */
async function fetchFinancials(requestFn, realmId, taxYear, entityType) {
  const startDate = `${taxYear}-01-01`;
  const endDate   = `${taxYear}-12-31`;

  const tasks = [
    ["companyInfo",  () => requestFn(`/companyinfo/${realmId}`, {})],
    ["profitLoss",   () => requestFn("/reports/ProfitAndLoss", {
      start_date:          startDate,
      end_date:            endDate,
      accounting_method:   "Accrual",
      summarize_column_by: "Total",
    })],
    ["balanceSheet", () => requestFn("/reports/BalanceSheet", {
      start_date:        endDate,
      end_date:          endDate,
      accounting_method: "Accrual",
    })],
    ["trialBalance", () => requestFn("/reports/TrialBalance", {
      start_date: startDate,
      end_date:   endDate,
    })],
  ];

  // General Ledger solo para entidades de negocio (no 1040 — demasiado voluminoso)
  if (entityType !== "1040") {
    tasks.push(["generalLedger", () => requestFn("/reports/GeneralLedger", {
      start_date: startDate,
      end_date:   endDate,
    })]);
  }

  const results = {};
  const errors  = [];

  const settled = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  settled.forEach((result, idx) => {
    const [name] = tasks[idx];
    if (result.status === "fulfilled") {
      results[name] = result.value;
    } else {
      errors.push({ report: name, error: result.reason?.message || String(result.reason) });
    }
  });

  return {
    data:       results,
    errors,
    realmId,
    taxYear,
    entityType,
    fetchedAt:  new Date().toISOString(),
  };
}

module.exports = { fetchFinancials };
