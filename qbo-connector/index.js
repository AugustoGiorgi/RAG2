/**
 * qbo-connector — Módulo de integración QuickBooks Online para RAG Tax AI
 *
 * USO:
 *   const { QBOConnector } = require('./qbo-connector');
 *   const connector = new QBOConnector();
 *
 *   // requestFn es el qboRequest del servidor, ya autenticado para username/realmId
 *   const requestFn = (path, params) => qboRequest(username, realmId, path, params);
 *
 *   const financials = await connector.fetchFinancials(requestFn, realmId, 2025, '1120S');
 *   const canonical  = connector.normalize(financials);
 *
 * El OAuth, token storage y refresh son manejados por server.js.
 * Este módulo provee solo la lógica de descarga y normalización de reportes.
 */

const { fetchFinancials }    = require('./lib/reportsFetcher');
const { normalizeFinancials } = require('./lib/dataNormalizer');

class QBOConnector {
  /**
   * Descarga los reportes financieros del año para un cliente.
   *
   * @param {Function} requestFn   (path, params) => Promise<Object>
   *                               qboRequest de server.js, ligado a username+realmId
   * @param {string}   realmId     ID de la empresa en QBO
   * @param {number}   taxYear     Año fiscal (ej: 2025)
   * @param {string}   entityType  "1040" | "1120S" | "1065" | "1120"
   * @returns {Promise<QBOFinancials>}
   */
  async fetchFinancials(requestFn, realmId, taxYear, entityType) {
    return fetchFinancials(requestFn, realmId, taxYear, entityType);
  }

  /**
   * Normaliza los reportes crudos de QBO al formato canónico del workpaper.
   * Todos los campos llevan flag "review" — el CPA confirma los valores.
   *
   * @param {Object} qboData  Resultado de fetchFinancials()
   * @returns {CanonicalReturn}
   */
  normalize(qboData) {
    return normalizeFinancials(qboData);
  }
}

module.exports = { QBOConnector };
