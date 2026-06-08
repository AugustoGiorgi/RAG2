const { parseApprovedWorkpaper, validateForLoad } = require("./lib/canonicalMapper");
const { CCHAxcessAdapter } = require("./adapters/cchAxcessAdapter");
const { DrakeAdapter } = require("./adapters/drakeAdapter");

class TaxLoader {
  constructor(configs = {}) {
    this.configs = configs;
  }

  adapter(software) {
    const config = this.configs[software] || {};
    if (software === "cch_axcess") return new CCHAxcessAdapter(config);
    if (software === "drake") return new DrakeAdapter(config);
    throw new Error(`Unsupported tax software: ${software}. Supported: cch_axcess, drake.`);
  }

  needsCompanion(software) {
    return software === "drake";
  }

  async parseWorkpaper(filePath) {
    return parseApprovedWorkpaper(filePath);
  }

  validate(data) {
    return validateForLoad(data);
  }

  async load(software, data) {
    const validation = this.validate(data);
    if (!validation.ok) {
      return { success: false, fieldsLoaded: 0, errors: validation.blockers, warnings: validation.warnings, auditTrail: {} };
    }
    const adapter = this.adapter(software);
    const artifact = await adapter.prepare(data);
    return adapter.load(artifact, data);
  }

  async generateFileOnly(software, data) {
    return this.adapter(software).prepare(data);
  }
}

module.exports = { TaxLoader };
