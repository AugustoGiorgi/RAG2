"use strict";

window.MicrosoftConnection = (() => {
  let status = { enabled: false };
  let popup = null;
  let poll = null;
  let pending = null;
  let completing = false;
  const providers = { deliverable: "gmail", estimated: "gmail", request: "gmail" };
  const purposeFlag = { drive: "driveAuthorized", write: "writeAuthorized", mail: "mailAuthorized", mail_large: "largeMailAuthorized" };
  async function api(url, payload) {
    const response = await fetch(API_BASE_URL + url, payload === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || "Microsoft request failed."), { code: data.code, purpose: data.purpose });
    return data;
  }
  async function refresh() {
    try { status = await api("/api/microsoft/status"); } catch { status = { enabled: false }; }
    const header = document.getElementById("microsoftHeaderStatus");
    if (header) {
      header.textContent = status.connected ? `Microsoft: ${status.email || "connected"}` : "Connect Microsoft";
      header.classList.toggle("success", Boolean(status.connected));
    }
    updateAvailability();
    renderGmailStatus();
    return status;
  }
  function stop() {
    clearInterval(poll); poll = null; popup = null;
  }
  async function complete(errorMessage) {
    if (completing || !pending) return;
    completing = true;
    const action = pending;
    pending = null;
    stop();
    try {
      if (errorMessage) throw new Error(errorMessage);
      await refresh();
      if (status.connectionId !== action.attempt) throw new Error("This Microsoft connection was not completed. Start it again from the app.");
      if (!status[purposeFlag[action.purpose]]) throw new Error("Microsoft did not grant the requested permission. Reconnect from the relevant action.");
      showToast(`Microsoft connected${status.email ? " as " + status.email : ""}.`, "success");
      await action.callback?.();
    } catch (error) { showToast(error.message, "warning"); }
    finally { completing = false; }
  }
  function connect(purpose = "drive", callback) {
    if (!status.enabled) { showToast("Microsoft is not configured on this server yet. Ask the administrator to complete the Microsoft app registration.", "warning"); return; }
    if (pending) {
      if (!popup?.closed) { try { popup?.focus(); } catch {} return; }
      pending = null; stop();
    }
    const attempt = crypto.randomUUID();
    popup = window.open("/auth/microsoft?purpose=" + encodeURIComponent(purpose) + "&attempt=" + attempt, "microsoft-oauth", "width=540,height=740,scrollbars=yes,resizable=yes");
    if (!popup) { showToast("Allow pop-ups for this site to connect Microsoft.", "warning"); return; }
    const action = { purpose, callback, attempt };
    pending = action;
    const started = Date.now();
    let checking = false;
    poll = setInterval(async () => {
      if (pending !== action || checking || completing) return;
      if (Date.now() - started > 10 * 60000) { complete("Microsoft connection timed out. Please try again."); return; }
      checking = true;
      try {
        // Microsoft can sever window.opener; match this attempt against the authenticated server.
        const current = await api("/api/microsoft/status");
        if (pending === action && current.connectionId === attempt && current[purposeFlag[purpose]]) {
          try { popup?.close(); } catch {}
          await complete();
        }
      } catch { /* Transient status errors can recover until the bounded timeout. */ }
      finally { checking = false; }
    }, 1500);
    try { popup.focus(); } catch {}
  }
  window.addEventListener("message", event => {
    if (event.origin !== location.origin || event.source !== popup || !pending) return;
    if (event.data?.type === "microsoft_connected") complete();
    if (event.data?.type === "microsoft_oauth_error") complete(event.data.message || "Microsoft sign-in was cancelled.");
  });
  function run(purpose, action) {
    if (status[purposeFlag[purpose]]) return action();
    return connect(purpose, action);
  }
  function emailStatus(context) {
    return providers[context] === "outlook" ? { authorized: status.mailAuthorized, email: status.email } : deliverableState.gmailStatus || {};
  }
  function provider(context) { return providers[context] || "gmail"; }
  function updateAvailability() {
    document.querySelectorAll(".microsoft-file-button, #microsoftHeaderStatus").forEach(button => { button.hidden = !status.enabled; });
    document.querySelectorAll("[data-mail-provider]").forEach(selectEl => {
      const option = selectEl.querySelector('option[value="outlook"]');
      if (option) option.disabled = !status.enabled;
      // Keep an explicitly selected Outlook sender visible if configuration becomes unavailable.
      // Never silently replace a selected sender with Gmail.
      const control = selectEl.closest(".mail-provider-control");
      if (control) control.hidden = !status.enabled && provider(selectEl.dataset.mailProvider) !== "outlook";
    });
  }
  function select(context, value) {
    providers[context] = value === "outlook" ? "outlook" : "gmail";
    renderGmailStatus();
    if (context === "request" && requestState.generatedEmail) renderRequestEmailPreview(requestState.generatedEmail);
    const label = document.querySelector(`[data-mail-account="${context}"]`);
    if (label) label.textContent = emailStatus(context).email || "Not connected";
  }
  function grantLargeMail(context) {
    const host = document.querySelector(`[data-mail-provider="${context}"]`)?.parentElement;
    if (!host || host.querySelector("[data-large-mail]")) return;
    const button = document.createElement("button");
    button.type = "button"; button.className = "ghost-button small-button"; button.dataset.largeMail = "true";
    button.textContent = "Allow large Outlook attachments";
    button.onclick = () => connect("mail_large", () => { button.remove(); showToast("Permission granted. Review the email and press Send again.", "success"); });
    host.append(button);
  }
  function addButton(anchorId, id, label, action) {
    const anchor = document.getElementById(anchorId);
    if (!anchor || document.getElementById(id)) return;
    const button = document.createElement("button");
    button.id = id; button.type = "button"; button.className = "ghost-button small-button microsoft-file-button";
    button.hidden = !status.enabled;
    button.textContent = label; button.addEventListener("click", action);
    anchor.insertAdjacentElement("afterend", button);
  }
  function setup() {
    for (const [zone, config] of Object.entries(DRIVE_ZONE_CONFIG)) {
      addButton("drive-btn-" + zone, "onedrive-btn-" + zone, "Add from OneDrive", () => pick(config, files => addFilesToZone(zone, files)));
    }
    // Same types as the Google Drive buttons of these tabs: everything the Estimated zones take,
    // and any file at all as an email attachment (an empty list allows every type).
    addButton("estAddDriveFiles", "estAddOneDriveFiles", "Add from OneDrive", () => pick({ title: "Select Estimated Tax Files", allowedTypes: typeof ESTIMATED_PICKER_TYPES !== "undefined" ? ESTIMATED_PICKER_TYPES : ["pdf", "xlsx", "xls", "csv", "docx", "doc", "txt", "image"], multiSelect: true }, addEstimatedDriveFiles));
    addButton("deliverableAddDriveFiles", "deliverableAddOneDriveFiles", "Add from OneDrive", () => pick({ title: "Select Email Attachments", allowedTypes: [], multiSelect: true }, files => addDeliverableFiles(files, "onedrive")));
    addButton("deliverableSelectFolder", "deliverableOneDriveClient", "Client Info from OneDrive", () => pick({ title: "Select Client Info", allowedTypes: ["docx", "txt", "json", "pdf"], multiSelect: false }, files => loadDeliverableClientInfoFile(files[0])));
    if (!document.getElementById("microsoftHeaderStatus")) {
      const google = document.getElementById("driveHeaderStatus");
      const button = document.createElement("button");
      button.id = "microsoftHeaderStatus"; button.className = "topbar-button"; button.type = "button"; button.textContent = "Connect Microsoft";
      button.hidden = !status.enabled;
      button.onclick = accountDialog;
      google?.insertAdjacentElement("afterend", button);
    }
    document.querySelectorAll("[data-mail-provider]").forEach(selectEl => {
      selectEl.value = provider(selectEl.dataset.mailProvider);
      selectEl.onchange = () => select(selectEl.dataset.mailProvider, selectEl.value);
    });
    updateAvailability();
  }
  function accountDialog() {
    const dialog = document.createElement("dialog"); dialog.className = "microsoft-dialog microsoft-account";
    dialog.innerHTML = `<form method="dialog"><div class="microsoft-dialog-heading"><h3>Microsoft account</h3><button class="ghost-button small-button" aria-label="Close">Close</button></div></form><p>${escapeHtml(status.email || "Not connected")}</p><div class="action-row"><button type="button" data-ms-connect class="primary-button">${status.connected ? "Change account" : "Connect OneDrive"}</button>${status.connected ? '<button type="button" data-ms-disconnect class="ghost-button">Disconnect Microsoft</button>' : ""}</div>`;
    document.body.append(dialog); dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("[data-ms-connect]").onclick = () => { dialog.close(); connect("drive"); };
    const disconnect = dialog.querySelector("[data-ms-disconnect]");
    if (disconnect) disconnect.onclick = async () => {
      if (!confirm("Disconnect your Microsoft account from RAG Tax AI? Files and emails already in Microsoft stay there.")) return;
      disconnect.disabled = true;
      try { await api("/api/microsoft/disconnect", {}); dialog.close(); await refresh(); showToast("Microsoft disconnected.", "success"); }
      catch (error) { showToast(error.message, "error"); disconnect.disabled = false; }
    };
    dialog.showModal();
  }
  function allowed(file, types) {
    if (!types?.length) return true;
    const ext = String(file.name).split(".").pop().toLowerCase();
    return types.includes(ext) || (types.includes("image") && /^(png|jpe?g|webp|gif|bmp|tiff?)$/.test(ext));
  }
  function pick(config, callback) { return run("drive", () => openPicker(config, callback)); }
  function openPicker(config, callback) {
    const previousFocus = document.activeElement;
    const dialog = document.createElement("dialog"); dialog.className = "microsoft-dialog";
    dialog.innerHTML = `<div class="microsoft-dialog-heading"><div><h3>${escapeHtml(config.title || "Select OneDrive Files")}</h3><p>${escapeHtml(status.email || "OneDrive")}</p></div><button type="button" data-close class="ghost-button small-button">Close</button></div><div class="microsoft-picker-toolbar"><nav aria-label="OneDrive folders" data-path></nav><form data-search><input type="search" aria-label="Search OneDrive" placeholder="Search OneDrive" maxlength="160"><button class="ghost-button small-button">Search</button></form></div><div data-status role="status" aria-live="polite"></div><div data-items class="microsoft-items"></div><button type="button" data-more class="ghost-button small-button" hidden>Load more</button><div class="microsoft-dialog-footer"><span data-count>0 files selected</span><button type="button" data-add class="primary-button" disabled>Add selected files</button></div>`;
    document.body.append(dialog); dialog.showModal();
    let busy = false, listing = false, generation = 0, pageToken = "", query = "", path = [{ id: "root", name: "OneDrive" }];
    const selected = new Map();
    const items = dialog.querySelector("[data-items]"), notice = dialog.querySelector("[data-status]"), add = dialog.querySelector("[data-add]");
    const more = dialog.querySelector("[data-more]"), nav = dialog.querySelector("[data-path]");
    function close() { if (!busy) dialog.close(); }
    dialog.querySelector("[data-close]").onclick = close;
    dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
    dialog.addEventListener("close", () => { generation++; dialog.remove(); previousFocus?.focus(); });
    function update() { dialog.querySelector("[data-count]").textContent = selected.size + " files selected"; add.disabled = busy || !selected.size; }
    function renderPath() {
      nav.replaceChildren();
      path.forEach((folder, index) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "ghost-button small-button"; button.textContent = folder.name;
        button.onclick = () => { if (busy) return; path = path.slice(0, index + 1); query = ""; dialog.querySelector("input").value = ""; load(); }; nav.append(button);
      });
    }
    function row(item, folder) {
      const label = document.createElement(folder ? "div" : "label"); label.className = "microsoft-item";
      if (folder) {
        const button = document.createElement("button"); button.className = "ghost-button"; button.type = "button"; button.textContent = "Folder: " + item.name;
        button.onclick = () => { if (busy) return; path.push({ id: item.id, name: item.name }); query = ""; dialog.querySelector("input").value = ""; load(); }; label.append(button);
      } else {
        const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = selected.has(item.id);
        checkbox.onchange = () => {
          if (busy) return;
          if (!config.multiSelect) { selected.clear(); items.querySelectorAll('input[type="checkbox"]').forEach(input => { if (input !== checkbox) input.checked = false; }); }
          if (checkbox.checked && selected.size >= 50) { checkbox.checked = false; showToast("Select at most 50 files per import.", "warning"); return; }
          if (checkbox.checked) selected.set(item.id, item); else selected.delete(item.id);
          update();
        };
        const name = document.createElement("span"); name.textContent = item.name;
        const size = document.createElement("small"); size.textContent = formatBytes(item.size || 0);
        label.append(checkbox, name, size);
      }
      items.append(label);
    }
    async function load(append = false) {
      if (busy) return;
      const current = ++generation; listing = true; more.disabled = true; notice.textContent = "Loading OneDrive files..."; renderPath();
      if (!append) { pageToken = ""; items.replaceChildren(); more.hidden = true; }
      try {
        const params = new URLSearchParams({ folderId: path[path.length - 1].id, q: query, pageToken });
        const result = await api("/api/microsoft/drive/list?" + params);
        if (current !== generation || !dialog.open) return;
        result.folders.forEach(item => row(item, true)); result.files.filter(file => allowed(file, config.allowedTypes)).forEach(item => row(item, false));
        pageToken = result.nextPageToken || ""; more.hidden = !pageToken;
        notice.textContent = items.children.length ? "" : "No matching files in this folder.";
      } catch (error) { if (current === generation) notice.textContent = error.message; }
      finally { if (current === generation) { listing = false; more.disabled = false; } }
    }
    dialog.querySelector("[data-search]").onsubmit = event => { event.preventDefault(); if (!busy) { query = dialog.querySelector("input").value.trim(); load(); } };
    more.onclick = () => { if (!listing) load(true); };
    add.onclick = async () => {
      if (busy || !selected.size) return;
      busy = true; update(); dialog.setAttribute("aria-busy", "true");
      dialog.querySelectorAll("input,button").forEach(control => { control.disabled = true; });
      try {
        const files = []; let total = 0;
        for (const item of selected.values()) {
          notice.textContent = `Loading ${files.length + 1} of ${selected.size}: ${item.name}...`;
          const data = await api("/api/microsoft/drive/read-file", { fileId: item.id });
          total += data.sizeBytes;
          if (total > 50 * 1024 * 1024) throw new Error("Select fewer files. The combined import limit is 50 MB.");
          files.push({ name: data.fileName, type: data.mimeType, content: data.contentBase64, size: data.sizeBytes, source: "onedrive", oneDriveFileId: data.oneDriveFileId, driveWebViewLink: data.webViewLink });
        }
        notice.textContent = "Adding files to the workspace...";
        await callback(files); busy = false; dialog.close();
        showToast(`${files.length} file${files.length === 1 ? "" : "s"} added from OneDrive.`, "success");
      } catch (error) { notice.textContent = error.message; }
      finally {
        busy = false; dialog.removeAttribute("aria-busy"); dialog.querySelectorAll("input,button").forEach(control => { control.disabled = false; }); update();
      }
    };
    load();
  }
  document.addEventListener("DOMContentLoaded", () => { setup(); refresh(); });
  return { refresh, run, connect, setup, pick, status: () => status, emailStatus, provider, select, grantLargeMail };
})();
