const { AccountingConnector } = require("./base");

// NOTE: the working Xero OAuth / refresh / report-fetch implementation lives inline
// in server.js (handleAccountingAuthRoute, getValidAccountingTokens,
// fetchUnifiedAccountingReport, etc.). This adapter mirrors qbo.js as a thin,
// dependency-injected wrapper for callers that prefer the adapters/ interface.
class XeroAdapter extends AccountingConnector {
  constructor(deps = {}) {
    super({ software: { id: "xero", name: "Xero" }, deps });
  }

  getAvailableReports() {
    return this.deps.accountingReportDefinitions?.("xero") || [];
  }

  async getCompanies(sessionId) {
    return this.deps.getAccountingRecord?.(sessionId, "xero")?.companies || [];
  }

  async fetchReport(sessionId, companyId, reportId, params = {}) {
    return this.deps.fetchUnifiedAccountingReport(sessionId, "xero", companyId, { ...params, reportId });
  }
}

module.exports = XeroAdapter;
