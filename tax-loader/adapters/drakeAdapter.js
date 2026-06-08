const { BaseAdapter } = require("./baseAdapter");
const DRAKE = require("../config/drakeFormat");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function cleanFilename(value) {
  return String(value || "client").replace(/[<>:"/\\|?*\r\n]+/g, "_").replace(/\s+/g, "_").slice(0, 80);
}

function numberValue(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

const TEMPLATE_TITLES = {
  common: {
    "income.gross_receipts": "Gross receipts or sales",
    "income.returns_allowances": "Less: returns and allowances",
    "income.cogs": "Total purchases",
    "income.other_income": "Other income items to carry to Form 1120, page 1",
    "deductions.officer_comp": "Officer compensation",
    "deductions.salaries_wages": "Salaries and wages",
    "deductions.repairs": "Repairs and maintenance",
    "deductions.rents": "Rents",
    "deductions.taxes_licenses": "Taxes & licenses",
    "deductions.interest": "Interest expense",
    "deductions.depreciation": "Depreciation not included on Schedule A",
    "deductions.advertising": "Advertising",
    "deductions.pension": "Pension, profit-sharing, and other plans",
    "deductions.employee_benefits": "Employee benefit program",
    "deductions.meals_50": "Meals 50% limit",
    "deductions.other": "Other expenses",
    "balance.cash": "Cash",
    "balance.ar": "Trade and accounts receivable",
    "balance.inventory": "Ending inventory",
    "balance.fixed_assets": "Buildings and other depreciable assets",
    "balance.accum_depr": "Accumulated depreciation",
    "balance.ap": "Accounts payable",
    "balance.retained_earnings": "Unappropriated retained earnings/(deficit) (Include distributions)",
    "m1.meals_disallowed": "Other non-deductible items such as penalties (M-1)",
    "m1.depreciation_diff": "Depreciation not included on Schedule A",
    "m1.tax_exempt_interest": "Tax-exempt interest",
  },
  "1120": {
    "income.dividends": "Dividend revenue",
    "income.interest": "Interest revenue",
    "income.capital_gain": "Capital gains or losses (Schedule D)",
    "deductions.charitable": "Charitable contributions",
    "m2.retained_beginning": "Unappropriated retained earnings/(deficit) (Include distributions)",
    "m2.retained_ending": "Unappropriated retained earnings/(deficit) (Include distributions)",
  },
  "1120S": {
    "income.other_income": "Other income items to carry to Form 1120S, page 1",
    "deductions.officer_comp": "Officer compensation - shareholder employees",
    "deductions.salaries_wages": "Salaries and wages - non-shareholder employees",
    "balance.retained_earnings": "Retained earnings/(deficit) (Net of distributions)",
    "schK.ordinary_income": "Gross receipts or sales",
    "schK.interest_income": "Interest revenue",
    "schK.dividends": "Dividends (Including qualified)",
    "schK.net_rental": "Gross real estate rental income",
    "schK.distributions": "Cash",
    "m2.aaa_beginning": "Retained earnings/(deficit) (Net of distributions)",
    "m2.aaa_ending": "Retained earnings/(deficit) (Net of distributions)",
  },
  "1065": {
    "income.other_income": "Other income items to carry to Form 1065, page 1",
    "deductions.officer_comp": "Guaranteed Payments for services",
    "deductions.salaries_wages": "Salaries and wages - other than to partners",
    "deductions.pension": "Retirement plans",
    "balance.retained_earnings": "Partners' Capital/(Capital deficit)",
    "schK.ordinary_income": "Gross receipts or sales",
    "schK.guaranteed_payments": "Guaranteed Payments for services",
    "schK.interest_income": "Interest revenue",
    "schK.net_rental": "Gross real estate rental income",
    "schK.distributions": "Distributions - Cash & marketable securities",
    "capital.beginning": "Partners' Capital/(Capital deficit)",
    "capital.ending": "Partners' Capital/(Capital deficit)",
  },
};

function templateTitle(entityType, canonicalKey, mapped) {
  return TEMPLATE_TITLES[entityType]?.[canonicalKey]
    || TEMPLATE_TITLES.common[canonicalKey]
    || mapped.drakeAccountTitle
    || mapped.label
    || canonicalKey;
}

function sideForKey(canonicalKey, amount) {
  const creditPrefixes = ["income.", "balance.ap", "balance.retained_earnings", "capital.", "m2.", "m1.tax_exempt_interest"];
  const debitPrefixes = ["deductions.", "balance.cash", "balance.ar", "balance.inventory", "balance.fixed_assets", "schK.distributions"];
  const credit = creditPrefixes.some(prefix => canonicalKey.startsWith(prefix));
  const debit = debitPrefixes.some(prefix => canonicalKey.startsWith(prefix));
  const normalSide = credit && !debit ? "credit" : "debit";
  if (amount < 0) return normalSide === "credit" ? "debit" : "credit";
  return normalSide;
}

class DrakeAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.software = "drake";
    this.companionUrl = config.companionUrl;
  }

  async prepare(data) {
    const fieldMap = this.loadFieldMap(data.client.entityType);
    const isScheduleC = data.client.entityType === "1040";
    if (!isScheduleC) return this.prepareTrialBalanceTemplate(data, fieldMap);

    const header = isScheduleC ? DRAKE.scheduleCColumns : DRAKE.trialBalanceColumns;
    const rows = [header];
    const skipped = [];
    let accountNumber = 1;

    for (const field of data.fields || []) {
      if (field.flag === "manual" || field.flag === "error") {
        skipped.push(field.canonicalKey);
        continue;
      }
      const mapped = fieldMap.map[field.canonicalKey];
      if (!mapped) {
        skipped.push(field.canonicalKey);
        continue;
      }
      if (isScheduleC) rows.push(["", mapped.label || field.canonicalKey, field.value, mapped.category || "", mapped.drakeLine || ""]);
      else rows.push([accountNumber++, mapped.label || field.canonicalKey, field.value, mapped.drakeScreen || "", mapped.drakeField || ""]);
    }

    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const pattern = DRAKE.scheduleCFileNaming;
    return {
      kind: "csv",
      software: "drake",
      content: csv,
      filename: pattern.replace("{entity}", data.client.entityType).replace("{year}", data.taxYear),
      meta: {
        fieldCount: rows.length - 1,
        skipped,
        ein: data.client.ein,
        entityType: data.client.entityType,
        taxYear: data.taxYear,
      },
    };
  }

  async prepareTrialBalanceTemplate(data, fieldMap) {
    const skipped = [];
    const rows = [];
    const template = DRAKE.trialBalanceTemplates[data.client.entityType];
    if (!template) throw new Error(`Drake trial balance template not configured for ${data.client.entityType}.`);

    for (const field of data.fields || []) {
      if (field.flag === "manual" || field.flag === "error") {
        skipped.push(field.canonicalKey);
        continue;
      }
      const mapped = fieldMap.map[field.canonicalKey];
      if (!mapped) {
        skipped.push(field.canonicalKey);
        continue;
      }
      const amount = numberValue(field.value);
      if (!amount) continue;
      const side = sideForKey(field.canonicalKey, amount);
      rows.push({
        canonicalKey: field.canonicalKey,
        accountTitle: templateTitle(data.client.entityType, field.canonicalKey, mapped),
        debit: side === "debit" ? Math.abs(amount) : null,
        credit: side === "credit" ? Math.abs(amount) : null,
        note: field.note || "",
      });
    }

    const filename = DRAKE.fileNaming
      .replace("{client}", cleanFilename(data.client.name || data.client.ein || "client"))
      .replace("{entity}", data.client.entityType)
      .replace("{year}", data.taxYear);

    return {
      kind: "drake_trial_balance_template",
      software: "drake",
      content: {
        clientName: data.client.name || "",
        yearEnd: data.taxYear ? `12/31/${data.taxYear}` : "",
        rows,
      },
      filename,
      meta: {
        fieldCount: rows.length,
        skipped,
        ein: data.client.ein,
        entityType: data.client.entityType,
        taxYear: data.taxYear,
        templatePath: template.templatePath,
        sheetName: template.sheetName,
      },
    };
  }

  async load(artifact) {
    if (!this.companionUrl) throw new Error("Drake requires companionUrl.");
    const response = await fetch(`${this.companionUrl}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Companion-Token": this.config.companionToken || "" },
      body: JSON.stringify({ software: "drake", kind: artifact.kind, filename: artifact.filename, content: artifact.content, meta: artifact.meta }),
    }).catch((error) => {
      throw new Error(`companion unreachable: ${error.message}`);
    });
    const errors = [];
    const warnings = [];
    if (!response.ok) errors.push(`companion: ${await response.text()}`);
    const result = response.ok ? await response.json() : {};
    if (artifact.meta.skipped.length) warnings.push(`${artifact.meta.skipped.length} manual/skipped fields in Drake: ${artifact.meta.skipped.join(", ")}`);
    return {
      success: errors.length === 0,
      fieldsLoaded: artifact.meta.fieldCount,
      errors,
      warnings,
      auditTrail: { software: "drake", ...artifact.meta, companionResult: result, timestamp: new Date().toISOString() },
    };
  }
}

module.exports = { DrakeAdapter, csvCell };
