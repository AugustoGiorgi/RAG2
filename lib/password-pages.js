"use strict";

function page(title, description, fields, endpoint, successText, successHref, successLabel, extras = "") {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${title} - RAG Tax AI</title>
<style>
  :root { font-family: Inter, Arial, sans-serif; color: #172033; background: #f4f7fb; }
  * { box-sizing: border-box; } body { margin: 0; min-height: 100vh; }
  header { background: #10284a; color: white; padding: 18px max(24px, calc((100vw - 1040px)/2)); }
  header a { display: inline-flex; align-items: center; gap: 12px; color: inherit; text-decoration: none; font-weight: 800; font-size: 18px; }
  header img { width: 34px; height: 34px; object-fit: contain; }
  main { max-width: 440px; margin: 64px auto; padding: 0 22px; }
  h1 { font-size: 28px; margin: 0 0 10px; } p { line-height: 1.5; color: #536176; margin: 0 0 24px; }
  label { display: block; font-weight: 700; font-size: 13px; margin: 18px 0 6px; }
  input { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #b8c6d6; border-radius: 6px; font: inherit; background: white; }
  input:focus { outline: 2px solid #4e8edf; outline-offset: 1px; }
  button { width: 100%; min-height: 44px; margin-top: 22px; border: 0; border-radius: 6px; background: #173e73; color: white; font: inherit; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .6; cursor: wait; }
  .message { padding: 11px 13px; margin: 16px 0; border-radius: 6px; background: #e9f3ed; color: #175b38; }
  .message.error { background: #fff0ee; color: #a12d20; }
  .back { display: inline-block; margin-top: 22px; color: #174b88; font-weight: 700; }
  @media (max-width: 540px) { main { margin-top: 38px; } }
</style></head><body>
<header><a href="/"><img src="/assets/rag-r-logo.png" alt="">RAG Tax AI</a></header>
<main><h1>${title}</h1><p>${description}</p><div id="message" class="message" role="status" hidden></div>
<form id="form">${fields}<button type="submit" id="submit">Continue</button></form>
<a class="back" href="${successHref}">${successLabel}</a></main>
<script>
  const form = document.getElementById("form");
  const message = document.getElementById("message");
  const submit = document.getElementById("submit");
  function show(text, error) { message.textContent = text; message.classList.toggle("error", Boolean(error)); message.hidden = false; }
  ${extras}
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (data.confirmPassword !== undefined && data.newPassword !== data.confirmPassword) { show("Passwords do not match.", true); return; }
    delete data.confirmPassword;
    if (typeof resetToken !== "undefined") Object.assign(data, resetToken);
    submit.disabled = true;
    try {
      const response = await fetch("${endpoint}", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { show(result.error || "Could not complete the request.", true); return; }
      show(result.message || "${successText}", false);
      form.hidden = true;
      ${endpoint === "/api/auth/change-password" ? 'window.location.href = "/";' : ""}
    } catch (_) { show("Connection failed. Please try again.", true); }
    finally { submit.disabled = false; }
  });
</script></body></html>`;
}

function passwordFields(includeCurrent) {
  return `${includeCurrent ? '<label for="currentPassword">Current password</label><input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required>' : ""}
<label for="newPassword">New password (at least 12 characters)</label><input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="256" required>
<label for="confirmPassword">Confirm new password</label><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="12" maxlength="256" required>`;
}

function buildForgotPasswordPage() {
  return page("Recover your password", "Enter the email registered with your account. If your account does not have one yet, ask your administrator to add it.",
    '<label for="email">Account email</label><input id="email" name="email" type="email" autocomplete="email" required>',
    "/api/auth/forgot-password", "Check your inbox if this email belongs to an account.", "/login", "Back to sign in");
}

function buildResetPasswordPage() {
  return page("Choose a new password", "Your recovery link can be used once and expires after 15 minutes.", passwordFields(false),
    "/api/auth/reset-password", "Password changed. Sign in with your new password.", "/login", "Back to sign in",
    `const params = new URLSearchParams(window.location.hash.slice(1));
     const resetToken = { username: params.get("username") || "", token: params.get("token") || "" };
     history.replaceState(null, "", "/reset-password");
     if (!resetToken.username || !resetToken.token) { form.hidden = true; show("This recovery link is invalid or expired. Request a new one.", true); }`);
}

function buildPasswordFormPage({ temporary = false } = {}) {
  return page(temporary ? "Change your temporary password" : "Change password",
    temporary ? "Set a private password before using your account. Your administrator will not know the new one." : "Enter your current password to set a new one.",
    passwordFields(true), "/api/auth/change-password", "Password changed.", temporary ? "/login" : "/", temporary ? "Sign out" : "Back to app",
    temporary ? `document.querySelector(".back").addEventListener("click", async (event) => {
      event.preventDefault();
      await fetch("/api/logout", { method: "POST" }).catch(() => {});
      window.location.href = "/login";
    });` : "");
}

module.exports = { buildForgotPasswordPage, buildResetPasswordPage, buildPasswordFormPage };
