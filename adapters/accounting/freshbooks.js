const { AccountingConnector } = require("./base");

class FreshBooksAdapter extends AccountingConnector {
  constructor(deps = {}) {
    super({ software: { id: "freshbooks", name: "FreshBooks" }, deps });
  }
}

module.exports = FreshBooksAdapter;
