const { BaseAdapter } = require("./baseAdapter");
const DRAKE = require("../config/drakeFormat");

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
    const pattern = isScheduleC ? DRAKE.scheduleCFileNaming : DRAKE.fileNaming;
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

  async load(artifact) {
    if (!this.companionUrl) throw new Error("Drake requires companionUrl.");
    const response = await fetch(`${this.companionUrl}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Companion-Token": this.config.companionToken || "" },
      body: JSON.stringify({ software: "drake", filename: artifact.filename, content: artifact.content, meta: artifact.meta }),
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
