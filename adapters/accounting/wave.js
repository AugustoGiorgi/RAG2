const { AccountingConnector } = require("./base");

class WaveAdapter extends AccountingConnector {
  constructor(deps = {}) {
    super({ software: { id: "wave", name: "Wave Accounting" }, deps });
  }
}

module.exports = WaveAdapter;
