"use strict";

const EYE_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 0 0 4.24 4.24"/><path d="M10.73 5.08A10.98 10.98 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/></svg>`;

function passwordInput(id, label, autocomplete) {
  return `<div class="field"><label for="${id}">${label}</label><div class="password-wrap">
    <input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" maxlength="256" required>
    <button class="visibility" type="button" data-for="${id}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false" title="Show password"><span class="eye">${EYE_ICON}</span><span class="eye-off">${EYE_OFF_ICON}</span></button>
  </div></div>`;
}

function passwordFields(includeCurrent) {
  return `${includeCurrent ? passwordInput("currentPassword", "Current password", "current-password") : ""}
    ${passwordInput("newPassword", "New password", "new-password")}
    <p class="password-hint" id="lengthHint">Use at least 15 characters. A memorable phrase is fine; symbols are optional.</p>
    ${passwordInput("confirmPassword", "Confirm new password", "new-password")}`;
}

function page({ title, description, fields, endpoint, successText, successHref, successLabel, extras = "", temporary = false }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${title} - RAG Tax AI</title>
<style>
  :root { color-scheme: light; font-family: Inter, Arial, sans-serif; color: #0f172a; background: #f8fafc; }
  * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; }
  .auth-page { min-height: 100vh; display: grid; grid-template-columns: 45% 55%; }
  .brand { background: linear-gradient(135deg, #0f1e3d, #1b3a6b 55%, #2563eb); color: white; padding: 48px 52px; display: flex; flex-direction: column; justify-content: space-between; }
  .brand img { width: 68px; height: 68px; object-fit: contain; display: block; margin-bottom: 18px; }
  .brand h2 { font-size: 42px; line-height: 1.08; margin: 0; font-weight: 850; }
  .brand p { color: rgba(255,255,255,.76); margin: 12px 0 0; line-height: 1.5; }
  .features { display: grid; gap: 14px; color: rgba(255,255,255,.84); font-size: 14px; }
  .feature { display: flex; align-items: center; gap: 14px; }
  .feature b { width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; background: rgba(255,255,255,.12); font-size: 12px; }
  .brand small { color: rgba(255,255,255,.48); }
  .form-panel { display: grid; place-items: center; padding: 40px 24px; }
  .form-content { width: min(400px, 100%); }
  .eyebrow { color: #2f5f9b; font-size: 11px; font-weight: 800; letter-spacing: 0; text-transform: uppercase; margin: 0 0 12px; }
  h1 { color: #0f1e3d; font-size: 28px; line-height: 1.2; margin: 0 0 7px; }
  .description { color: #64748b; font-size: 14px; line-height: 1.55; margin: 0 0 28px; }
  .field { margin-bottom: 17px; }
  label { display: block; margin-bottom: 6px; color: #374151; font-size: 13px; font-weight: 750; }
  input { width: 100%; min-height: 44px; border: 1px solid #d1d5db; border-radius: 8px; padding: 11px 14px; font: inherit; color: #111827; background: #fff; }
  input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.1); }
  .password-wrap { position: relative; }
  .password-wrap input { padding-right: 48px; }
  .visibility { position: absolute; right: 3px; top: 3px; width: 38px; height: 38px; display: grid; place-items: center; border: 0; border-radius: 6px; background: transparent; color: #64748b; cursor: pointer; }
  .visibility:hover, .visibility:focus-visible { color: #1b3a6b; background: #eef3fa; }
  .eye-off, .visibility[aria-pressed="true"] .eye { display: none; }
  .visibility[aria-pressed="true"] .eye-off { display: block; }
  .password-hint { margin: -8px 0 17px; color: #64748b; font-size: 12px; line-height: 1.45; }
  .password-hint.good { color: #167348; }
  .message { border: 1px solid #c5d9ca; border-radius: 8px; background: #e9f3ed; color: #175b38; padding: 11px 12px; margin-bottom: 18px; font-size: 13px; line-height: 1.4; }
  .message.error { border-color: #fca5a5; background: #fef2f2; color: #b91c1c; }
  .message.pending { border-color: #b8cdea; background: #edf4ff; color: #1b3a6b; }
  .submit { width: 100%; min-height: 44px; border: 0; border-radius: 8px; background: linear-gradient(135deg, #1b3a6b, #2563eb); color: #fff; font: inherit; font-size: 15px; font-weight: 800; cursor: pointer; }
  .submit:hover { opacity: .93; } .submit:disabled { opacity: .65; cursor: wait; }
  .back { display: block; text-align: center; margin-top: 18px; color: #1d4ed8; font-size: 13px; font-weight: 800; }
  @media (max-width: 820px) { .auth-page { display: block; } .brand { min-height: auto; padding: 28px 24px; } .brand img { width: 48px; height: 48px; margin-bottom: 10px; } .brand h2 { font-size: 30px; } .features, .brand small { display: none; } .form-panel { padding: 34px 20px 60px; } }
</style></head><body>
<div class="auth-page">
  <aside class="brand"><div><img src="/assets/rag-r-logo.png" alt="RAG Tax AI logo"><h2>RAG Tax AI</h2><p>Built for CPA firms. Powered by AI.</p></div>
    <div class="features"><div class="feature"><b>AI</b><span>AI-powered tax return review</span></div><div class="feature"><b>WP</b><span>Automated workpaper preparation</span></div><div class="feature"><b>GD</b><span>Google Drive and Gmail workflows</span></div></div>
    <small>&copy; 2026 RAG Tax AI &middot; Certifai CPA</small></aside>
  <main class="form-panel"><div class="form-content"><p class="eyebrow">Account security</p><h1>${title}</h1><p class="description">${description}</p>
    <div id="message" class="message" role="status" aria-live="polite" hidden></div>
    <form id="form" novalidate>${fields}<button class="submit" type="submit" id="submit">${temporary ? "Change password" : "Continue"}</button></form>
    <a class="back" href="${successHref}">${successLabel}</a></div></main>
</div>
<script>
  const form = document.getElementById("form");
  const message = document.getElementById("message");
  const submit = document.getElementById("submit");
  const initialButtonText = submit.textContent;
  function show(text, kind = "") {
    message.textContent = text;
    message.className = "message" + (kind ? " " + kind : "");
    message.setAttribute("role", kind === "error" ? "alert" : "status");
    message.hidden = false;
  }
  for (const button of document.querySelectorAll(".visibility")) {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.for);
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute("aria-label", (visible ? "Hide " : "Show ") + input.name.replace(/([A-Z])/g, " $1").toLowerCase());
      button.title = visible ? "Hide password" : "Show password";
    });
  }
  const newPasswordInput = document.getElementById("newPassword");
  form.addEventListener("input", () => { if (message.classList.contains("error")) message.hidden = true; });
  newPasswordInput?.addEventListener("input", () => {
    const hint = document.getElementById("lengthHint");
    const length = Array.from(newPasswordInput.value).length;
    hint.classList.toggle("good", length >= 15 && length <= 256);
    hint.textContent = length >= 15 && length <= 256
      ? "Length looks good. Avoid common words or personal details."
      : "Use at least 15 characters. A memorable phrase is fine; symbols are optional.";
  });
  ${extras}
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (data.email !== undefined && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(data.email)) { show("Enter a valid email address.", "error"); return; }
    if (data.currentPassword !== undefined && !data.currentPassword) { show("Enter your current or temporary password.", "error"); return; }
    if (data.newPassword !== undefined) {
      const length = Array.from(data.newPassword).length;
      if (length < 15 || length > 256) { show("Use 15 to 256 characters for your new password.", "error"); return; }
      if (data.currentPassword !== undefined && data.newPassword === data.currentPassword) { show("Choose a password different from the current one.", "error"); return; }
      if (data.newPassword !== data.confirmPassword) { show("The new passwords do not match.", "error"); return; }
    }
    delete data.confirmPassword;
    if (typeof resetToken !== "undefined") Object.assign(data, resetToken);
    submit.disabled = true;
    submit.textContent = "${endpoint === "/api/auth/change-password" ? "Updating password..." : endpoint === "/api/auth/reset-password" ? "Saving password..." : "Sending link..."}";
    show("${endpoint === "/api/auth/forgot-password" ? "Checking your account..." : "Saving your new password securely..."}", "pending");
    try {
      const response = await fetch("${endpoint}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { show(result.error || "Could not complete the request. Please try again.", "error"); return; }
      show(result.message || "${successText}");
      form.hidden = true;
      ${endpoint === "/api/auth/change-password" ? 'setTimeout(() => { window.location.href = "/"; }, 650);' : ""}
    } catch (_) { show("Connection failed. Please try again.", "error"); }
    finally { submit.disabled = false; submit.textContent = initialButtonText; }
  });
</script></body></html>`;
}

function buildForgotPasswordPage() {
  return page({ title: "Recover your password", description: "Enter the email registered with your account. If your account does not have one yet, ask your administrator to add it.",
    fields: '<div class="field"><label for="email">Account email</label><input id="email" name="email" type="email" autocomplete="email" required></div>',
    endpoint: "/api/auth/forgot-password", successText: "Check your inbox if this email belongs to an account.", successHref: "/login", successLabel: "Back to sign in" });
}

function buildResetPasswordPage() {
  return page({ title: "Choose a new password", description: "Your recovery link can be used once and expires after 15 minutes.", fields: passwordFields(false),
    endpoint: "/api/auth/reset-password", successText: "Password changed. Sign in with your new password.", successHref: "/login", successLabel: "Back to sign in",
    extras: `const params = new URLSearchParams(window.location.hash.slice(1));
      const resetToken = { username: params.get("username") || "", token: params.get("token") || "" };
      history.replaceState(null, "", "/reset-password");
      if (!resetToken.username || !resetToken.token) { form.hidden = true; show("This recovery link is invalid or expired. Request a new one.", "error"); }` });
}

function buildPasswordFormPage({ temporary = false } = {}) {
  return page({ title: temporary ? "Change your temporary password" : "Change password",
    description: temporary ? "Set a private password before using your account. Your administrator will not know the new one." : "Enter your current password to set a new one.",
    fields: passwordFields(true), endpoint: "/api/auth/change-password", successText: "Password changed. Opening your account...",
    successHref: temporary ? "/login" : "/", successLabel: temporary ? "Sign out" : "Back to app", temporary,
    extras: temporary ? `document.querySelector(".back").addEventListener("click", async (event) => {
      event.preventDefault();
      await fetch("/api/logout", { method: "POST" }).catch(() => {});
      window.location.href = "/login";
    });` : "" });
}

module.exports = { buildForgotPasswordPage, buildResetPasswordPage, buildPasswordFormPage };
