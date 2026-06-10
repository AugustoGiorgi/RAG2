/**
 * drakeFieldMap.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads and queries Drake field-map JSON files from the fieldMaps/ directory.
 *
 * Field map structure (per spec v2.1):
 * {
 *   "_entityType": "1120S",
 *   "_verified": false,
 *   "_README": "...",
 *   "map": {
 *     "income.gross_receipts": {
 *       "drakeSection": "INC",
 *       "drakeLine":    "1",
 *       "drakeLabel":   "Gross receipts or sales",
 *       "drakeDebitCredit": "credit"
 *     }, ...
 *   }
 * }
 */

const path = require('path');
const fs   = require('fs');

const FIELD_MAPS_DIR = path.join(__dirname, '..', 'fieldMaps');

/**
 * Load a Drake field map for the given entity type.
 * @param {string} entityType  '1040' | '1065' | '1120' | '1120S'
 * @returns {Object}  The full parsed JSON (includes .map, ._entityType, etc.)
 * @throws  If the file doesn't exist
 */
function loadDrakeFieldMap(entityType) {
  const file = path.join(FIELD_MAPS_DIR, `drake_${entityType}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Drake field map not found for entity type "${entityType}": ` +
      `expected ${file}. ` +
      'See PENDING.md → "Field maps" section.'
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Look up one canonical key in a loaded field map.
 * @param {Object} fieldMap   result of loadDrakeFieldMap()
 * @param {string} canonicalKey
 * @returns {Object|null}  The mapping entry, or null if not present
 */
function lookupField(fieldMap, canonicalKey) {
  return fieldMap.map?.[canonicalKey] ?? null;
}

/**
 * Return the Drake account label for a mapping entry.
 * Supports both new format (drakeLabel) and legacy format (label).
 * @param {Object} entry  A single mapping entry from the map
 * @returns {string}
 */
function drakeLabel(entry) {
  return entry.drakeLabel || entry.label || '';
}

/**
 * Return all canonical keys present in the map for an entity type.
 * @param {string} entityType
 * @returns {string[]}
 */
function getMappedKeys(entityType) {
  const fm = loadDrakeFieldMap(entityType);
  return Object.keys(fm.map || {});
}

/**
 * Check whether a field map has been verified against a real Drake template.
 * @param {Object} fieldMap
 * @returns {boolean}
 */
function isVerified(fieldMap) {
  return fieldMap._verified === true;
}

module.exports = { loadDrakeFieldMap, lookupField, drakeLabel, getMappedKeys, isVerified };
