/**
 * workpaperParser.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Parses CPA-approved workpaper Excel files into the CanonicalReturn format.
 *
 * Thin re-export of canonicalMapper so external code can import from here
 * without knowing the internal module structure.
 */
const {
  parseApprovedWorkpaper,
  validateForLoad,
  normalizeFlag,
  findColumns,
} = require('./canonicalMapper');

module.exports = { parseApprovedWorkpaper, validateForLoad, normalizeFlag, findColumns };
