const { AccountingConnector } = require("./base");

class QBOAdapter extends AccountingConnector {
  constructor(deps = {}) {
    super({ software: { id: "quickbooks", name: "QuickBooks Online" }, deps });
  }

  getAvailableReports() {
    return this.deps.availableQboReports?.() || [];
  }

  async getCompanies(sessionId) {
    return this.deps.qboCompaniesForUser?.(sessionId) || [];
  }

  async fetchReport(sessionId, companyId, reportId, params = {}) {
    return this.deps.fetchQboReport(sessionId, companyId, { ...params, reportId });
  }
}

module.exports = QBOAdapter;
