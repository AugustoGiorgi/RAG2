"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createMicrosoftGraph, safeDownloadUrl } = require("../lib/microsoft-graph");
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function fixture(fetcher, options = {}) {
  const grants = [], requests = [];
  const graph = createMicrosoftGraph({ auth: { token: async (user, purpose) => { grants.push([user, purpose]); return "PRIVATE-" + user; } },
    fetcher: async (url, init) => { requests.push({ url, ...init }); return fetcher(url, init); }, ...options });
  return { graph, grants, requests };
}
const message = { to: "client@example.com", subject: "Reviewed return", bodyText: "Review attached.", attachments: [] };
test("OneDrive lists folders and files with the authenticated account and minimal read permission", async () => {
  const f = fixture(() => json({ value: [{ id: "folder1", name: "2026", folder: {} }, { id: "file1", name: "tax.pdf", file: { mimeType: "application/pdf" } }, { id: "remote", name: "Other drive", remoteItem: {} }] }));
  const result = await f.graph.list("alice");
  assert.equal(result.folders.length, 1); assert.equal(result.files.length, 1);
  assert.deepEqual(f.grants, [["alice", "drive"]]);
  assert.equal(f.requests[0].headers.Authorization, "Bearer PRIVATE-alice");
});
test("pagination rejects cross-origin URLs and other users' drive paths", async () => {
  const f = fixture(() => { throw new Error("Must not fetch"); });
  for (const url of ["https://evil.example/v1.0/me/drive/root/children", "https://graph.microsoft.com/v1.0/users/bob/drive/root/children"]) {
    await assert.rejects(f.graph.list("alice", { pageToken: Buffer.from(url).toString("base64url") }), /Invalid OneDrive page/);
  }
  assert.equal(f.requests.length, 0);
});
test("file download never forwards the bearer token to Microsoft's download host", async () => {
  const f = fixture((url) => url.includes("?$select") ? json({ id: "file1", name: "tax.pdf", size: 3, file: { mimeType: "application/pdf" } })
    : url.endsWith("/content") ? new Response(null, { status: 302, headers: { location: "https://tenant.sharepoint.com/download?token=private" } }) : new Response("abc"));
  const result = await f.graph.readFile("alice", "file1");
  assert.equal(result.contentBase64, "YWJj"); assert.equal(f.requests[2].headers, undefined);
  assert.equal(result.oneDriveFileId, "file1");
});

test("personal OneDrive content downloads without forwarding the Graph token", async () => {
  const f = fixture(url => url.includes("?$select") ? json({ id: "file1", name: "welcome.pdf", size: 3, file: { mimeType: "application/pdf" } })
    : url.endsWith("/content") ? new Response(null, { status: 302, headers: { location: "https://my.microsoftpersonalcontent.com/personal/download?token=private" } }) : new Response("abc"));
  assert.equal((await f.graph.readFile("alice", "file1")).contentBase64, "YWJj");
  assert.equal(f.requests[2].headers, undefined);
  assert.equal(f.requests[2].redirect, "manual");
  assert.throws(() => safeDownloadUrl("https://my.microsoftpersonalcontent.com/upload", true));
});

test("an uninitialized root drive explains how to activate OneDrive", async () => {
  const f = fixture(() => json({ error: { code: "itemNotFound" } }, 404));
  await assert.rejects(f.graph.list("alice"), /Open OneDrive on Microsoft's website once/);
  await assert.rejects(f.graph.list("alice", { folderId: "deleted" }), /no longer exists/);
});
test("download host validation rejects spoofing, credentials and plaintext", () => {
  for (const url of ["https://sharepoint.com.evil.example/file", "https://u:p@tenant.sharepoint.com/file", "http://tenant.sharepoint.com/file", "https://tenant.sharepoint.com:444/file", "https://127.0.0.1/file", "https://my.microsoftpersonalcontent.com.evil.example/file", "https://evil.my.microsoftpersonalcontent.com/file", "https://microsoftpersonalcontent.com/file", "https://u:p@my.microsoftpersonalcontent.com/file", "http://my.microsoftpersonalcontent.com/file", "https://my.microsoftpersonalcontent.com:444/file"]) assert.throws(() => safeDownloadUrl(url));
});
test("download stops files exceeding the stream limit even when metadata lies", async () => {
  const f = fixture(url => url.includes("?$select") ? json({ id: "file1", name: "tax.pdf", size: 1, file: {} }) : new Response("123456"), { maxFileBytes: 5 });
  await assert.rejects(f.graph.readFile("alice", "file1"), /too large/);
});
test("small mail uses Mail.Send only, honors CC and attachments, and does not override From", async () => {
  const f = fixture(() => new Response(null, { status: 202 }));
  const result = await f.graph.sendMail("alice", { ...message, from: "bob@example.com", cc: "cc@example.com", ccPreparer: true, preparerEmail: "prep@example.com", attachments: [{ name: "tax.pdf", contentBase64: "YWJj", mimeType: "application/pdf" }] });
  assert.deepEqual(f.grants, [["alice", "mail"]]);
  const sent = JSON.parse(f.requests[0].body);
  assert.equal(new URL(f.requests[0].url).pathname, "/v1.0/me/sendMail");
  assert.equal(sent.message.from, undefined); assert.equal(sent.message.ccRecipients.length, 2);
  assert.equal(sent.message.attachments[0].contentBytes, "YWJj"); assert.equal(sent.saveToSentItems, true);
  assert.equal(result.accepted, true); assert.equal(result.messageId, undefined);
});
test("ambiguous mail submission is never retried", async () => {
  const f = fixture(() => { throw new Error("timeout"); });
  await assert.rejects(f.graph.sendMail("alice", message), /Check Sent Items/);
  assert.equal(f.requests.length, 1);
});
test("invalid addresses, malformed attachments and excessive attachment sizes never reach Microsoft", async () => {
  const f = fixture(() => { throw new Error("Must not fetch"); });
  await assert.rejects(f.graph.sendMail("alice", { ...message, to: "a@example.com\r\nBcc: victim@example.com" }));
  await assert.rejects(f.graph.sendMail("alice", { ...message, attachments: [{ contentBase64: "wrong?" }] }));
  await assert.rejects(f.graph.sendMail("alice", { ...message, attachments: Array.from({ length: 26 }, () => ({ contentBase64: "YWJj" })) }));
  assert.equal(f.requests.length, 0);
});
test("large attachments use a draft, incremental permissions and unauthenticated bounded upload chunks", async () => {
  const f = fixture((url, init) => url.endsWith("/messages") ? json({ id: "new-draft" }) : url.endsWith("/createUploadSession") ? json({ uploadUrl: "https://outlook.office.com/upload/private" }) : url.includes("/upload/") ? new Response(null, { status: init.headers["Content-Range"].startsWith("bytes 0-") ? 200 : 201 }) : new Response(null, { status: 202 }));
  const result = await f.graph.sendMail("alice", { ...message, attachments: [{ name: "tax.pdf", contentBase64: Buffer.alloc(4 * 1024 * 1024).toString("base64") }] });
  assert.equal(result.messageId, "new-draft"); assert.equal(result.accepted, true);
  assert.ok(f.grants.every(([, purpose]) => purpose === "mail_large"));
  const chunks = f.requests.filter(req => req.method === "PUT");
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) { assert.equal(chunk.headers.Authorization, undefined); assert.ok(chunk.body.length < 4 * 1024 * 1024); }
});
test("OneDrive upload requires write permission and never overwrites a previous filename", async () => {
  const f = fixture(() => json({ id: "new-file", name: "review.docx", webUrl: "https://tenant.sharepoint.com/item" }));
  await f.graph.uploadFile("alice", "folder1", "review.docx", Buffer.from("abc"), "application/octet-stream");
  assert.deepEqual(f.grants, [["alice", "write"]]);
  assert.match(f.requests[0].url, /review-[a-f0-9]{12}\.docx/);
});
