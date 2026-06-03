const { AccountingConnector } = require("./base");

class NetSuiteAdapter extends AccountingConnector {
  constructor(deps = {}) {
    super({ software: { id: "netsuite", name: "NetSuite" }, deps });
  }
}

module.exports = NetSuiteAdapter;
