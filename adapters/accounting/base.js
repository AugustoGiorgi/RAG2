class AccountingConnector {
  constructor({ software, deps = {} } = {}) {
    this.software = software || {};
    this.deps = deps;
  }

  getAuthUrl() {
    throw new Error(`${this.software.name || "Accounting software"} does not implement OAuth in this adapter.`);
  }

  async handleCallback() {
    throw new Error(`${this.software.name || "Accounting software"} callback handling is not implemented.`);
  }

  async getCompanies() {
    return [];
  }

  getAvailableReports() {
    return [];
  }

  async fetchReport() {
    throw new Error(`${this.software.name || "Accounting software"} report fetching is not implemented.`);
  }

  parseReport(rawData, reportId) {
    return {
      reportId,
      reportName: reportId,
      software: this.software.id || "",
      companyId: "",
      companyName: "",
      startDate: null,
      endDate: null,
      currency: "",
      basis: "N/A",
      sections: [],
      totals: {},
      rawData,
      csvContent: "",
    };
  }

  async isConnected(sessionId) {
    return Boolean(this.deps.getRecord?.(sessionId, this.software.id)?.tokens);
  }

  async disconnect(sessionId) {
    this.deps.deleteRecord?.(sessionId, this.software.id);
  }

  isTokenExpired(tokens = {}) {
    return Number(tokens.expires_at || 0) <= Date.now();
  }

  buildAuthHeader(tokens = {}) {
    return { authorization: `Bearer ${tokens.access_token || ""}` };
  }
}

module.exports = { AccountingConnector };
