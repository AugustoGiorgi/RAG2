"use strict";

/**
 * Arma los paquetes del banco de pruebas.
 *
 *   node scripts/banco/armar.cjs [carpeta]
 *
 * Por cada caso de scripts/banco/casos:
 *  - escribe los archivos para subir a la app (PDF, ZIP, Excel) en <carpeta>/<caso>/, por
 *    defecto en Descargas/"Banco de pruebas RAG";
 *  - extrae el texto como lo hace el navegador (pdf.js vendorizado + pdfPageLines de app.js,
 *    secciones "--- ZIP ENTRY ---", hojas del Excel como CSV) y lo guarda en
 *    test/fixtures/banco/<caso>.json, que es lo que corren los tests y `npm run banco`.
 *
 * Los PDF y el Excel no van al repositorio; los JSON si, para que el banco corra sin pdf.js.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const REPO = path.join(__dirname, "..", "..");
const XLSX = require(path.join(REPO, "assets/vendor/xlsx.full.min.js"));
const JSZip = require("jszip");

const appSrc = fs.readFileSync(path.join(REPO, "app.js"), "utf8");
const a = appSrc.indexOf("function pdfPageLines(content) {");
const b = appSrc.indexOf("\n}", appSrc.indexOf("function lastIndexWithWords(rendered, from) {")) + 2;
// eslint-disable-next-line no-new-func
const { pdfPageLines } = new Function(`${appSrc.slice(a, b)}\nreturn { pdfPageLines };`)();
globalThis.pdfjsWorker = require(path.join(REPO, "assets/vendor/pdf.worker.min.js"));
const pdfjsLib = require(path.join(REPO, "assets/vendor/pdf.min.js"));

async function pdfText(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const text = pdfPageLines(await (await pdf.getPage(n)).getTextContent()).join("\n");
    if (text) pages.push(`--- Page ${n} ---\n${text}`);
  }
  return pages.join("\n\n");
}

function xlsxText(buffer) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  return wb.SheetNames.map((n) => {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false });
    return csv.trim() ? `--- Sheet: ${n} ---\n${csv}` : "";
  }).filter(Boolean).join("\n\n");
}

const regexToJson = (re) => (re ? { source: re.source, flags: re.flags } : null);

async function armarCaso(caso, outDir) {
  const dir = path.join(outDir, caso.id);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const file of await caso.archivos()) {
    if (file.pdf) {
      fs.writeFileSync(path.join(dir, file.name), file.pdf);
      files.push({ name: file.name, role: file.role, encoding: "pdf-text", text: await pdfText(file.pdf) });
    } else if (file.zip) {
      const zip = new JSZip();
      for (const [name, buf] of Object.entries(file.zip)) zip.file(name, buf);
      const buffer = await zip.generateAsync({ type: "nodebuffer" });
      fs.writeFileSync(path.join(dir, file.name), buffer);
      const sections = [];
      for (const [name, buf] of Object.entries(file.zip)) sections.push(`--- ZIP ENTRY: ${name} ---\n${(await pdfText(buf)).trim()}`);
      files.push({ name: file.name, role: file.role, encoding: "zip-text", text: sections.join("\n\n") });
    } else if (file.xlsx) {
      fs.writeFileSync(path.join(dir, file.name), file.xlsx);
      files.push({ name: file.name, role: file.role, encoding: "xlsx-text", text: xlsxText(file.xlsx) });
    }
  }
  const fixture = {
    id: caso.id,
    titulo: caso.titulo,
    returnType: caso.returnType,
    taxYear: caso.taxYear,
    esperado: caso.esperado || {},
    clave: caso.clave.map((c) => ({ ...c, codigo: regexToJson(c.codigo), detalle: regexToJson(c.detalle) })),
    tolerados: (caso.tolerados || []).map(regexToJson),
    files,
  };
  fs.writeFileSync(path.join(REPO, "test/fixtures/banco", `${caso.id}.json`), `${JSON.stringify(fixture, null, 1)}\n`);
  return { dir, files: files.length };
}

async function main() {
  const outDir = process.argv[2] || path.join(os.homedir(), "Downloads", "Banco de pruebas RAG");
  const casosDir = path.join(__dirname, "casos");
  for (const name of fs.readdirSync(casosDir).filter((n) => n.endsWith(".cjs")).sort()) {
    const caso = require(path.join(casosDir, name));
    const out = await armarCaso(caso, outDir);
    console.log(`${caso.id}: ${out.files} archivos en ${out.dir}`);
  }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { armarCaso, pdfText, xlsxText };
