"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
function appFunction(name) {
  const match = source.match(new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?^}`, "m"));
  assert.ok(match, `Missing top-level app function: ${name}`);
  return match[0];
}

test("history timestamps format valid dates and safely handle missing or invalid values", () => {
  const context = vm.createContext({});
  vm.runInContext(appFunction("formatDateTime"), context);
  const input = "2026-11-26T18:11:00.000Z";
  assert.equal(context.formatDateTime(input), new Date(input).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }));
  for (const value of [undefined, null, "", "not-a-date", "<script>alert(1)</script>"]) {
    assert.equal(context.formatDateTime(value), "-");
  }
  assert.notEqual(context.formatDateTime(0), "-");
});

test("Outlook and existing Gmail history render dates and escape record contents", () => {
  const section = { hidden: true }, table = { innerHTML: "" };
  const state = { sendHistory: [
    { sentAt: "2026-11-26T18:11:00Z", to: "self@example.com", subject: "Outlook test", attachmentNames: ["welcome.pdf"], status: "Submitted to Outlook" },
    { sentAt: "invalid", to: "<img>", subject: "<script>", attachmentNames: ["<file>"], status: "Sent" },
  ] };
  const context = vm.createContext({ els: { deliverableSendHistorySection: section, deliverableSendHistory: table }, deliverableState: state });
  vm.runInContext(["formatDateTime", "escapeHtml", "renderDeliverableSendHistory"].map(appFunction).join("\n"), context);
  context.renderDeliverableSendHistory();
  assert.equal(section.hidden, false);
  assert.equal((table.innerHTML.match(/<tr>/g) || []).length, 2);
  assert.match(table.innerHTML, /Submitted to Outlook/);
  assert.match(table.innerHTML, /&lt;script&gt;/);
  assert.doesNotMatch(table.innerHTML, /<img>|<script>/);
  assert.match(table.innerHTML, /<td>-<\/td>/);
  state.sendHistory = [];
  context.renderDeliverableSendHistory();
  assert.equal(section.hidden, true);
  assert.equal(table.innerHTML, "");
});

test("an accepted email is saved even if the history display fails, without retrying delivery", async () => {
  let sends = 0;
  const saves = [], toasts = [], button = { textContent: "Review and Send Email", disabled: false };
  const result = { innerHTML: "" }, state = { draft: {}, sendHistory: [] };
  const context = vm.createContext({
    sendingDeliverableGmail: false,
    emailProvider: () => "outlook", emailAccount: () => ({ email: "self@example.com" }),
    emailSendPath: () => "/api/microsoft/mail/send", API_BASE_URL: "",
    window: { confirm: () => true },
    els: { gmailTo: { value: "self@example.com" }, gmailSendResult: result, deliverableTaxYear: { value: "2026" } },
    deliverableState: state,
    collectDeliverableEmailAttachments: async () => [{ name: "welcome.pdf" }],
    buildDeliverableGmailPayload: () => ({ to: "self@example.com", subject: "Integration test" }),
    fetch: async url => {
      assert.equal(url, "/api/microsoft/mail/send"); sends++;
      return { ok: true, json: async () => ({ accepted: true, provider: "outlook" }) };
    },
    showToast: (message, kind) => { toasts.push({ message, kind }); return { textContent: message }; },
    dismissToast() {}, escapeHtml: String,
    renderDeliverableSendHistory() { throw new Error("Synthetic display failure"); },
    autosaveSession: async value => { saves.push(value); }, getMetadata: () => ({}),
  });
  vm.runInContext(appFunction("performDeliverableGmailSend"), context);
  await context.performDeliverableGmailSend(button);
  assert.equal(sends, 1);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].deliverableSent.provider, "outlook");
  assert.equal(saves[0].status, "delivered");
  assert.equal(state.sendHistory.length, 1);
  assert.match(result.innerHTML, /Outlook accepted the email for sending/);
  assert.ok(toasts.some(item => item.kind === "warning" && /could not be displayed/.test(item.message)));
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Review and Send Email");
  assert.equal(context.sendingDeliverableGmail, false);
});
