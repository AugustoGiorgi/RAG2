function getAdapter(softwareId, deps = {}) {
  const registry = {
    quickbooks: "./qbo",
    xero: "./xero",
    sage_intacct: "./sage_intacct",
    freshbooks: "./freshbooks",
    wave: "./wave",
    zoho_books: "./zoho_books",
    netsuite: "./netsuite",
  };
  const modulePath = registry[softwareId];
  if (!modulePath) throw new Error(`Adapter not found for software: ${softwareId}`);
  const Adapter = require(modulePath);
  return new Adapter(deps);
}

module.exports = { getAdapter };
