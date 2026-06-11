/*
 * cchEndpoints.js — CCH Axcess Open Integration Platform (OIP) endpoint config.
 *
 * REQUIERE-DOC-OFICIAL: every value below must come from the CCH Axcess
 * Developer Portal after the firm has Wolters Kluwer OIP access. Do NOT invent
 * endpoints, scopes, request bodies, field names, or HTTP methods.
 *
 * Supply real values via environment variables (Render env vars or .env).
 * Until a variable is set, its value keeps the REQUIERE-DOC-OFICIAL sentinel and
 * the adapter's assertConfigured() guard intentionally blocks any live call — so
 * a half-configured deployment fails loudly instead of hitting the API blind.
 *
 * Environment variables (set once you have the OIP documentation):
 *   CCH_BASE_URL                 e.g. https://api.cchaxcess.com  (from OIP docs)
 *   CCH_OAUTH_TOKEN_PATH         OAuth2 token endpoint path
 *   CCH_OAUTH_GRANT_TYPE         OAuth2 grant type
 *   CCH_OAUTH_SCOPES             space-separated scopes
 *   CCH_CLIENTS_SEARCH_PATH      client lookup path (supports {ein})
 *   CCH_CLIENTS_CREATE_PATH      client create path
 *   CCH_RETURNS_CREATE_PATH      return create path
 *   CCH_RETURN_INPUT_PATH        return input path (supports {id})
 *   CCH_RETURN_INPUT_METHOD      HTTP method for return input (e.g. PATCH/PUT)
 *   CCH_DIAGNOSTICS_PATH         diagnostics path (supports {id})
 * Credentials (passed to the adapter, not stored here):
 *   CCH_CLIENT_ID, CCH_CLIENT_SECRET, CCH_API_KEY
 */
const SENTINEL = "REQUIERE-DOC-OFICIAL";

function env(name) {
  const value = String(process.env[name] || "").trim();
  return value || `${SENTINEL}:${name}`;
}

module.exports = {
  SENTINEL,
  baseUrl: env("CCH_BASE_URL"),
  oauth: {
    tokenPath: env("CCH_OAUTH_TOKEN_PATH"),
    grantType: env("CCH_OAUTH_GRANT_TYPE"),
    scope:     env("CCH_OAUTH_SCOPES"),
  },
  paths: {
    clientsSearch: env("CCH_CLIENTS_SEARCH_PATH"),
    clientsCreate: env("CCH_CLIENTS_CREATE_PATH"),
    returnsCreate: env("CCH_RETURNS_CREATE_PATH"),
    returnInput:   env("CCH_RETURN_INPUT_PATH"),
    diagnostics:   env("CCH_DIAGNOSTICS_PATH"),
  },
  methods: {
    returnInput: env("CCH_RETURN_INPUT_METHOD"),
  },
};
