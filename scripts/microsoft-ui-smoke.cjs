"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "rag-ms-ui-data-"));
  const images = fs.mkdtempSync(path.join(os.tmpdir(), "rag-ms-ui-images-"));
  const password = crypto.randomBytes(24).toString("base64url");
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = `pbkdf2$210000$${salt}$${crypto.pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("base64url")}`;
  fs.writeFileSync(path.join(data, "users.json"), JSON.stringify({ users: [{ username: "ui_member", role: "firm_admin", displayName: "Test Member", active: true, tenantId: "test-firm", passwordHash }], budgetGroups: [] }));
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const base = "http://127.0.0.1:" + port;
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: data, AUTH_REQUIRED: "true", AUTH_SECRET: "synthetic-ms-ui-secret-0123456789", TOKEN_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"), COOKIE_SECURE: "false", AUTH_USERS_JSON: "[]", DATABASE_URL: "", ANTHROPIC_API_KEY: "", ADMIN_2FA_ENABLED: "false", MICROSOFT_CLIENT_ID: "", MICROSOFT_CLIENT_SECRET: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "", browser;
  child.stdout.on("data", c => { log = (log + c).slice(-3000); }); child.stderr.on("data", c => { log = (log + c).slice(-3000); });
  try {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) { try { if ((await fetch(base + "/healthz")).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 150)); }
    assert.ok(Date.now() < deadline, log);
    assert.equal((await fetch(base + "/api/microsoft/status", { redirect: "manual" })).status, 401);
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    assert.equal((await page.request.post(base + "/api/login", { data: { username: "ui_member", password } })).status(), 200);
    const actualStatus = await page.request.get(base + "/api/microsoft/status"); assert.equal((await actualStatus.json()).enabled, false);
    const denied = await page.request.post(base + "/api/microsoft/disconnect", { data: {}, headers: { Origin: "https://evil.example" } }); assert.equal(denied.status(), 403);
    let msConnected = true, largeMail = false, reads = 0, releaseRead, sentPayload, microsoftSends = 0, gmailSends = 0;
    await page.route("**/api/microsoft/status", route => route.fulfill({ json: { enabled: true, connected: msConnected, email: "member@outlook.com", driveAuthorized: msConnected, mailAuthorized: msConnected, writeAuthorized: msConnected, largeMailAuthorized: largeMail } }));
    await page.route("**/api/microsoft/drive/list?*", route => {
      const folder = new URL(route.request().url()).searchParams.get("folderId");
      return route.fulfill({ json: folder === "root" ? { folders: [{ id: "folder1", name: "Tax returns 2026" }], files: [], nextPageToken: null } : { folders: [], files: [{ id: "file1", name: "Reviewed tax return.pdf", size: 3, mimeType: "application/pdf" }], nextPageToken: null } });
    });
    await page.route("**/api/microsoft/drive/read-file", async route => {
      reads++;
      await new Promise(resolve => { releaseRead = resolve; });
      await route.fulfill({ json: { fileName: "Reviewed tax return.pdf", mimeType: "application/pdf", contentBase64: "YWJj", sizeBytes: 3, oneDriveFileId: "file1" } });
    });
    await page.route("**/api/microsoft/mail/send", route => { microsoftSends++; sentPayload = route.request().postDataJSON(); return route.fulfill({ json: { ok: true, accepted: true, provider: "outlook" } }); });
    await page.route("**/api/deliverable/send-gmail", route => { gmailSends++; return route.fulfill({ json: { ok: true, messageId: "synthetic-gmail-id" } }); });
    await page.route("**/api/requests/read-files", route => route.fulfill({ json: { files: [] } }));
    await page.route("**/api/requests/log", route => route.fulfill({ json: { ok: true } }));
    await page.goto(base, { waitUntil: "networkidle" });
    assert.equal(await page.locator('[id^="onedrive-btn-"]').count(), 13);
    assert.equal(await page.locator('[id^="drive-btn-"]').count(), 13);
    await page.evaluate(() => setWorkspaceMode("preparation"));
    await page.locator("#onedrive-btn-prep-package").click();
    await page.getByRole("button", { name: "Folder: Tax returns 2026" }).click();
    await page.getByText("Reviewed tax return.pdf", { exact: true }).click();
    await page.locator(".microsoft-dialog").screenshot({ path: path.join(images, "desktop.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator(".microsoft-dialog").evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.locator(".microsoft-dialog").screenshot({ path: path.join(images, "mobile.png") });
    await page.getByRole("button", { name: "Add selected files" }).click();
    await page.getByText("Loading 1 of 1: Reviewed tax return.pdf...").waitFor();
    assert.equal(await page.getByRole("button", { name: "Add selected files" }).isDisabled(), true);
    assert.equal(await page.locator(".microsoft-dialog").getAttribute("aria-busy"), "true");
    while (!releaseRead) await new Promise(resolve => setTimeout(resolve, 20));
    releaseRead(); await page.locator(".microsoft-dialog").waitFor({ state: "detached" });
    assert.equal(reads, 1);
    assert.equal(await page.evaluate(() => preparerFiles.packageFiles[0].source), "onedrive");
    assert.equal(await page.evaluate(() => readAsBase64(preparerFiles.packageFiles[0])), "YWJj");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      setWorkspaceMode("deliverable");
      document.getElementById("deliverableDraftPanel").hidden = false;
      document.getElementById("deliverableResults").hidden = false;
      els.emailSubjectDraft.value = "Reviewed return"; els.emailBodyDraft.value = "Please review."; els.gmailTo.value = "client@example.com";
      deliverableState.draft = { subject: "Reviewed return", body: "Please review." };
    });
    await page.selectOption('[data-mail-provider="deliverable"]', "outlook");
    assert.equal(await page.locator("#gmailFrom").innerText(), "member@outlook.com");
    page.on("dialog", dialog => dialog.accept());
    await page.evaluate(() => sendDeliverableGmail());
    await page.getByText("Outlook accepted the email for sending", { exact: false }).first().waitFor();
    assert.equal(sentPayload.to, "client@example.com");
    assert.equal(sentPayload.subject, "Reviewed return");
    assert.equal(await page.evaluate(() => emailProvider("estimated")), "gmail");
    assert.equal(await page.evaluate(() => emailSendPath("gmail")), "/api/deliverable/send-gmail");
    await page.evaluate(async () => {
      setWorkspaceMode("estimated");
      estimatedTaxesState.lastResult = { clientEmail: "client@example.com", email: { subject: "Estimated tax", body: "Review the workbook." } };
      estimatedTaxesState.reviewedWorkpaper = { name: "workpaper.xlsx", source: "onedrive", content: "YWJj" };
      els.estEmailSubject.value = "Estimated tax"; els.estEmailBody.value = "Review the workbook.";
      MicrosoftConnection.select("estimated", "outlook"); await sendEstimatedTaxesEmail();
    });
    assert.equal(sentPayload.subject, "Estimated tax"); assert.equal(sentPayload.attachments[0].contentBase64, "YWJj");
    await page.evaluate(async () => {
      setWorkspaceMode("organizer");
      requestState.generatedEmail = { subject: "Client request", body: "Please send files." }; requestState.selectedFiles = [];
      MicrosoftConnection.select("request", "outlook"); renderRequestEmailPreview(requestState.generatedEmail);
      document.getElementById("requestEmailTo").value = "client@example.com";
      await sendRequestEmail();
    });
    assert.equal(sentPayload.subject, "Client request"); assert.equal(microsoftSends, 3);
    await page.evaluate(async () => {
      setWorkspaceMode("deliverable"); deliverableState.gmailStatus = { authorized: true, email: "google@example.com" };
      MicrosoftConnection.select("deliverable", "gmail"); await sendDeliverableGmail();
    });
    assert.equal(gmailSends, 1); assert.equal(microsoftSends, 3);
    const parentUrl = page.url();
    await page.context().route("**/auth/microsoft?purpose=mail_large", route => {
      largeMail = true;
      return route.fulfill({ contentType: "text/html", body: '<script>window.opener.postMessage({type:"microsoft_connected"},location.origin);setTimeout(()=>window.close(),50)</script>' });
    });
    await page.evaluate(() => { MicrosoftConnection.select("deliverable", "outlook"); emailSendError({ code: "MICROSOFT_PERMISSION_REQUIRED", purpose: "mail_large" }, "deliverable"); });
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("button", { name: "Allow large Outlook attachments" }).click();
    const popup = await popupPromise; await popup.waitForEvent("close");
    await page.waitForFunction(() => MicrosoftConnection.status().largeMailAuthorized);
    assert.equal(page.url(), parentUrl); assert.equal(microsoftSends, 3);
    await page.evaluate(async () => { await openAdminDashboard(); renderFirmDrive({ enabled: true, microsoftEnabled: true, microsoftConnected: true, canManage: true, configured: false, googleConnected: false }); });
    await page.selectOption("#firmStorageProvider", "microsoft");
    assert.equal(await page.locator('[data-firm-drive="setup"]').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, imageDirectory: images, checks: ["13 Google buttons preserved", "13 OneDrive buttons", "folder navigation", "persistent loading", "file import", "mobile layout", "all three Outlook send workflows", "Gmail send preserved", "popup only with no automatic resend", "OneDrive firm storage", "unauthenticated and cross-origin blocked"] }));
  } finally {
    await browser?.close(); child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once("exit", resolve));
    if (path.dirname(data) === os.tmpdir() && path.basename(data).startsWith("rag-ms-ui-data-")) fs.rmSync(data, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
