/**
 * gruntWorxGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a GruntWorx Populate XML file that Drake Tax 2025 accepts via
 * Import ▸ GruntWorx Populate Job — without paying GruntWorx per job.
 *
 * Schema reverse-engineered from local Drake 2025 installation:
 *   C:\DRAKE25\FT\IMPORTGW.DLL     — XPath expressions + CL_* classType dispatch
 *   C:\DRAKE25\HELP\GRUNTWORX.KEY  — field name → Drake form-code mapping (708 entries)
 *
 * Validation Drake actually performs (confirmed by DLL analysis):
 *   1. taxYear attribute must start with "20"
 *   2. XML must be well-formed (Msxml2.DOMDocument.6.0)
 *   3. Class attribute on <classData> must match a known CL_* value
 *   ✘  No cryptographic signature, HMAC, or server-side token check
 *
 * Supported classTypes (confirmed in IMPORTGW.DLL dispatch table):
 *   CL_W_2, CL_1099_INT, CL_1099_DIV, CL_1099_NEC,
 *   CL_1099_MISC, CL_1099_SSA, CL_1099_OID, CL_W_2G
 *
 * ⚠  CL_1099_R appears in GRUNTWORX.KEY field-map but NOT in IMPORTGW.DLL
 *    dispatch — 1099-R is not importable via GruntWorx Populate. Use the
 *    Manual Entry Guide for 1099-R data.
 *
 * Usage:
 *   const { buildArtifact } = require('./gruntWorxGenerator');
 *   const art = buildArtifact(payload, 'John Smith', 2024);
 *   // art.content  → XML string (write to any path; Drake lets you browse)
 *   // art.filename → 'JohnSmith_1040_2024_gruntworx.xml'
 *   // art.mimetype → 'application/xml'
 *   // art.meta     → { counts, totalForms }
 *   // Returns null when payload has no W-2 or 1099 data.
 *
 * Drake import steps (after downloading this file):
 *   1. Open the client return in Drake Tax 2025
 *   2. Menu: Import ▸ GruntWorx Populate Job
 *   3. Browse to the downloaded XML file → Open
 *   4. Drake auto-populates all W-2 and 1099 screens
 *
 * @module gruntWorxGenerator
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// XML helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Escape special XML characters in attribute values and text content. */
function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalize a Social Security Number to 9 raw digits (no dashes or spaces).
 * Drake stores SSNs internally WITHOUT dashes (e.g. "117527660").
 * IMPORTGW.DLL compares RecipientIdNo/EmployeeSSN against the return's
 * stored SSN using a raw string comparison — sending "117-52-7660" when
 * Drake has "117527660" would cause every TSJ match to fail and Drake
 * would silently discard all records.
 */
function normSsn(v) {
  return String(v || '').replace(/[^0-9]/g, '');
}

/**
 * Emit a single <field> block.
 * Returns empty string when value is null / empty string / 0.
 */
function field(canonicalName, dataType, value, confidence) {
  if (value == null || value === '') return '';
  return (
    `      <field>\n` +
    `        <canonicalName>${esc(canonicalName)}</canonicalName>\n` +
    `        <dataType>${esc(dataType)}</dataType>\n` +
    `        <data>${esc(value)}</data>\n` +
    `        <confidence>${confidence || '1.00'}</confidence>\n` +
    `      </field>\n`
  );
}

/** Amount field — skips zero/null, formats to 2 decimal places. */
function amtField(canonicalName, value) {
  if (value == null || value === '') return '';
  const n = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
  if (isNaN(n) || n === 0) return '';
  return field(canonicalName, 'Amount', n.toFixed(2));
}

/** Boolean field — only emits when truthy (skips false/0/null). */
function boolField(canonicalName, value) {
  const truthy =
    value === true || value === 1 ||
    String(value).toLowerCase() === 'true' ||
    String(value) === '1';
  if (!truthy) return '';
  return field(canonicalName, 'Boolean', '1');
}

/** Wrap a list of field strings in a <record> block. */
function record(fields) {
  const body = fields.filter(Boolean).join('');
  if (!body.trim()) return '';
  return `    <record>\n${body}    </record>\n`;
}

/** Wrap a list of record strings in a <pageData><classData Class="CL_…"> block. */
function classData(classType, records) {
  const body = records.filter(Boolean).join('');
  if (!body.trim()) return '';
  return (
    `  <pageData>\n` +
    `    <classData Class="${esc(classType)}">\n` +
    body +
    `    </classData>\n` +
    `  </pageData>\n`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-form record builders
// (Field names sourced from GRUNTWORX.KEY + IMPORTGW.DLL XPaths)
// ─────────────────────────────────────────────────────────────────────────────

/** CL_W_2 — W-2 Wage and Tax Statement */
function buildW2Record(w) {
  // NOTE: 'TSJ' is NOT a standalone canonicalName in GRUNTWORX.KEY.
  // TSJ is derived by Drake from EmployeeSSN (GRUNTWORX.KEY: EmployeeSSN → CL_W_2.EmployeeSSN + CL_W_2.TSJ).
  // Drake compares the SSN against the return's taxpayer/spouse SSNs and sets TSJ accordingly.
  return record([
    field('EmployeeSSN',    'Social Security Number',  normSsn(w.ssn || w.employee_ssn || w.box_a || '')),
    field('EmployerFedId',  'Federal ID',              w.ein || w.employer_ein || w.box_b || ''),
    field('EmployerName',   'CompanyName',             w.employer || w.employer_name || w.EmployerName || ''),
    // Wages & withholding (Boxes 1-6)
    amtField('Wages',       w.box1 || w.wages    || w.box1_wages),
    amtField('FedTaxWH',    w.box2 || w.federal_wh || w.box2_federal_wh),
    amtField('SSWages',     w.box3 || w.ss_wages  || w.box3_ss_wages),
    amtField('SSTaxWH',     w.box4 || w.ss_tax    || w.box4_ss_tax),
    amtField('MedWages',    w.box5 || w.medicare_wages || w.box5_medicare_wages),
    amtField('MedicareTax', w.box6 || w.medicare_tax   || w.box6_medicare_tax),
    // Tips (Boxes 7-8)
    amtField('SSTips',         w.box7 || w.ss_tips),
    amtField('AllocatedTips',  w.box8 || w.allocated_tips),
    // Benefits (Boxes 10-11)
    amtField('DependBenefits', w.box10 || w.dependent_care_benefits),
    amtField('NQPlans',        w.box11 || w.nonqualified_plans),
    // Box 12 — code letter(s) + amount(s)
    ...(w.box12_code ? [
      field('12CodeValuePairs_0',     'Multiline String', String(w.box12_code).toUpperCase()),
      amtField('12CodeValuePairs_0_Amt', w.box12_amount || w.box12_amt || 0),
    ] : []),
    // Box 13 checkboxes
    boolField('StatEmployee', w.box13_stat_employee || w.statutory_employee),
    boolField('RetirePlan',   w.box13_retirement    || w.retirement_plan),
    boolField('SickPay',      w.box13_sick_pay      || w.third_party_sick),
    // State (Boxes 15-17)
    w.box15_state   ? field('State_0',       'Multiline String', w.box15_state)                          : '',
    w.box15_state_id || w.state_id
      ? field('EmplrStateID_0', 'Multiline String', w.box15_state_id || w.state_id) : '',
    amtField('StateWages_0',  w.box16_state_wages || w.state_wages),
    amtField('StateIncTax_0', w.box17_state_wh    || w.state_tax),
  ]);
}

/** CL_1099_INT — 1099-INT Interest Income */
function buildIntRecord(r) {
  // NOTE: 'TSJ' is NOT a standalone canonicalName in GRUNTWORX.KEY.
  // TSJ is derived by Drake from RecipientIdNo (GRUNTWORX.KEY: RecipientIdNo → CL_1099_INT.RecipientIdNo + CL_1099_INT.TSJ).
  return record([
    field('RecipientIdNo',   'Social Security Number', normSsn(r.ssn || r.recipient_ssn || '')),
    field('PayerFedID',      'Federal ID',             r.ein || r.payer_ein     || ''),
    field('PayerName',       'CompanyName',            r.payer || r.payer_name  || ''),
    field('AccountNo',       'Formatted String',       r.account || r.account_number || ''),
    amtField('InterestIncome',      r.box1 || r.interest_income),
    amtField('EarlyWithdPenty',     r.box2 || r.early_withdrawal_penalty),
    amtField('FedIncTaxWH',         r.box4 || r.federal_wh),
    amtField('TaxExemptInterest',   r.box8 || r.tax_exempt_interest),
    amtField('PrivActBondInterest', r.box9 || r.private_activity_bond),
    amtField('MarketDiscount',      r.box10 || r.market_discount),
    amtField('BondPremium',         r.box11 || r.bond_premium),
    amtField('ForeignTxPd',         r.box6  || r.foreign_tax),
    // State
    r.box14_state || r.state
      ? field('State_0', 'Multiline String', r.box14_state || r.state) : '',
    r.state_id_number
      ? field('PayerStateID_0', 'Multiline String', r.state_id_number) : '',
    amtField('StateIncTaxWH_0', r.state_wh || r.state_tax),
  ]);
}

/** CL_1099_DIV — 1099-DIV Dividends and Distributions */
function buildDivRecord(r) {
  // NOTE: TSJ derived by Drake from RecipientIdNo → CL_1099_DIV.RecipientIdNo + CL_1099_DIV.TSJ
  return record([
    field('RecipientIdNo', 'Social Security Number', normSsn(r.ssn || r.recipient_ssn || '')),
    field('PayerFedID',    'Federal ID',             r.ein || r.payer_ein     || ''),
    field('PayerName',     'CompanyName',            r.payer || r.payer_name  || ''),
    field('AccountNo',     'Formatted String',       r.account || r.account_number || ''),
    amtField('OrdinaryDividends',   r.box1a || r.ordinary_dividends),
    amtField('QualifiedDividends',  r.box1b || r.qualified_dividends),
    amtField('CapitalGainDist',     r.box2a || r.capital_gain_distributions),
    amtField('Collectibles',        r.box2b || r.collectibles_gain),
    amtField('Sec199ADiv',          r.box5  || r.section_199a_dividends),
    amtField('NondividendDistrib',  r.box3  || r.nondividend_distributions),
    amtField('FedIncTaxWH',         r.box4  || r.federal_wh),
    amtField('ForeignTax',          r.box7  || r.foreign_tax),
    amtField('ExemptIntDiv',        r.box12 || r.exempt_interest_dividends),
    amtField('SpecPrivAct',         r.box13 || r.specified_private_activity_dividends),
    // State
    r.box15_state || r.state
      ? field('State_0', 'Multiline String', r.box15_state || r.state) : '',
    r.state_id_number
      ? field('PayerStateID_0', 'Multiline String', r.state_id_number) : '',
    amtField('StateIncTaxWH_0', r.state_wh || r.state_tax),
  ]);
}

/** CL_1099_NEC — Form 1099-NEC Nonemployee Compensation */
function buildNecRecord(r) {
  // NOTE: TSJ derived by Drake from RecipientIdNo → CL_1099_NEC.RecipientIdNo + CL_1099_NEC.TSJ
  return record([
    field('RecipientIdNo', 'Social Security Number', normSsn(r.ssn || r.recipient_ssn || '')),
    field('PayerFedID',    'Federal ID',             r.ein || r.payer_ein     || ''),
    field('PayerName',     'CompanyName',            r.payer || r.payer_name  || ''),
    field('AccountNo',     'Formatted String',       r.account || r.account_number || ''),
    amtField('Nonemployee', r.box1 || r.nonemployee_compensation),
    amtField('FedIncTaxWH', r.box4 || r.federal_wh),
    // State
    r.box5_state || r.state
      ? field('State_0', 'Multiline String', r.box5_state || r.state) : '',
    r.state_id_number
      ? field('PayerStateID_0', 'Multiline String', r.state_id_number) : '',
    amtField('StateIncome_0',   r.box6_state_income || r.state_income),
    amtField('StateIncTaxWH_0', r.state_wh || r.state_tax),
  ]);
}

/** CL_1099_MISC — Form 1099-MISC Miscellaneous Income */
function buildMiscRecord(r) {
  // NOTE: TSJ derived by Drake from RecipientIdNo → CL_1099_MISC.RecipientIdNo + CL_1099_MISC.TSJ
  return record([
    field('RecipientIdNo', 'Social Security Number', normSsn(r.ssn || r.recipient_ssn || '')),
    field('PayerFedID',    'Federal ID',             r.ein || r.payer_ein     || ''),
    field('PayerName',     'CompanyName',            r.payer || r.payer_name  || ''),
    field('AccountNo',     'Formatted String',       r.account || r.account_number || ''),
    amtField('Rents',          r.box1  || r.rents),
    amtField('Royalties',      r.box2  || r.royalties),
    amtField('OtherIncome',    r.box3  || r.other_income),
    amtField('FedIncTaxWH',    r.box4  || r.federal_wh),
    amtField('MedicalHealth',  r.box6  || r.medical_health_payments),
    amtField('CropInsurance',  r.box9  || r.crop_insurance),
    amtField('Attorney',       r.box10 || r.gross_proceeds_attorney),
    amtField('409ADeferrals',  r.box12 || r.section_409a_deferrals),
    amtField('Nonqualified',   r.box14 || r.nonqualified_deferred_comp),
    // State
    r.box15_state || r.state
      ? field('State_0', 'Multiline String', r.box15_state || r.state) : '',
    r.state_id_number
      ? field('PayerStateID_0', 'Multiline String', r.state_id_number) : '',
    amtField('StateIncome_0',   r.box16_state_income || r.state_income),
    amtField('StateIncTaxWH_0', r.state_wh || r.state_tax),
  ]);
}

/**
 * CL_1099_SSA — SSA-1099 Social Security Benefit Statement
 * Note: field name is FederalIncTaxWH (not FedIncTaxWH) — confirmed from KEY file.
 */
function buildSsaRecord(r) {
  // NOTE: TSJ derived by Drake from BeneficiarySSNo → CL_1099_SSA.BeneficiarySSNo + CL_1099_SSA.TSJ
  return record([
    field('BeneficiarySSNo',  'Social Security Number', normSsn(r.ssn || r.beneficiary_ssn || '')),
    // Box 5 = Net benefits (total received minus repaid); Box 3 = gross on older forms
    amtField('NetBenefits',      r.box5 || r.box3 || r.net_benefits),
    amtField('FederalIncTaxWH',  r.box6 || r.box4 || r.federal_wh),
    // Medicare Part premiums (optional)
    amtField('Bx3MedicareA', r.medicare_a || r.medicare_part_a),
    amtField('Bx3MedicareB', r.medicare_b || r.medicare_part_b),
    amtField('Bx3MedicareD', r.medicare_d || r.medicare_part_d),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate GruntWorx Populate XML content.
 *
 * @param {Object} payload
 * @param {Array}  [payload.w2s]
 * @param {Array}  [payload.int_1099s]
 * @param {Array}  [payload.div_1099s]
 * @param {Array}  [payload.nec_1099s]
 * @param {Array}  [payload.misc_1099s]
 * @param {Array}  [payload.ssa_1099s]
 * @param {number|string} taxYear
 * @returns {string|null}  Complete XML string, or null if no data.
 */
function generateGruntWorxXml(payload, taxYear) {
  const year = String(taxYear || new Date().getFullYear() - 1);

  const w2s        = (payload.w2s        || []).filter(Boolean);
  const int_1099s  = (payload.int_1099s  || []).filter(Boolean);
  const div_1099s  = (payload.div_1099s  || []).filter(Boolean);
  const nec_1099s  = (payload.nec_1099s  || []).filter(Boolean);
  const misc_1099s = (payload.misc_1099s || []).filter(Boolean);
  const ssa_1099s  = (payload.ssa_1099s  || []).filter(Boolean);

  const total = w2s.length + int_1099s.length + div_1099s.length +
                nec_1099s.length + misc_1099s.length + ssa_1099s.length;
  if (total === 0) return null;

  const sections = [];

  if (w2s.length)        sections.push(classData('CL_W_2',       w2s.map(buildW2Record)));
  if (int_1099s.length)  sections.push(classData('CL_1099_INT',  int_1099s.map(buildIntRecord)));
  if (div_1099s.length)  sections.push(classData('CL_1099_DIV',  div_1099s.map(buildDivRecord)));
  if (nec_1099s.length)  sections.push(classData('CL_1099_NEC',  nec_1099s.map(buildNecRecord)));
  if (misc_1099s.length) sections.push(classData('CL_1099_MISC', misc_1099s.map(buildMiscRecord)));
  if (ssa_1099s.length)  sections.push(classData('CL_1099_SSA',  ssa_1099s.map(buildSsaRecord)));

  // Filter out empty classData blocks (all records had no data)
  const body = sections.filter(Boolean).join('');
  if (!body.trim()) return null;

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<!-- Generated by RAG Tax — GruntWorx Populate compatible -->\n` +
    `<!-- Drake Import: Import > GruntWorx Populate Job > select this file -->\n` +
    `<gruntworxData taxYear="${esc(year)}">\n` +
    body +
    `</gruntworxData>\n`
  );
}

/**
 * Build a downloadable artifact object.
 *
 * @param {Object} payload       { w2s, int_1099s, div_1099s, nec_1099s, misc_1099s, ssa_1099s }
 * @param {string} clientName
 * @param {number|string} taxYear
 * @returns {{ content: string, filename: string, mimetype: string, meta: Object }|null}
 */
function buildArtifact(payload, clientName, taxYear) {
  const xml = generateGruntWorxXml(payload, taxYear);
  if (!xml) return null;

  const counts = {
    w2:   (payload.w2s        || []).length,
    int:  (payload.int_1099s  || []).length,
    div:  (payload.div_1099s  || []).length,
    nec:  (payload.nec_1099s  || []).length,
    misc: (payload.misc_1099s || []).length,
    ssa:  (payload.ssa_1099s  || []).length,
  };
  const totalForms = Object.values(counts).reduce((s, n) => s + n, 0);
  const slug = String(clientName || 'client').replace(/[^A-Za-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const filename = `${slug}_1040_${taxYear || 'unknown'}_gruntworx.xml`;

  return {
    content:  xml,
    filename,
    mimetype: 'application/xml',
    meta: { counts, totalForms },
  };
}

module.exports = { generateGruntWorxXml, buildArtifact };
