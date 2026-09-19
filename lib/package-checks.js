"use strict";

/**
 * package-checks.js — que el paquete sea el que se cree que es.
 *
 * Antes de cruzar una cifra hay que saber que se esta mirando: que la declaracion es del tipo que
 * se eligio en la pantalla, que cada archivo se pudo abrir, que los documentos son del año que se
 * revisa, que no hay dos versiones del mismo K-1 sin saber cual se uso, y que la carta que va al
 * cliente dice el mismo saldo que la declaracion. Un error aca invalida todo lo que sigue sin que
 * ningun otro cruce lo note.
 */

const { splitReturns } = require("./prior-year-bridge");
const { detectReturnTypeFromFiles } = require("./tie-out");
const rf = require("./return-facts");
const pd = require("./package-docs");
const ef = require("./entity-facts");

const fmt = (n) => `$${Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US")}`;

function normalizeType(value) {
  const v = String(value || "").toUpperCase().replace(/\s+/g, "");
  if (!v) return "";
  if (/1120-?S/.test(v)) return "1120-S";
  const m = v.match(/1040|1041|1065|1120|990/);
  return m ? m[0] : "";
}

/* 1. El tipo elegido en la pantalla contra el que dice la declaracion. */
function checkReturnTypeMatches(files, meta = {}) {
  const chosen = normalizeType(meta.returnType);
  if (!chosen) return [];
  const detected = normalizeType(detectReturnTypeFromFiles((files || []).map((f) => ({ ...f, reviewRole: f.reviewRole || f.role }))));
  if (!detected || detected === chosen) return [];
  return [{
    severity: "HIGH",
    category: "Package integrity",
    title: `Return type — reviewed as ${chosen}, the return is a Form ${detected}`,
    detail: `The review was run with the return type set to ${chosen}, but the return in the package is a Form ${detected}. The mandatory checklist, the form-specific rules and every type-specific check followed ${chosen}.`,
    action: `Set the return type to ${detected} in Review → Client and return details and run the review again.`,
    authority: "Package integrity — precondition for every form-specific check",
    evidence: "Return type selected on the review screen; title of the current-year return.",
  }];
}

/* 2. Archivos que nadie pudo leer. */
// El nombre de un archivo protegido suele traer la clave ("099000000 to open"), que muchas veces es
// un SSN completo: nueve digitos seguidos se tapan menos los ultimos cuatro.
const safeName = (name) => String(name || "").replace(/(?<!\d)\d{9}(?!\d)/g, (m) => `XXXXX${m.slice(-4)}`);

function checkUnreadableFiles(files, meta = {}) {
  const bad = pd.packageDocuments(files).filter((d) => d.unreadable).map((d) => ({ ...d, name: safeName(d.name), zip: d.zip && safeName(d.zip) }));
  if (!bad.length) return [];
  const important = bad.some((d) => /k-?1|w-?2|1099|1098|1095|return|k1/i.test(d.name));
  return [{
    severity: important ? "HIGH" : "MEDIUM",
    category: "Package integrity",
    title: `${bad.length} file${bad.length > 1 ? "s" : ""} in the package could not be read`,
    detail: `${bad.map((d) => `${d.name} (${d.unreadable})`).join("; ")}. Nothing in ${bad.length > 1 ? "these files" : "this file"} was reviewed — any income, withholding or basis ${bad.length > 1 ? "they carry is" : "it carries is"} unverified.`,
    action: "Get unprotected copies (or the password) and run the review again, or check the files by hand before filing.",
    authority: "Package integrity",
    evidence: `Files: ${bad.map((d) => d.zip ? `${d.name} (inside ${d.zip})` : d.name).join("; ")}.`,
  }];
}

/* 3. Documentos de otro año fiscal. */
const YEARLY = /^(w2|w2g|1099-|ssa-1099|1098|1095-a|5498|k1)/;

function checkOtherYearDocuments(files, meta = {}) {
  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  if (!Number.isFinite(taxYear) || taxYear < 2000) return [];
  const { current, prior } = splitReturns(files, meta);
  const docs = pd.packageDocuments(files, { exclude: new Set([current, prior].filter(Boolean)) });
  const other = docs.filter((d) => d.year && d.year !== taxYear && d.types.some((t) => YEARLY.test(t)));
  if (!other.length) return [];
  return [{
    severity: "MEDIUM",
    category: "Package integrity",
    title: "Documents from another tax year in the package",
    detail: `${other.map((d) => `${d.name} (${d.types.join(", ").toUpperCase()} for ${d.year})`).join("; ")}. This review is for ${taxYear}.`,
    action: "Confirm none of their figures went into this year's return, and ask for the current-year version if it is missing.",
    authority: "Package integrity",
    evidence: `Year printed on each document: ${other.map((d) => d.name).join("; ")}.`,
  }];
}

/* 4. Dos versiones del mismo documento. */
function versionKey(name) {
  return String(name || "").toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, "")
    .replace(/\((?:amended|corrected|revised|\d+)\)/g, " ")
    .replace(/\b(?:amended|corrected|revised|final|v\d+|version\s*\d+)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function checkDocumentVersions(files, meta = {}) {
  const { current, prior } = splitReturns(files, meta);
  const docs = pd.packageDocuments(files, { exclude: new Set([current, prior].filter(Boolean)) })
    .filter((d) => d.text && d.types.some((t) => /^(k1|1099-|w2|1098)/.test(t)));
  const groups = new Map();
  for (const d of docs) {
    const key = versionKey(d.name);
    if (!key) continue;
    const list = groups.get(key) || [];
    if (!list.some((x) => x.text === d.text)) list.push(d);
    groups.set(key, list);
  }
  const versions = [...groups.values()].filter((list) => list.length > 1);
  if (!versions.length) return [];
  return [{
    severity: "LOW",
    category: "Package integrity",
    title: "Two versions of the same document in the package",
    detail: versions.map((list) => `${list.map((d) => d.name).join(" and ")} have different content`).join("; ") + ".",
    action: "Confirm which version the return uses (an amended or corrected form supersedes the original) and that the workpaper points to the same one.",
    authority: "Package integrity",
    evidence: `Documents: ${versions.flat().map((d) => d.name).join("; ")}.`,
  }];
}

/* 5. La carta al cliente contra la declaracion federal. */
function checkLetterMatchesReturn(files, meta = {}) {
  const { current } = splitReturns(files, meta);
  if (!current) return [];
  const text = rf.textOf(current);
  if (!rf.isForm1040(text)) return [];
  const head = text.slice(0, 8000).replace(/\s+/g, " ");
  const para = /Your \d{4} Federal Individual Income Tax [Rr]eturn[^.]*\.(?:[^.]*\.){0,4}/.exec(head);
  if (!para) return [];
  const due = /balance due of \$([\d,]+)/i.exec(para[0]);
  const refund = /refund of \$([\d,]+)/i.exec(para[0]);
  const lines = rf.form1040Lines(text);
  const out = [];
  if (due && lines["37"] !== null) {
    const letter = Number(due[1].replace(/,/g, ""));
    if (Math.abs(letter - lines["37"]) > 1) out.push(`the letter tells the client the federal balance due is ${fmt(letter)}; line 37 of the return is ${fmt(lines["37"])}`);
  }
  if (refund && lines["35a"] !== null) {
    const letter = Number(refund[1].replace(/,/g, ""));
    if (Math.abs(letter - lines["35a"]) > 1) out.push(`the letter tells the client the federal refund is ${fmt(letter)}; line 35a of the return is ${fmt(lines["35a"])}`);
  }
  if (!out.length) return [];
  return [{
    severity: "MEDIUM",
    category: "Client letter",
    title: "Client letter — federal amount differs from the return",
    detail: `In the transmittal letter ${out.join("; ")}.`,
    action: "Regenerate the letter from the final return before it goes to the client.",
    authority: "Firm deliverables",
    evidence: "Transmittal letter on page 1; Form 1040 lines 35a and 37.",
  }];
}

/* 6. Un K-1 del paquete cuyo emisor no aparece en ninguna parte de la declaracion. */
function checkReceivedK1sReflected(files, meta = {}) {
  const { current } = splitReturns(files, meta);
  if (!current) return [];
  const text = rf.textOf(current);
  const taxYear = Number(String(meta.taxYear || "").match(/\d{4}/)?.[0]);
  const received = ef.receivedK1s(files, meta)
    .filter((r) => r.issuerEin && r.k1 && (!r.year || !Number.isFinite(taxYear) || r.year === taxYear));
  if (!received.length) return [];
  const shown = (ein) => text.includes(ein) || new RegExp(`[X*]{2}-?[X*]{3}${ein.slice(-4)}\\b`).test(text);
  const missing = [...new Map(received.filter((r) => !shown(r.issuerEin)).map((r) => [r.issuerEin, r])).values()];
  if (!missing.length) return [];
  // Un 1040 lista cada K-1 con su EIN en el Schedule E; una entidad, solo si ya nombra a los demas.
  const is1040 = rf.isForm1040(text);
  if (!is1040 && missing.length === new Set(received.map((r) => r.issuerEin)).size) return [];
  const header = is1040 ? rf.header1040(text) : null;
  const own = new Set([
    header && header.taxpayer && header.taxpayer.ssn, header && header.spouse && header.spouse.ssn,
    !is1040 ? ef.entityEin(text) : null,
  ].filter(Boolean));
  const ours = missing.filter((r) => !r.k1.tin || own.has(r.k1.tin));
  return [{
    severity: ours.length ? "HIGH" : "MEDIUM",
    category: "K-1s received",
    title: "K-1 in the package from an issuer the return never mentions",
    detail: `${missing.map((r) => `${r.name} (EIN ending ${r.issuerEin.slice(-4)}${r.k1.tin && !own.has(r.k1.tin) ? `, issued to a number ending ${r.k1.tin.slice(-4)}` : ""})`).join("; ")}. The issuer's EIN appears nowhere in the return${is1040 ? ", and Schedule E Part II lists every partnership and S corporation by EIN" : ""}.`,
    action: "If the K-1 belongs to this return, report it (Schedule E Part II for an individual; Schedule K for an entity) and check its basis and at-risk limits; if it belongs to someone else, take it out of the package.",
    authority: "IRC §§702, 1366; Schedule E Part II instructions",
    evidence: `K-1s in the package: ${missing.map((r) => r.name).join("; ")}.`,
  }];
}

function runPackageChecks(files, meta = {}) {
  const out = [];
  for (const check of [checkReturnTypeMatches, checkUnreadableFiles, checkOtherYearDocuments, checkDocumentVersions, checkLetterMatchesReturn, checkReceivedK1sReflected]) {
    try { out.push(...check(files, meta)); } catch (error) { console.warn(`[package] ${check.name}: ${error.message}`); }
  }
  return out;
}

module.exports = {
  runPackageChecks, checkReturnTypeMatches, checkUnreadableFiles, checkOtherYearDocuments,
  checkDocumentVersions, checkLetterMatchesReturn, checkReceivedK1sReflected, versionKey, normalizeType,
};
