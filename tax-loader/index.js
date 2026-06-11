/**
 * index.js — RAG Tax Drake Loader
 * ─────────────────────────────────────────────────────────────────────────────
 * Exports:
 *   DrakeLoader  — new primary class (workpaper → Drake import files)
 *   TaxLoader    — legacy class (retained for backward compatibility)
 */

const { parseApprovedWorkpaper, validateForLoad } = require('./lib/canonicalMapper');
const { CCHAxcessAdapter } = require('./adapters/cchAxcessAdapter');
const { DrakeAdapter }     = require('./adapters/drakeAdapter');
const { generateTrialBalance } = require('./generators/trialBalanceGenerator');
const { buildArtifact: build8949 }        = require('./generators/form8949Generator');
const { buildArtifact: build4562 }        = require('./generators/form4562Generator');
const { buildArtifact: buildSchC }        = require('./generators/scheduleCGenerator');
const DRAKE = require('./config/drakeFormat');
const path  = require('path');
const fs    = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// DrakeLoader — main class per spec v2.1
// ─────────────────────────────────────────────────────────────────────────────

class DrakeLoader {
  /**
   * @param {Object} config
   * @param {string} [config.companionUrl]   e.g. "http://localhost:7777"
   * @param {string} [config.companionToken] Shared token header
   * @param {string} [config.templateDir]    Override templates/ directory
   * @param {string} [config.outputDir]      Local dir for generated files (optional)
   */
  constructor(config = {}) {
    this.config       = config;
    this.companionUrl = config.companionUrl  || 'http://localhost:7777';
    this.token        = config.companionToken || '';
    this.templateDir  = config.templateDir   || path.join(__dirname, 'templates');
  }

  /** Parse a CPA-approved workpaper Excel file. */
  async parseWorkpaper(filePath) {
    return parseApprovedWorkpaper(filePath);
  }

  /**
   * Validate a CanonicalReturn.
   * @returns {{ ok: boolean, blockers: string[], warnings: string[] }}
   */
  validate(data) {
    return validateForLoad(data);
  }

  /**
   * Generate all Drake import files for a CanonicalReturn.
   *
   * - 1120S / 1065 / 1120 → Trial Balance .xls
   * - transactions8949    → Form 8949 .csv  (if provided)
   * - assets4562          → Form 4562 .xlsx (if provided)
   * - 1040                → Schedule C .csv
   *
   * @param {Object} data           CanonicalReturn from parseWorkpaper()
   * @param {Object} [extras]
   * @param {Array}  [extras.transactions8949]  Capital gain transactions
   * @param {Array}  [extras.assets4562]        Depreciable asset records
   * @returns {Promise<{
   *   trialBalance: Object|null,
   *   form8949:     Object|null,
   *   form4562:     Object|null,
   *   scheduleC:    Object|null,
   * }>}
   */
  async generateFiles(data, extras = {}) {
    const et = data.client?.entityType;
    const result = { trialBalance: null, form8949: null, form4562: null, scheduleC: null };

    // ── Trial Balance (business entities) ────────────────────────────────────
    if (['1120S', '1065', '1120'].includes(et)) {
      const tmplConfig = DRAKE.trialBalanceTemplates[et] || {};

      // Priority: explicit override > .xlsx in templateDir > .xls in templateDir > drakeFormat path
      // .TBI files (Drake binary) are NOT valid Excel — skipped via extension check.
      const isExcel = p => p && /\.(xls|xlsx)$/i.test(p);

      // Prefer .xlsx (ExcelJS reads natively), fall back to .xls
      const localXlsx = path.join(this.templateDir, `drake_tb_${et}_template.xlsx`);
      const localXls  = path.join(this.templateDir, `drake_tb_${et}_template.xls`);

      let resolvedPath = null;
      if (this.config.templatePath && isExcel(this.config.templatePath) && fs.existsSync(this.config.templatePath)) {
        resolvedPath = this.config.templatePath;
      } else if (fs.existsSync(localXlsx)) {
        resolvedPath = localXlsx;
      } else if (fs.existsSync(localXls)) {
        resolvedPath = localXls;
      } else if (isExcel(tmplConfig.templatePath) && fs.existsSync(tmplConfig.templatePath)) {
        resolvedPath = tmplConfig.templatePath;
      }
      // resolvedPath = null → synthetic mode (tests pass without real template)

      result.trialBalance = await generateTrialBalance(
        data,
        resolvedPath,
        tmplConfig.sheetName
      );
    }

    // ── Form 8949 (capital gains) ─────────────────────────────────────────────
    const tx8949 = extras.transactions8949 || data.transactions8949 || [];
    if (tx8949.length > 0) {
      result.form8949 = build8949(tx8949, data.client?.name || data.client?.ein || 'client');
    }

    // ── Form 4562 (depreciation) ──────────────────────────────────────────────
    const assets4562 = extras.assets4562 || data.assets4562 || [];
    if (assets4562.length > 0) {
      result.form4562 = await build4562(assets4562, data.client?.name || data.client?.ein || 'client');
    }

    // ── Schedule C (1040) ─────────────────────────────────────────────────────
    if (et === '1040') {
      result.scheduleC = buildSchC(data);
    }

    return result;
  }

  /**
   * Send generated files to the companion service.
   * @param {Object} files  Result of generateFiles()
   * @returns {Promise<{ ok: boolean, paths: string[], errors: string[] }>}
   */
  async sendToCompanion(files) {
    const fileList = [];

    for (const [type, artifact] of Object.entries(files)) {
      if (!artifact) continue;
      const entry = { type, filename: artifact.filename, meta: artifact.meta || {} };
      if (artifact.buffer) {
        entry.contentBase64 = artifact.buffer.toString('base64');
      } else if (artifact.content !== undefined) {
        entry.content = artifact.content;
      }
      fileList.push(entry);
    }

    if (fileList.length === 0) {
      return { ok: true, paths: [], errors: [], message: 'No files to send' };
    }

    const response = await fetch(`${this.companionUrl}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Companion-Token': this.token,
      },
      body: JSON.stringify({ software: 'drake', files: fileList }),
    }).catch(err => { throw new Error(`Companion unreachable: ${err.message}`); });

    const result = await response.json().catch(() => ({}));
    return {
      ok:     result.ok ?? response.ok,
      paths:  result.paths  || [],
      errors: result.errors || (!response.ok ? [`companion HTTP ${response.status}`] : []),
    };
  }

  /**
   * Full pipeline: parse → validate → generateFiles → sendToCompanion.
   * @param {string} workpaperPath  Path to the approved workpaper .xlsx
   * @param {Object} [extras]       { transactions8949, assets4562 }
   * @returns {Promise<Object>}
   */
  async load(workpaperPath, extras = {}) {
    const data = await this.parseWorkpaper(workpaperPath);

    const v = this.validate(data);
    if (!v.ok) {
      throw new Error(`Workpaper has unresolved ERROR flags:\n${v.blockers.join('\n')}`);
    }

    const files  = await this.generateFiles(data, extras);
    const result = await this.sendToCompanion(files);

    return {
      ...result,
      warnings:        v.warnings,
      filesGenerated:  Object.keys(files).filter(k => files[k] !== null),
      manualFields:    (data.fields || []).filter(f => f.flag === 'manual').map(f => f.canonicalKey),
      auditTrail: {
        software:    'drake',
        entityType:  data.client?.entityType,
        taxYear:     data.taxYear,
        clientName:  data.client?.name,
        ein:         data.client?.ein,
        timestamp:   new Date().toISOString(),
      },
    };
  }

  /**
   * Generate files only — do NOT send to companion.
   * Useful for preview and download flows.
   * @param {string} workpaperPath
   * @param {Object} [extras]
   * @returns {Promise<Object>}  { data, files, warnings, manualFields }
   */
  async generateOnly(workpaperPath, extras = {}) {
    const data = await this.parseWorkpaper(workpaperPath);
    const v    = this.validate(data);
    const files = await this.generateFiles(data, extras);

    return {
      data,
      files,
      warnings:     v.warnings,
      blockers:     v.blockers,
      manualFields: (data.fields || []).filter(f => f.flag === 'manual').map(f => f.canonicalKey),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TaxLoader — legacy class (backward compatible)
// ─────────────────────────────────────────────────────────────────────────────

class TaxLoader {
  constructor(configs = {}) {
    this.configs = configs;
  }

  adapter(software) {
    const config = this.configs[software] || {};
    if (software === 'cch_axcess') return new CCHAxcessAdapter(config);
    if (software === 'drake')      return new DrakeAdapter(config);
    throw new Error(`Unsupported tax software: ${software}. Supported: cch_axcess, drake.`);
  }

  needsCompanion(software) { return software === 'drake'; }

  async parseWorkpaper(filePath) { return parseApprovedWorkpaper(filePath); }

  validate(data) { return validateForLoad(data); }

  async load(software, data) {
    const validation = this.validate(data);
    if (!validation.ok) {
      return { success: false, fieldsLoaded: 0, errors: validation.blockers, warnings: validation.warnings, auditTrail: {} };
    }
    const adapter  = this.adapter(software);
    const artifact = await adapter.prepare(data);
    return adapter.load(artifact, data);
  }

  async generateFileOnly(software, data) {
    return this.adapter(software).prepare(data);
  }
}

module.exports = { DrakeLoader, TaxLoader };
