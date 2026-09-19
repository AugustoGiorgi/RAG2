"use strict";

/**
 * package-docs.js — que hay en el paquete, documento por documento.
 *
 * Los cruces de soporte preguntan siempre lo mismo: ¿hay un 1099-R?, ¿de que año es este K-1?,
 * ¿a nombre de quien esta este 1098?, ¿se pudo abrir este archivo? Aca se responde una vez por
 * documento a partir del titulo impreso por el emisor, que es lo unico que todos los formatos
 * comparten: cada corredor arma su 1099 como quiere, pero todos escriben "1099-DIV" y
 * "Dividends and Distributions".
 *
 * Un ZIP llega como un archivo con secciones "--- ZIP ENTRY: nombre ---"; cada seccion es un
 * documento. Un archivo que el navegador no pudo leer llega sin texto ("metadata-only") o, dentro
 * de un ZIP, con "Unable to parse this entry: <motivo>".
 */

const textOf = (f) => String((f && (f.originalText || f.fullText || f.text || f.extractedText)) || "");
const roleOf = (f) => String((f && (f.reviewRole || f.role)) || "").toLowerCase();

/**
 * Cada tipo exige el numero del formulario Y una frase de su cuerpo. El numero solo no alcanza:
 * un consolidado de corretaje dice "Forms 1099-R, 1099-Q, 5498, Schedule K-1 ... are sent
 * individually", y eso no lo convierte en un 1099-R.
 */
const DOC_TYPES = [
  ["w2", /\bW-2\b(?!G)/i, /Wages, tips, other comp/i],
  ["w2g", /\bW-2G\b/i, /Gross winnings|Certain Gambling Winnings/i],
  ["1099-int", /\b1099-INT\b/i, /Interest income/i],
  ["1099-oid", /\b1099-OID\b/i, /Original issue discount/i],
  ["1099-div", /\b1099-DIV\b/i, /ordinary dividends/i],
  ["1099-b", /\b1099-B\b/i, /\bProceeds\b/i],
  ["1099-da", /\b1099-DA\b/i, /digital asset/i],
  ["1099-r", /\b1099-R\b/i, /Gross distribution/i],
  ["ssa-1099", /\bSSA-1099\b/i, /Benefits (?:paid|for \d{4})|Net benefits/i],
  ["1099-nec", /\b1099-NEC\b/i, /Nonemployee compensation/i],
  ["1099-misc", /\b1099-MISC\b/i, /\bRents\b|\bRoyalties\b|Other income/i],
  ["1099-k", /\b1099-K\b/i, /Payment card|third party network|Gross amount of payment/i],
  ["1099-g", /\b1099-G\b/i, /Unemployment compensation|State or local income tax refunds/i],
  ["1099-s", /\b1099-S\b/i, /Gross proceeds/i],
  ["1099-sa", /\b1099-SA\b/i, /Gross distribution/i],
  ["5498-sa", /\b5498-SA\b/i, /contributions/i],
  ["5498", /\b5498\b(?!-)/i, /IRA contributions|Contribution Information|Rollover contributions/i],
  ["1098-t", /\b1098-T\b/i, /qualified tuition|Tuition Statement/i],
  ["1098-e", /\b1098-E\b/i, /Student loan interest/i],
  ["1098", /\b1098\b(?!-)/i, /Mortgage interest received|Mortgage Interest Statement/i],
  ["1095-a", /\b1095-A\b/i, /Health Insurance Marketplace|Marketplace/i],
  ["k1", /Schedule K-1\b/i, /(?:Partner|Shareholder|Beneficiary)[’']?s Share of|Final K-1\s+Amended K-1/i],
  ["settlement", /settlement statement|closing disclosure|closing statement|\bHUD-1\b/i, /\bSeller\b|\bBorrower\b|\bBuyer\b/i],
  ["irs-notice", /\bNotice\s+CP\s?\d{2,4}[A-Z]?\b|\bCP\s?(?:2000|14|501|503|504|2501)\b/i, /Internal Revenue Service/i],
];

/** Lo que un documento dice ser. Se mira el nombre y el comienzo del texto. */
function docTypes(name, text) {
  const body = String(text || "");
  const head = `${name}\n${body.slice(0, 8000)}`;
  if (/^\s*--- Sheet:/.test(body)) return ["workbook"];
  if (/U\.\s?S\.\s+(?:Individual Income Tax Return|Return of Partnership Income|Income Tax Return for an S Corporation|Corporation Income Tax Return)/i.test(head) && /Your first name|Name of partnership|Name\s*\n|Employer identification number/i.test(head)) return ["return"];
  return DOC_TYPES.filter(([, number, phrase]) => number.test(head) && phrase.test(head)).map(([t]) => t);
}

/** El año fiscal que imprime el documento, o null si no es claro. */
function docYear(text) {
  // Sin las revisiones del formulario ("Rev. 1-2022", "Rev. December 2024"): no son el año fiscal.
  const head = String(text || "").slice(0, 4000).replace(/\(?Rev\.\s*(?:[A-Za-z]+\.?\s*|\d{1,2}-)?(?:20\d{2})\)?/gi, " ");
  const found = [];
  const push = (y) => { const n = Number(y); if (n >= 2015 && n <= 2035) found.push(n); };
  for (const m of head.matchAll(/\bFor calendar year\s+(20\d{2})\b/gi)) push(m[1]);
  for (const m of head.matchAll(/\bYEAR:\s*(20\d{2})\b/gi)) push(m[1]);
  for (const m of head.matchAll(/(?<![/\d-])\b(20\d{2})\s+(?:Form\s+)?(?:W-2|1099-?[A-Z]*|1098(?:-[A-Z])?|1095-A|5498(?:-SA)?|SSA-1099|Schedule K-1)\b/gi)) push(m[1]);
  for (const m of head.matchAll(/\b(?:W-2|1099-[A-Z]{1,3}|1098(?:-[A-Z])?|1095-A|5498(?:-SA)?)\b[^\n]{0,30}?(?<![/\d-])\b(20\d{2})\b(?![/\d-])/gi)) push(m[1]);
  for (const m of head.matchAll(/\b(?:tax|calendar)\s+year\s+(20\d{2})\b/gi)) push(m[1]);
  for (const m of head.matchAll(/Schedule K-1[^\n]{0,20}\n?\s*(20\d{2})\s*\n/gi)) push(m[1]);
  if (!found.length) return null;
  const counts = {};
  for (const y of found) counts[y] = (counts[y] || 0) + 1;
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  // Dos años distintos con el mismo peso: no se decide.
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return Number(ranked[0][0]);
}

/** Cada documento del paquete, con su tipo, su año y si se pudo leer. */
function packageDocuments(files, { exclude = new Set() } = {}) {
  const out = [];
  for (const f of Array.isArray(files) ? files : []) {
    if (!f || exclude.has(f)) continue;
    const name = String(f.name || "");
    const text = textOf(f);
    const media = String(f.mediaType || f.mimeType || "").toLowerCase();
    if (!text.trim()) {
      const unreadable = String(f.encoding || "") === "metadata-only" && /pdf|sheet|excel|word/.test(`${media} ${name.toLowerCase()}`);
      if (unreadable) out.push({ name, text: "", file: f, types: [], year: null, unreadable: "the file could not be opened (password-protected or damaged)" });
      continue;
    }
    if (/(^|\n)--- ZIP ENTRY: /.test(text)) {
      for (const part of text.split(/\n(?=--- ZIP ENTRY: )/)) {
        const m = /^--- ZIP ENTRY: (.+?) ---/.exec(part);
        if (!m) continue;
        const body = part.slice(m[0].length).trim();
        const entryName = m[1].split("/").pop();
        const bad = /^Unable to parse this entry:\s*(.*)$/i.exec(body);
        if (bad) {
          const why = /password/i.test(bad[1]) ? "password-protected" : bad[1].slice(0, 80);
          out.push({ name: entryName, text: "", file: f, zip: name, types: docTypes(entryName, ""), year: null, unreadable: why });
          continue;
        }
        out.push({ name: entryName, text: body, file: f, zip: name, types: docTypes(entryName, body), year: docYear(body) });
      }
      continue;
    }
    out.push({ name, text, file: f, role: roleOf(f), types: docTypes(name, text), year: docYear(text) });
  }
  return out;
}

const has = (docs, type) => docs.filter((d) => d.types.includes(type));

module.exports = { packageDocuments, docTypes, docYear, has, DOC_TYPES, roleOf, textOf };
