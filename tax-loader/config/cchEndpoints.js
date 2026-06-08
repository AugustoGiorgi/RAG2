/*
 * REQUIERE-DOC-OFICIAL
 * Values must come from the CCH Axcess Developer Portal after the firm has
 * Wolters Kluwer Open Integration Platform access. Do not invent endpoints,
 * scopes, request bodies, field names, or HTTP methods.
 */
module.exports = {
  baseUrl: process.env.CCH_BASE_URL || "REQUIERE-DOC-OFICIAL:CCH_BASE_URL",
  oauth: {
    tokenPath: "REQUIERE-DOC-OFICIAL:CCH_OAUTH_TOKEN_PATH",
    grantType: "REQUIERE-DOC-OFICIAL:CCH_OAUTH_GRANT_TYPE",
    scope: "REQUIERE-DOC-OFICIAL:CCH_OAUTH_SCOPES",
  },
  paths: {
    clientsSearch: "REQUIERE-DOC-OFICIAL:CCH_CLIENTS_SEARCH_PATH",
    clientsCreate: "REQUIERE-DOC-OFICIAL:CCH_CLIENTS_CREATE_PATH",
    returnsCreate: "REQUIERE-DOC-OFICIAL:CCH_RETURNS_CREATE_PATH",
    returnInput: "REQUIERE-DOC-OFICIAL:CCH_RETURN_INPUT_PATH",
    diagnostics: "REQUIERE-DOC-OFICIAL:CCH_DIAGNOSTICS_PATH",
  },
  methods: {
    returnInput: "REQUIERE-DOC-OFICIAL:CCH_RETURN_INPUT_METHOD",
  },
};
