"use strict";

const crypto = require("node:crypto");
const GRAPH = "https://graph.microsoft.com/v1.0";
const MB = 1024 * 1024;
const fail = (message, statusCode = 400, extra = {}) => Object.assign(new Error(message), { statusCode, ...extra });
const itemId = value => {
  if (!/^[a-z0-9!_.-]{1,256}$/i.test(String(value)) || value === "..") throw fail("Invalid OneDrive item.");
  return encodeURIComponent(value);
};
const cleanName = value => String(value || "file").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 180);
function safeDownloadUrl(value, outlook = false) {
  const url = new URL(value);
  const hosts = outlook ? ["outlook.office.com", "outlook.office365.com"] : ["1drv.com", "sharepoint.com", "onedrive.live.com", "storage.live.com"];
  const personalContent = !outlook && url.hostname === "my.microsoftpersonalcontent.com";
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
      (!personalContent && !hosts.some(host => url.hostname === host || url.hostname.endsWith("." + host)))) throw fail("Microsoft returned an unsupported download or upload address.", 502);
  return url.href;
}
function recipients(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,;]/);
  if (list.length > 50) throw fail("Too many email recipients.");
  return [...new Set(list.map(v => String(v).trim()).filter(Boolean))].map(address => {
    if (address.length > 254 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address)) throw fail("Enter valid email addresses.");
    return { emailAddress: { address } };
  });
}
function decodeAttachment(file) {
  const content = String(file.contentBase64 || "");
  if (!content || content.length > 36 * MB || content.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw fail("Invalid or oversized attachment.");
  const buffer = Buffer.from(content, "base64");
  return { name: cleanName(file.name || file.fileName), contentType: String(file.mimeType || "application/octet-stream").slice(0, 150), buffer };
}

function createMicrosoftGraph({ auth, fetcher = fetch, maxFileBytes = 25 * MB }) {
  async function call(username, purpose, endpoint, options = {}) {
    const url = new URL(endpoint, GRAPH + "/");
    if (url.origin !== "https://graph.microsoft.com" || url.username || url.password || !url.pathname.startsWith("/v1.0/")) throw fail("Invalid Microsoft API address.");
    const token = await auth.token(username, purpose);
    let response;
    try {
      response = await fetcher(url.href, { ...options, headers: { ...options.headers, Authorization: "Bearer " + token }, redirect: "manual", signal: AbortSignal.timeout(60000) });
    } catch {
      throw fail(options.method === "POST" && /send(Mail)?$/.test(url.pathname)
        ? "Outlook did not confirm the request. Check Sent Items before trying again to avoid a duplicate email."
        : "Microsoft did not respond. Please try again.", 502);
    }
    if (response.status === 302 && endpoint.endsWith("/content")) return response;
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const code = data.error?.code;
      if (response.status === 401 || code === "InvalidAuthenticationToken") throw fail("Your Microsoft connection expired. Reconnect Microsoft.", 401, { code: "MICROSOFT_PERMISSION_REQUIRED", purpose });
      throw fail(response.status === 403 ? "Microsoft denied access to this item. Check the account and its permissions."
        : response.status === 429 ? "Microsoft is busy. Wait before trying again."
        : response.status === 404 ? "The Microsoft item no longer exists or is not accessible."
        : "Microsoft could not complete the operation (HTTP " + response.status + ").", response.status >= 500 ? 502 : response.status);
    }
    return response;
  }
  const json = async (...args) => (await call(...args)).json();
  const body = data => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const folderPath = id => id === "root" ? "/v1.0/me/drive/root" : "/v1.0/me/drive/items/" + itemId(id);
  function pageUrl(base, pageToken) {
    if (!pageToken) return base + "?$top=100&$select=id,name,size,file,folder,webUrl,parentReference";
    if (pageToken.length > 12000) throw fail("Invalid OneDrive page.");
    let url;
    try { url = new URL(Buffer.from(pageToken, "base64url").toString()); } catch { throw fail("Invalid OneDrive page."); }
    if (url.origin !== "https://graph.microsoft.com" || url.username || url.password || url.pathname !== new URL(base, GRAPH).pathname) throw fail("Invalid OneDrive page.");
    return url.href;
  }
  const mapItem = item => ({ id: item.id, name: item.name, size: item.size || 0, mimeType: item.file?.mimeType || "application/octet-stream", isFolder: Boolean(item.folder), webViewLink: /^https:\/\//i.test(item.webUrl || "") ? item.webUrl : "" });
  async function list(username, { folderId = "root", pageToken = "", query = "" } = {}) {
    const q = String(query).trim();
    if (q.length > 160) throw fail("Search text is too long.");
    const base = q ? "/v1.0/me/drive/root/search(q='" + encodeURIComponent(q.replace(/'/g, "''")).replace(/'/g, "%27") + "')" : folderPath(folderId) + "/children";
    let data;
    try { data = await json(username, "drive", pageUrl(base, pageToken)); }
    catch (error) {
      if (error.statusCode === 404 && folderId === "root" && !q && !pageToken) {
        throw fail("OneDrive is not ready for this account. Open OneDrive on Microsoft's website once, then try again. Work accounts may also need their organization to enable OneDrive.", 404);
      }
      throw error;
    }
    const items = (data.value || []).filter(item => item.id && !item.remoteItem).map(mapItem);
    return { folders: items.filter(item => item.isFolder), files: items.filter(item => !item.isFolder), nextPageToken: data["@odata.nextLink"] ? Buffer.from(data["@odata.nextLink"]).toString("base64url") : null };
  }
  async function readFile(username, id) {
    const base = "/v1.0/me/drive/items/" + itemId(id);
    const info = await json(username, "drive", base + "?$select=id,name,size,file,folder,webUrl");
    if (!info.file || info.folder) throw fail("Select a file, not a folder.");
    if (info.size > maxFileBytes) throw fail("This OneDrive file exceeds the 25 MB limit.", 413);
    let response = await call(username, "drive", base + "/content");
    // Preauthenticated Microsoft download links must never receive the Graph bearer token.
    for (let redirects = 0; response.status === 302 && redirects < 4; redirects++) {
      const target = safeDownloadUrl(response.headers.get("location"));
      response = await fetcher(target, { redirect: "manual", signal: AbortSignal.timeout(120000) });
    }
    if (!response.ok) throw fail("OneDrive could not download the file.", 502);
    if (Number(response.headers.get("content-length")) > maxFileBytes) throw fail("This OneDrive file is too large.", 413);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxFileBytes) throw fail("This OneDrive file is too large.", 413);
      chunks.push(Buffer.from(chunk));
    }
    return { fileName: cleanName(info.name), mimeType: info.file.mimeType || "application/octet-stream", contentBase64: Buffer.concat(chunks).toString("base64"), sizeBytes: size, oneDriveFileId: info.id, webViewLink: info.webUrl || "" };
  }
  async function createFolder(username, name) {
    const result = await json(username, "write", "/v1.0/me/drive/root/children", body({ name: cleanName(name), folder: {}, "@microsoft.graph.conflictBehavior": "rename" }));
    return { id: result.id, name: result.name, url: result.webUrl || "" };
  }
  async function folderUsable(username, id) {
    try { return Boolean((await json(username, "write", folderPath(id) + "?$select=id,folder")).folder); }
    catch (error) { if (error.statusCode === 404) return false; throw error; }
  }
  async function uploadFile(username, folderId, name, buffer, mimeType) {
    if (!buffer?.length || buffer.length > maxFileBytes) throw fail("Invalid or oversized OneDrive upload.", 413);
    const safe = cleanName(name);
    const suffix = crypto.randomBytes(6).toString("hex");
    const dot = safe.lastIndexOf(".");
    const unique = dot > 0 ? safe.slice(0, dot) + "-" + suffix + safe.slice(dot) : safe + "-" + suffix;
    const result = await json(username, "write", folderPath(folderId) + ":/" + encodeURIComponent(unique) + ":/content", { method: "PUT", headers: { "Content-Type": mimeType }, body: buffer });
    return { id: result.id, name: result.name, url: result.webUrl || "" };
  }
  async function sendMail(username, payload) {
    const toRecipients = recipients(payload.to);
    const ccRecipients = recipients([...(Array.isArray(payload.cc) ? payload.cc : String(payload.cc || "").split(/[,;]/)), ...(payload.ccPreparer && payload.preparerEmail ? [payload.preparerEmail] : [])]);
    const subject = String(payload.subject || "").trim();
    const content = String(payload.bodyHtml || payload.bodyText || "");
    if (!toRecipients.length || !subject || /[\r\n]/.test(subject) || subject.length > 998 || !content || content.length > MB) throw fail("Add a recipient, subject and email body.");
    if (!Array.isArray(payload.attachments || []) || (payload.attachments || []).length > 25) throw fail("Too many attachments.");
    const files = (payload.attachments || []).map(decodeAttachment);
    if (files.reduce((sum, file) => sum + file.buffer.length, 0) > 25 * MB) throw fail("Attachments exceed the 25 MB limit.", 413);
    const message = { subject, body: { contentType: payload.bodyHtml ? "HTML" : "Text", content }, toRecipients, ccRecipients };
    const attachment = file => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: file.name, contentType: file.contentType, contentBytes: file.buffer.toString("base64") });
    const small = { message: { ...message, attachments: files.map(attachment) }, saveToSentItems: true };
    if (Buffer.byteLength(JSON.stringify(small)) < 3 * MB) {
      const response = await call(username, "mail", "/v1.0/me/sendMail", body(small));
      if (response.status !== 202) throw fail("Outlook did not confirm email submission. Check Sent Items before retrying.", 502);
      return { ok: true, accepted: true, provider: "outlook" };
    }
    // Large attachments require a draft upload session and incremental Mail.ReadWrite consent.
    await auth.token(username, "mail_large");
    const draft = await json(username, "mail_large", "/v1.0/me/messages", body(message));
    const draftPath = "/v1.0/me/messages/" + encodeURIComponent(draft.id);
    try {
      for (const file of files) {
        if (file.buffer.length < 3 * MB) {
          await call(username, "mail_large", draftPath + "/attachments", body(attachment(file)));
          continue;
        }
        const session = await json(username, "mail_large", draftPath + "/attachments/createUploadSession", body({ AttachmentItem: { attachmentType: "file", name: file.name, size: file.buffer.length, contentType: file.contentType } }));
        const target = safeDownloadUrl(session.uploadUrl, true);
        for (let offset = 0; offset < file.buffer.length; offset += 10 * 320 * 1024) {
          const chunk = file.buffer.subarray(offset, Math.min(offset + 10 * 320 * 1024, file.buffer.length));
          const response = await fetcher(target, { method: "PUT", redirect: "error", signal: AbortSignal.timeout(120000), headers: { "Content-Type": "application/octet-stream", "Content-Length": String(chunk.length), "Content-Range": `bytes ${offset}-${offset + chunk.length - 1}/${file.buffer.length}` }, body: chunk });
          const complete = offset + chunk.length === file.buffer.length;
          if (complete ? response.status !== 201 : response.status !== 200) throw fail("Outlook did not confirm the complete attachment upload.", 502);
        }
      }
      const response = await call(username, "mail_large", draftPath + "/send", { method: "POST" });
      if (response.status !== 202) throw fail("Outlook did not confirm submission. Check Sent Items before retrying.", 502);
      return { ok: true, accepted: true, provider: "outlook", messageId: draft.id };
    } catch (error) {
      throw fail(error.message + " An email draft may remain in Outlook. Check Drafts and Sent Items before trying again.", error.statusCode || 502);
    }
  }
  return { list, readFile, createFolder, folderUsable, uploadFile, sendMail };
}

module.exports = { createMicrosoftGraph, safeDownloadUrl, recipients, decodeAttachment };
