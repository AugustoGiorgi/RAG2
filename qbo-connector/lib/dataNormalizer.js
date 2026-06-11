/**
 * Convierte los reportes crudos de QBO al formato canónico del workpaper.
 * Todos los campos importados llevan flag "review" — el CPA confirma antes de usar.
 *
 * @param {Object} qboData  Resultado de fetchFinancials()
 * @returns {CanonicalReturn}
 */
function normalizeFinancials(qboData) {
  const { profitLoss, balanceSheet, companyInfo } = qboData.data || {};
  const fields = {};

  // ── P&L ─────────────────────────────────────────────────────────────────────
  if (profitLoss) {
    const pl = flattenReport(profitLoss);
    assign(fields, "income.gross_receipts",        pl["Total Income"]    || pl["Total Revenue"]);
    assign(fields, "income.cogs",                  pl["Cost of Goods Sold"] || pl["Total COGS"]);
    assign(fields, "deductions.salaries_wages",    pl["Payroll Expenses"] || pl["Salaries & Wages"] || pl["Salaries and Wages"]);
    assign(fields, "deductions.rents",             pl["Rent"] || pl["Rent Expense"]);
    assign(fields, "deductions.advertising",       pl["Advertising"] || pl["Advertising and Promotion"]);
    assign(fields, "deductions.depreciation",      pl["Depreciation"] || pl["Depreciation Expense"] || pl["Amortization and Depreciation"]);
    assign(fields, "deductions.interest",          pl["Interest Expense"] || pl["Interest Paid"]);
    assign(fields, "deductions.taxes_licenses",    pl["Taxes & Licenses"] || pl["Taxes and Licenses"]);
    assign(fields, "deductions.repairs",           pl["Repairs & Maintenance"] || pl["Repairs and Maintenance"]);
    assign(fields, "deductions.other",             pl["Other Expenses"] || pl["Miscellaneous"]);
    // Meals: QBO guarda el 100% — workpaper aplica el límite del 50%
    const meals = toNum(pl["Meals and Entertainment"] || pl["Business Meals"]);
    if (meals) fields["deductions.meals_50"] = meals * 0.5;
    assign(fields, "m1.net_income_book",           pl["Net Income"] || pl["Net Profit"]);
    assign(fields, "income.other_income",          pl["Other Income"]);
    assign(fields, "deductions.officer_comp",      pl["Officer Compensation"] || pl["Officers Compensation"]);
    assign(fields, "deductions.pension",           pl["Retirement"] || pl["Pension"] || pl["Profit Sharing"]);
    assign(fields, "deductions.employee_benefits", pl["Employee Benefits"] || pl["Health Insurance"]);
  }

  // ── Balance Sheet ────────────────────────────────────────────────────────────
  if (balanceSheet) {
    const bs = flattenReport(balanceSheet);
    assign(fields, "balance.cash",               bs["Cash and cash equivalents"] || bs["Cash"]);
    assign(fields, "balance.ar",                 bs["Accounts Receivable (A/R)"] || bs["Accounts Receivable"]);
    assign(fields, "balance.inventory",          bs["Inventory Asset"] || bs["Inventory"]);
    assign(fields, "balance.fixed_assets",       bs["Property and Equipment"] || bs["Fixed Assets"] || bs["Buildings and Improvements"]);
    assign(fields, "balance.accum_depr",         bs["Accumulated Depreciation"]);
    assign(fields, "balance.ap",                 bs["Accounts Payable (A/P)"] || bs["Accounts Payable"]);
    assign(fields, "balance.retained_earnings",  bs["Retained Earnings"] || bs["Retained Earnings (Deficit)"]);
  }

  // Construir lista canónica con flag "review"
  const canonicalFields = Object.entries(fields)
    .filter(([, v]) => v !== null && v !== undefined && !isNaN(Number(v)))
    .map(([key, value]) => ({
      canonicalKey: key,
      value:        Number(value) || 0,
      flag:         "review",
      sourceTab:    "QBO Import",
      note:         "Importado desde QuickBooks Online — verificar con el CPA",
    }));

  const company = companyInfo?.CompanyInfo || {};

  return {
    client: {
      name:       company.CompanyName || "",
      ein:        company.EIN         || "",
      entityType: qboData.entityType  || "",
    },
    taxYear:  qboData.taxYear,
    fields:   canonicalFields,
    metadata: {
      source:    "QuickBooks Online",
      realmId:   qboData.realmId,
      fetchedAt: qboData.fetchedAt,
      errors:    qboData.errors || [],
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function assign(obj, key, raw) {
  const n = toNum(raw);
  if (n !== null) obj[key] = n;
}

function toNum(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = parseFloat(String(raw).replace(/[^0-9.+-]/g, ""));
  return isFinite(n) ? n : null;
}

/**
 * Aplana el formato de reporte QBO ({ Header, Rows: { Row: [...] } })
 * a un mapa plano { "Account Name": numericValue }.
 */
function flattenReport(report) {
  const result = {};

  function traverse(rows) {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (row.type === "Data" || row.type === "DataRow") {
        const cols = row.ColData || [];
        const label = cols[0]?.value;
        // Último ColData no vacío como valor
        const val = cols.slice(1).map(c => c.value).filter(v => v !== "").pop();
        if (label && val !== undefined) result[label] = val;
      }
      if (row.type === "Section") {
        if (row.Rows?.Row) traverse(row.Rows.Row);
        const sum = row.Summary?.ColData || [];
        const sumLabel = sum[0]?.value;
        const sumVal   = sum.slice(1).map(c => c.value).filter(v => v !== "").pop();
        if (sumLabel && sumVal !== undefined) result[sumLabel] = sumVal;
      }
      if (row.type === "Summary") {
        const cols = row.ColData || [];
        const label = cols[0]?.value;
        const val   = cols.slice(1).map(c => c.value).filter(v => v !== "").pop();
        if (label && val !== undefined) result[label] = val;
      }
    }
  }

  traverse(report?.Rows?.Row);
  return result;
}

module.exports = { normalizeFinancials, flattenReport };
