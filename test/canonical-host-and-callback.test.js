"use strict";
// 1. www.<dominio> y <dominio> eran dos sitios con sesiones separadas. Microsoft y Google vuelven
//    siempre al dominio configurado, y quien entraba por www volvia sin sesion: la ventana de
//    Microsoft mostraba "Sign in to RAG Tax AI..." y se cerraba sola. Ahora www va al dominio.
// 2. La ventana de Microsoft que falla queda abierta con el motivo; la que sale bien se cierra.
// 3. Deliverable sin adjuntos: el prompt le dice al modelo que no hay nada adjunto.
// Se prueban las funciones reales de server.js, tomadas del archivo.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8").replace(/\r\n/g, "\n");
const grabFn = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name}`);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
};
const grabConst = (name) => {
  const start = src.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`no encontre ${name}`);
  return src.slice(start, src.indexOf(";\n", start) + 1);
};

function redirector(env, googleRedirect) {
  // eslint-disable-next-line no-new-func
  return new Function("process", "GOOGLE_REDIRECT_URI", `${grabConst("CANONICAL_ORIGINS")}\n${grabFn("canonicalHostRedirect")}\nreturn canonicalHostRedirect;`)(
    { env }, googleRedirect,
  );
}

test("www va al dominio de las direcciones de retorno, con la misma ruta", () => {
  const go = redirector({ MICROSOFT_REDIRECT_URI: "https://example-tax.com/auth/microsoft/callback" }, "https://example-tax.com/auth/google/callback");
  assert.strictEqual(go({ headers: { host: "www.example-tax.com" }, url: "/" }), "https://example-tax.com/");
  assert.strictEqual(go({ headers: { host: "WWW.example-tax.com" }, url: "/login?next=%2Fapp" }), "https://example-tax.com/login?next=%2Fapp");
  assert.strictEqual(go({ headers: { host: "www.example-tax.com" }, url: "/auth/microsoft?purpose=drive" }), "https://example-tax.com/auth/microsoft?purpose=drive");
});

test("no toca el dominio bueno, otros hosts, localhost ni /.well-known/", () => {
  const go = redirector({ MICROSOFT_REDIRECT_URI: "https://example-tax.com/auth/microsoft/callback" }, "https://example-tax.com/auth/google/callback");
  assert.strictEqual(go({ headers: { host: "example-tax.com" }, url: "/" }), "");
  assert.strictEqual(go({ headers: { host: "www.other-site.com" }, url: "/" }), "");
  assert.strictEqual(go({ headers: { host: "127.0.0.1:8080" }, url: "/" }), "");
  assert.strictEqual(go({ headers: { host: "www.example-tax.com" }, url: "/.well-known/microsoft-identity-association.json" }), "");
  assert.strictEqual(go({ headers: {}, url: "/" }), "");
});

test("en desarrollo (retorno http a localhost) no redirige nada", () => {
  const go = redirector({}, "http://127.0.0.1:8080/auth/google/callback");
  assert.strictEqual(go({ headers: { host: "www.127.0.0.1:8080" }, url: "/" }), "");
});

test("la ventana de Microsoft que falla queda abierta con el motivo; la que sale bien se cierra", () => {
  const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  // eslint-disable-next-line no-new-func
  const page = new Function("escapeHtml", `${grabFn("microsoftCallbackHtml")}\nreturn microsoftCallbackHtml;`)(escapeHtml);
  const failed = page(false, "Microsoft access was cancelled. Microsoft said: AADSTS65004: User declined <consent>.");
  assert.doesNotMatch(failed, /window\.close\(\);?\s*},\s*200/, "no se cierra sola");
  assert.match(failed, /Microsoft connection failed/);
  assert.match(failed, /AADSTS65004: User declined &lt;consent&gt;\./, "el motivo se ve y va escapado");
  assert.match(failed, /onclick="window\.close\(\)"/, "tiene boton para cerrarla");
  assert.match(failed, /microsoft_oauth_error/, "igual avisa a la app si puede");
  const ok = page(true, "Microsoft connected.");
  assert.match(ok, /setTimeout\(function\(\)\{window\.close\(\);\},200\)/, "la exitosa se cierra como antes");
});

test("Deliverable sin adjuntos: el modelo sabe que no hay nada adjunto", () => {
  // eslint-disable-next-line no-new-func
  const prompt = new Function(`${grabFn("buildDeliverableDraftPrompt")}\nreturn buildDeliverableDraftPrompt;`)();
  const without = prompt({ client: { name: "Sample Client", email: "client@example.com" }, attachments: [] });
  assert.match(without, /Attachments:\nNone\. This email goes without attachments: do not say anything is attached or enclosed\./);
  const withFiles = prompt({ client: { name: "Sample Client" }, attachments: [{ name: "2025 Form 1040.pdf", type: "Tax Return" }] });
  assert.match(withFiles, /"name": "2025 Form 1040\.pdf"/);
  assert.doesNotMatch(withFiles, /None\. This email goes without attachments/);
});
