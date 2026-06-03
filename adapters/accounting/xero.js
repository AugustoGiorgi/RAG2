const { AccountingConnector } = require("./base");

class XeroAdapter extends AccountingConnector {
  constructor(deps = {}) {
    super({ software: { id: "xero", name: "Xero" }, deps });
  }
}

module.exports = XeroAdapter;
