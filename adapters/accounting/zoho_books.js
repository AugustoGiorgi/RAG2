const { AccountingConnector } = require("./base");

class ZohoBooksAdapter extends AccountingConnector {
  constructor(deps = {}) {
    super({ software: { id: "zoho_books", name: "Zoho Books" }, deps });
  }
}

module.exports = ZohoBooksAdapter;
