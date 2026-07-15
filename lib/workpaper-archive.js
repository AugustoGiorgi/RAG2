"use strict";

/**
 * workpaper-archive.js — season roll-forward.
 *
 * Every generated workpaper is archived under the client's folder
 * (CLIENT_FILES_DIR/<clientId>/workpaper-TY<year>-<stamp>.xlsx). Next season, one click
 * attaches the newest prior-year archive as the prior_workpaper for the new run — no
 * re-upload, and the existing prior-workpaper pipeline (structure mirroring + amount
 * stripping) applies unchanged because the file re-enters through the same door.
 */

const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

const FILE_RE = /^workpaper-TY(\d{4})-(\d{8}T\d{6})\.xlsx$/;
const KEEP_PER_CLIENT = 8;

function clientDir(baseDir, clientId) {
  const safe = String(clientId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return null;
  return path.join(baseDir, safe);
}

function saveWorkpaperToArchive(baseDir, clientId, taxYear, buffer) {
  const dir = clientDir(baseDir, clientId);
  const year = String(taxYear || "").match(/\d{4}/)?.[0];
  if (!dir || !year || !buffer?.length) return null;
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15); // YYYYMMDDTHHMMSS
  const file = `workpaper-TY${year}-${stamp}.xlsx`;
  fs.writeFileSync(path.join(dir, file), buffer);
  // Rotation: keep the newest KEEP_PER_CLIENT archives per client.
  const all = listArchive(baseDir, clientId);
  for (const old of all.slice(KEEP_PER_CLIENT)) {
    try { fs.unlinkSync(path.join(dir, old.file)); } catch (_) {}
  }
  return { file, taxYear: year };
}

function listArchive(baseDir, clientId) {
  const dir = clientDir(baseDir, clientId);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map((file) => { const m = FILE_RE.exec(file); return m ? { file, taxYear: m[1], stamp: m[2] } : null; })
    .filter(Boolean)
    .sort((a, b) => (b.taxYear + b.stamp).localeCompare(a.taxYear + a.stamp))
    .map(({ file, taxYear, stamp }) => ({ file, taxYear, savedAt: stamp }));
}

// Newest archive from a season BEFORE the one being prepared.
function loadNewestPriorWorkpaper(baseDir, clientId, currentTaxYear) {
  const year = Number(String(currentTaxYear || "").match(/\d{4}/)?.[0] || 0);
  if (!year) return null;
  const prior = listArchive(baseDir, clientId).find((e) => Number(e.taxYear) < year);
  if (!prior) return null;
  const dir = clientDir(baseDir, clientId);
  return { ...prior, buffer: fs.readFileSync(path.join(dir, prior.file)) };
}

// Rebuild the { sourceFileName, sheets:[{name, rows}] } template shape (normally produced
// client-side at upload) from an archived xlsx, so the prior-workpaper pipeline — mirror
// the structure, STRIP every amount — applies to archived files identically.
async function xlsxBufferToTemplate(buffer, sourceFileName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= 250) return;
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (cells.length >= 80) return;
        let v = cell.value;
        if (v && typeof v === "object") v = v.result !== undefined ? v.result : (v.richText ? v.richText.map((t) => t.text).join("") : "");
        cells.push(v == null ? "" : String(v));
      });
      rows.push(cells);
    });
    if (rows.length) sheets.push({ name: ws.name, rows, merges: [], cols: [], styles: [] });
  });
  return { sourceFileName: String(sourceFileName || "archived-workpaper.xlsx"), sheets };
}

// Flat text extraction (pipe-delimited, same convention as the client-side extractor).
function templateToText(template) {
  return (template.sheets || [])
    .map((s) => `--- Sheet: ${s.name} ---\n${s.rows.map((r) => r.join(" | ")).join("\n")}`)
    .join("\n\n");
}

module.exports = { saveWorkpaperToArchive, listArchive, loadNewestPriorWorkpaper, xlsxBufferToTemplate, templateToText };
