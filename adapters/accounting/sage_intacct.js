const { AccountingConnector } = require("./base");

class SageIntacctAdapter extends AccountingConnector {
  constructor(deps = {}) {
    super({ software: { id: "sage_intacct", name: "Sage Intacct" }, deps });
  }
}

module.exports = SageIntacctAdapter;
