const ExcelJS = require("exceljs");
const { keysFor, normalizeEntityType } = require("./canonical");

function readCover(ws) {
  const meta = {};
  ws.eachRow((row) => {
    const key = String(cellValue(row.getCell(1)) || "").trim().toLowerCase();
    const value = cellValue(row.getCell(2));
    if (key.includes("client") || key.includes("cliente")) meta.name = String(value || "").trim();
    if (key.includes("ein") || key.includes("ssn")) meta.ein = String(value || "").trim();
    if (key.includes("entity") || key.includes("tipo")) meta.entityType = normalizeEntityType(value);
    if (key.includes("year") || key.includes("ano") || key.includes("anio")) {
      meta.taxYear = parseInt(String(value || "").replace(/\D/g, ""), 10);
    }
  });
  return meta;
}

function findColumns(headerRow) {
  const cols = {};
  headerRow.eachCell((cell, n) => {
    const name = String(cellValue(cell) || "").trim().toLowerCase();
    if (name === "canonical_key" || name === "canonical key") cols.canonicalKey = n;
    if (name === "tax_amount" || name === "tax amount") cols.value = n;
    if (name === "flag") cols.flag = n;
    if (name.includes("note") || name.includes("nota")) cols.note = n;
  });
  return cols;
}

function cellValue(cell) {
  const raw = cell?.value;
  if (raw && typeof raw === "object") {
    if (raw.result !== undefined) return raw.result;
    if (raw.text !== undefined) return raw.text;
    if (raw.richText) return raw.richText.map((part) => part.text || "").join("");
  }
  return raw;
}

function normalizeFlag(raw) {
  const value = String(raw || "").toLowerCase();
  if (value.includes("error") || value.includes("red") || value.includes("\u{1F534}")) return "error";
  if (value.includes("review") || value.includes("yellow") || value.includes("\u{1F7E1}")) return "review";
  if (value.includes("manual") || value.includes("white") || value.includes("\u26AA")) return "manual";
  return "ok";
}

async function parseApprovedWorkpaper(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const cover = workbook.getWorksheet("Cover") || workbook.worksheets[0];
  const meta = readCover(cover);
  if (!meta.entityType) throw new Error("Could not determine entity type from Cover tab.");
  const validKeys = keysFor(meta.entityType);
  const fields = [];

  for (const worksheet of workbook.worksheets) {
    if (worksheet.name.toLowerCase() === "cover") continue;
    let headerRowNum = null;
    let cols = null;
    for (let r = 1; r <= Math.min(5, worksheet.rowCount); r += 1) {
      const candidate = findColumns(worksheet.getRow(r));
      if (candidate.canonicalKey) {
        headerRowNum = r;
        cols = candidate;
        break;
      }
    }
    if (!headerRowNum) continue;
    for (let r = headerRowNum + 1; r <= worksheet.rowCount; r += 1) {
      const row = worksheet.getRow(r);
      const key = String(cellValue(row.getCell(cols.canonicalKey)) || "").trim();
      if (!key) continue;
      if (!validKeys[key]) {
        console.warn(`[tax-loader] unknown canonical key "${key}" in "${worksheet.name}" - ignored`);
        continue;
      }
      fields.push({
        canonicalKey: key,
        value: cols.value ? cellValue(row.getCell(cols.value)) : null,
        flag: cols.flag ? normalizeFlag(cellValue(row.getCell(cols.flag))) : "ok",
        sourceTab: worksheet.name,
        note: cols.note ? String(cellValue(row.getCell(cols.note)) || "") : "",
      });
    }
  }

  return {
    client: { name: meta.name || "", ein: meta.ein || "", entityType: meta.entityType },
    taxYear: meta.taxYear || null,
    fields,
  };
}

function validateForLoad(data) {
  const blockers = [];
  const warnings = [];
  for (const field of data.fields || []) {
    if (field.flag === "error") blockers.push(`${field.canonicalKey}: flag ERROR unresolved (${field.note || "no note"})`);
    if (field.flag === "review") warnings.push(`${field.canonicalKey}: flag REVIEW - confirm approval`);
    if (field.flag === "manual") warnings.push(`${field.canonicalKey}: requires MANUAL entry in tax software`);
  }
  return { ok: blockers.length === 0, blockers, warnings };
}

module.exports = { parseApprovedWorkpaper, validateForLoad, normalizeFlag, findColumns };
