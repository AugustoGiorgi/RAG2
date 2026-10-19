"use strict";

/**
 * Califica un paquete del banco de pruebas: corre los cruces del codigo con los mismos modulos
 * que usa la Review (los que server.js corre en automatedFindingsFor), el tie-out con filas
 * vacias (lo que el codigo decide solo) y las lecturas de la tabla de casillas y de la tasa
 * marginal, y compara contra la clave del caso.
 *
 * La clave de cada caso dice que errores se plantaron y, para los que el codigo tiene que ver,
 * con que titulo. Un hallazgo del codigo que no esta en la clave ni en los tolerados es un
 * hallazgo de mas: o el caso esta mal armado, o un cruce dio un falso positivo.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const lib = (name) => require(path.join(REPO, "lib", name));

/** Los modulos de cruces que corre el servidor, leidos de server.js para no quedar atrasados. */
function moduleRunners() {
  const src = fs.readFileSync(path.join(REPO, "server.js"), "utf8");
  const names = [...new Set([...src.matchAll(/\(\) => (run[A-Za-z0-9]+Checks)\(files/g)].map((m) => m[1]))];
  return names.map((name) => {
    const where = (src.match(new RegExp(`\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=\\s*require\\("\\./lib/([^"]+)"\\)`)) || [])[1];
    return { name, run: where ? lib(where)[name] : null };
  });
}

const toRegex = (r) => (r ? new RegExp(r.source, r.flags) : null);

function filesOf(fixture) {
  return fixture.files.map((f) => ({ ...f, reviewRole: f.role, extractedText: f.text, fullText: f.text }));
}

function calificar(fixture) {
  const meta = { taxYear: fixture.taxYear, returnType: fixture.returnType };
  const files = filesOf(fixture);
  const findings = [];
  const errors = [];
  for (const { name, run } of moduleRunners()) {
    if (!run) { errors.push(`${name}: modulo no encontrado`); continue; }
    try {
      for (const f of (run(files.map((x) => ({ ...x })), meta) || []).filter(Boolean)) findings.push({ module: name, ...f });
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }
  // El tie-out que decide el codigo solo: las filas obligatorias vacias, como si el modelo no
  // hubiera escrito nada, con el lado de la declaracion y el de los documentos leidos por codigo.
  const tie = lib("tie-out.js");
  const rows = tie.requiredTieOutsFor(fixture.returnType, files).map((r) => ({ lineItem: r.label, returnAmount: "", workpaperAmount: "" }));
  const tieOut = tie.enforceNumericVerdicts({ tieOutResults: rows }, fixture.returnType, files).review.tieOutResults;
  const outOfBalance = new Set(tieOut.filter((r) => String(r.status).toUpperCase() === "OUT_OF_BALANCE").map((r) => tie.canonicalLineKey(r.lineItem)));

  const clave = fixture.clave.map((c) => {
    const re = toRegex(c.codigo);
    const detail = toRegex(c.detalle);
    const hit = re ? findings.find((f) => re.test(String(f.title || "")) && (!detail || detail.test(String(f.detail || "")))) : null;
    const tieOk = c.tieout ? outOfBalance.has(c.tieout) : null;
    return { ...c, codigo: re, detalle: detail, encontrado: Boolean(hit), por: hit ? hit.module : "", severidad: hit ? hit.severity : "", tieOk };
  });
  const tolerated = (fixture.tolerados || []).map(toRegex).filter(Boolean);
  const expected = clave.map((c) => c.codigo).filter(Boolean);
  const extra = findings.filter((f) => !expected.some((re) => re.test(String(f.title || ""))) && !tolerated.some((re) => re.test(String(f.title || ""))));

  const out = { id: fixture.id, titulo: fixture.titulo, clave, extra, errors, findings };
  const esperado = fixture.esperado || {};
  if (esperado.estadoCivil) {
    const rows = lib("checkbox-inventory.js").checkboxInventoryRows(files, meta);
    const status = rows.find((r) => /^Filing status \(read by code/.test(r.box));
    out.estadoCivil = { esperado: esperado.estadoCivil, leido: status ? status.currentState : null };
  }
  if (esperado.tasaMarginal !== undefined) {
    const profile = lib("tax-impact.js").taxProfile(files, fixture.returnType, meta);
    out.tasaMarginal = { esperado: esperado.tasaMarginal, leida: profile ? profile.rate : null };
  }
  return out;
}

function leerFixtures() {
  const dir = path.join(REPO, "test/fixtures/banco");
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));
}

module.exports = { calificar, leerFixtures, moduleRunners };
