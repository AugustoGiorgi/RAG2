/**
 * Credenciales de TU APP registrada en developer.intuit.com
 * Pasos: https://developer.intuit.com → Create an app → QuickBooks Online and Payments
 * Copiar Client ID + Client Secret → poner en .env del servidor principal
 */
module.exports = {
  clientId:     process.env.QBO_CLIENT_ID     || "",
  clientSecret: process.env.QBO_CLIENT_SECRET || "",
  redirectUri:  process.env.QBO_REDIRECT_URI  || "http://localhost:3000/auth/qbo/callback",
  environment:  process.env.QBO_ENVIRONMENT   || "sandbox",

  authBaseUrl:    "https://appcenter.intuit.com/connect/oauth2",
  tokenUrl:       "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  apiBaseUrl:     "https://quickbooks.api.intuit.com/v3/company",
  sandboxBaseUrl: "https://sandbox-quickbooks.api.intuit.com/v3/company",

  scopes: ["com.intuit.quickbooks.accounting"],

  // Refresh proactivo: 10 min antes de que expire el access token (60 min)
  accessTokenTtlMs: 60 * 60 * 1000,
  refreshBufferMs:  10 * 60 * 1000,
};
