const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const server = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");

test("Xero requests only the granular report scopes used by the preparation flow", () => {
  const expectedScopes = [
    "accounting.reports.profitandloss.read",
    "accounting.reports.balancesheet.read",
    "accounting.reports.trialbalance.read",
    "accounting.reports.banksummary.read",
    "accounting.reports.executivesummary.read",
  ];

  for (const scope of expectedScopes) assert.ok(server.includes(`"${scope}"`), `missing Xero scope ${scope}`);
  assert.ok(server.includes('"offline_access"'), "Xero must request a refresh token");
  assert.ok(!server.includes('"accounting.reports.read"'), "deprecated broad Xero report scope must not be requested");
});

test("every Xero report offered in Preparations has a matching granular scope", () => {
  assert.match(server, /reports: \["ProfitAndLoss", "BalanceSheet", "TrialBalance", "BankSummary", "ExecutiveSummary"\]/);
  assert.match(server, /BankSummary: "BankSummary"/);
  assert.doesNotMatch(server, /CashSummary: "CashSummary"/);
});

test("Xero report requests use supported date and cash-basis parameters", () => {
  assert.match(server, /TrialBalance: \{ name: "Trial Balance", category: "balance", asOfDate: true \}/);
  assert.match(server, /query\.set\("paymentsOnly", "true"\)/);
  assert.doesNotMatch(server, /query\.set\("reportingBasis"/);
});
