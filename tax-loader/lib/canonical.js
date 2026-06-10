const CANONICAL_KEYS = {
  business: {
    "income.gross_receipts": "Gross receipts or sales",
    "income.returns_allowances": "Returns and allowances",
    "income.cogs": "Cost of goods sold",
    "income.other_income": "Other income",
    "deductions.officer_comp": "Compensation of officers",
    "deductions.salaries_wages": "Salaries and wages",
    "deductions.repairs": "Repairs and maintenance",
    "deductions.rents": "Rents",
    "deductions.taxes_licenses": "Taxes and licenses",
    "deductions.interest": "Interest expense",
    "deductions.depreciation": "Depreciation",
    "deductions.advertising": "Advertising",
    "deductions.pension": "Pension/profit-sharing plans",
    "deductions.employee_benefits": "Employee benefit programs",
    "deductions.meals_50": "Meals (50% deductible)",
    "deductions.other": "Other deductions",
    "balance.cash": "Cash (Schedule L)",
    "balance.ar": "Accounts receivable",
    "balance.inventory": "Inventories",
    "balance.prepaid": "Prepaid expenses",
    "balance.fixed_assets": "Buildings and other depreciable assets",
    "balance.accum_depr": "Accumulated depreciation",
    "balance.other_assets": "Other assets",
    "balance.ap": "Accounts payable",
    "balance.other_liabilities": "Other liabilities",
    "balance.retained_earnings": "Retained earnings",
    "m1.net_income_book": "Net income per books (M-1)",
    "m1.meals_disallowed": "Meals disallowed (M-1)",
    "m1.depreciation_diff": "Depreciation difference (M-1)",
    "m1.tax_exempt_interest": "Tax-exempt interest (M-1)",
    "m1.other_additions": "Other increases (M-1)",
    "m1.other_reductions": "Other decreases (M-1)",
  },
  "1120S": {
    "schK.ordinary_income": "Ordinary business income (Sch K)",
    "schK.interest_income": "Interest income (Sch K line 4)",
    "schK.dividends": "Dividends (Sch K)",
    "schK.dividends_ordinary": "Ordinary dividends (Sch K line 5a)",
    "schK.dividends_qualified": "Qualified dividends (Sch K line 5b)",
    "schK.net_rental": "Net rental real estate income (Sch K line 2)",
    "schK.section179": "Section 179 deduction (Sch K line 11)",
    "schK.distributions": "Distributions (Sch K)",
    "schK.distributions_cash": "Distributions - cash (Sch K line 16d)",
    "m2.aaa_beginning": "AAA beginning balance (M-2)",
    "m2.aaa_ending": "AAA ending balance (M-2)",
  },
  "1065": {
    "schK.ordinary_income": "Ordinary business income (Sch K)",
    "schK.guaranteed_payments": "Guaranteed payments to partners",
    "schK.interest_income": "Interest income (Sch K)",
    "schK.net_rental": "Net rental real estate income (Sch K)",
    "schK.section179": "Section 179 deduction (Sch K)",
    "schK.distributions": "Distributions (Sch K)",
    "capital.beginning": "Partners' capital beginning (M-2)",
    "capital.ending": "Partners' capital ending (M-2)",
  },
  "1120": {
    "income.dividends": "Dividends received",
    "income.dividends_received": "Dividends received",
    "income.interest": "Interest income",
    "income.capital_gain": "Capital gain net income",
    "deductions.charitable": "Charitable contributions",
    "deductions.dprd": "Dividends-received deduction",
    "tax.taxable_income": "Taxable income",
    "tax.total_tax": "Total tax",
    "m2.retained_beginning": "Retained earnings beginning (M-2)",
    "m2.retained_ending": "Retained earnings ending (M-2)",
  },
  "1040": {
    "schC.gross_receipts": "Gross receipts (Sch C line 1)",
    "schC.returns": "Returns and allowances (Sch C line 2)",
    "schC.cogs": "Cost of goods sold (Sch C line 4)",
    "schC.advertising": "Advertising (Sch C line 8)",
    "schC.car_truck": "Car and truck expenses (line 9)",
    "schC.commissions": "Commissions and fees (line 10)",
    "schC.contract_labor": "Contract labor (line 11)",
    "schC.depreciation": "Depreciation (line 13)",
    "schC.insurance": "Insurance (line 15)",
    "schC.interest_mortgage": "Interest - mortgage (line 16a)",
    "schC.interest_other": "Interest - other (line 16b)",
    "schC.legal_professional": "Legal and professional (line 17)",
    "schC.office_expense": "Office expense (line 18)",
    "schC.rent": "Rent or lease (line 20)",
    "schC.rent_lease_vehicle": "Rent/lease - vehicle (line 20a)",
    "schC.rent_lease_other": "Rent/lease - other (line 20b)",
    "schC.repairs": "Repairs and maintenance (line 21)",
    "schC.supplies": "Supplies (line 22)",
    "schC.taxes_licenses": "Taxes and licenses (line 23)",
    "schC.travel": "Travel (line 24a)",
    "schC.meals": "Deductible meals (line 24b)",
    "schC.utilities": "Utilities (line 25)",
    "schC.wages": "Wages (line 26)",
    "schC.other_expenses": "Other expenses (line 27a)",
    "income.wages_w2": "Wages (W-2, Form 1040 line 1)",
    "income.interest_taxable": "Taxable interest (1099-INT)",
    "income.interest_1099int": "Taxable interest (1099-INT)",
    "income.dividends_ordinary": "Ordinary dividends (1099-DIV)",
    "income.dividends_1099div": "Ordinary dividends (1099-DIV)",
    "income.dividends_qualified": "Qualified dividends (1099-DIV)",
    "income.cap_gains_sch_d": "Capital gains (Schedule D)",
  },
};

function normalizeEntityType(raw) {
  const value = String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (value.includes("1120S")) return "1120S";
  if (value.includes("1065")) return "1065";
  if (value.includes("1120")) return "1120";
  if (value.includes("1040")) return "1040";
  return "";
}

function keysFor(entityType) {
  const normalized = normalizeEntityType(entityType);
  const base = normalized && normalized !== "1040" ? CANONICAL_KEYS.business : {};
  const specific = CANONICAL_KEYS[normalized] || {};
  return { ...base, ...specific };
}

module.exports = { CANONICAL_KEYS, keysFor, normalizeEntityType };
