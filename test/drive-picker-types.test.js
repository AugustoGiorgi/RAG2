"use strict";
// Los selectores de Google Drive y OneDrive filtraban con listas fijas mas cortas que lo que cada
// recuadro acepta desde la computadora: un JPG subido a OneDrive no aparecia para elegirlo, ni un
// .xls o un .doc. Aca cada recuadro tiene que mostrar al menos lo que acepta desde la computadora.
// Tambien la vista nueva del selector de Google Drive (lista, carpetas, pestañas). Codigo real de
// app.js y microsoft.js, tomado de los archivos.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8").replace(/\r\n/g, "\n");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const microsoft = fs.readFileSync(path.join(root, "microsoft.js"), "utf8");

const grabFn = (name) => {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name}`);
  return app.slice(start, app.indexOf("\n}\n", start) + 2);
};
const grabObject = (name) => {
  const start = app.indexOf(`const ${name} = `);
  if (start === -1) throw new Error(`no encontre ${name}`);
  return app.slice(start, app.indexOf("\n};\n", start) + 3);
};
// eslint-disable-next-line no-new-func
const { DRIVE_ZONE_CONFIG, ESTIMATED_PICKER_TYPES, drivePickerMimeTypes, drivePickerViews } = new Function(
  `${grabObject("DRIVE_ZONE_CONFIG")}\n${app.match(/const ESTIMATED_PICKER_TYPES = \[[^\]]*\];/)[0]}\n${grabFn("drivePickerMimeTypes")}\n${grabFn("drivePickerViews")}\n` +
  "return { DRIVE_ZONE_CONFIG, ESTIMATED_PICKER_TYPES, drivePickerMimeTypes, drivePickerViews };",
)();

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
function acceptTypes(inputId) {
  const tag = html.match(new RegExp(`<input[^>]*id="${inputId}"[^>]*>`));
  const accept = tag && tag[0].match(/accept="([^"]*)"/);
  if (!accept) return null;
  return [...new Set(accept[1].split(",").map((token) => token.trim().toLowerCase()).filter(Boolean).map((token) => {
    if (token.startsWith("image/")) return "image";
    const ext = token.replace(/^\./, "");
    return IMAGE_EXT.has(ext) ? "image" : ext;
  }))];
}

test("cada selector de Drive/OneDrive muestra lo que su recuadro acepta desde la computadora", () => {
  const pairs = [...app.matchAll(/addDriveButtonAfterInput\("([^"]+)", "([^"]+)"\)/g)].map((m) => [m[1], m[2]]);
  assert.ok(pairs.length >= 10, "encontro los recuadros");
  const checked = [];
  for (const [inputId, zone] of pairs) {
    const accepted = acceptTypes(inputId);
    if (!accepted) continue;
    const allowed = DRIVE_ZONE_CONFIG[zone].allowedTypes;
    const missing = accepted.filter((type) => !allowed.includes(type));
    assert.deepStrictEqual(missing, [], `${zone} (${inputId}) esconde: ${missing.join(", ")}`);
    checked.push(zone);
  }
  assert.ok(checked.includes("review-package") && checked.includes("prep-package"));
});

test("Estimated Taxes: Drive y OneDrive aceptan todo lo de sus recuadros, fotos incluidas", () => {
  for (const inputId of ["estPlFile", "estAdditionalFiles", "estTaxReturnsFiles", "estTemplateFile"]) {
    const accepted = acceptTypes(inputId);
    if (!accepted) continue;
    const missing = accepted.filter((type) => !ESTIMATED_PICKER_TYPES.includes(type));
    assert.deepStrictEqual(missing, [], `${inputId} esconde: ${missing.join(", ")}`);
  }
  assert.ok(ESTIMATED_PICKER_TYPES.includes("image"));
  assert.match(microsoft, /"Select Estimated Tax Files", allowedTypes: typeof ESTIMATED_PICKER_TYPES !== "undefined" \? ESTIMATED_PICKER_TYPES/);
});

test("Deliverable: cualquier archivo puede ir adjunto, desde Drive y desde OneDrive", () => {
  assert.match(app, /title: "Select Files to Send to Client",[\s\S]{0,200}allowedTypes: \[\],/);
  assert.match(microsoft, /"Select Email Attachments", allowedTypes: \[\]/);
  assert.strictEqual(drivePickerMimeTypes([]), "", "sin filtro de tipos en Google");
  // El filtro de OneDrive (microsoft.js): una lista vacia deja pasar todo, y "image" deja pasar un JPG.
  const allowedSrc = microsoft.match(/function allowed\(file, types\) \{[\s\S]*?\n  \}/)[0];
  // eslint-disable-next-line no-new-func
  const allowed = new Function(`${allowedSrc}\nreturn allowed;`)();
  assert.strictEqual(allowed({ name: "foto recibo.JPG" }, []), true);
  assert.strictEqual(allowed({ name: "foto recibo.jpg" }, ["pdf", "image"]), true);
  assert.strictEqual(allowed({ name: "foto recibo.jpg" }, ["pdf"]), false);
});

test("los tipos nuevos tienen su MIME en Google Drive", () => {
  const mimes = drivePickerMimeTypes(["xls", "doc", "json", "md", "image"]).split(",");
  for (const mime of ["application/vnd.ms-excel", "application/msword", "application/json", "text/markdown", "image/jpeg", "image/png"]) {
    assert.ok(mimes.includes(mime), mime);
  }
});

// Un google.picker de mentira que anota que se le pidio a cada vista.
function fakePicker({ labels = true } = {}) {
  class DocsView {
    constructor(id) { this.calls = [["view", id]]; }
    setMimeTypes(v) { this.calls.push(["mime", v]); }
    setIncludeFolders(v) { this.calls.push(["folders", v]); }
    setSelectFolderEnabled(v) { this.calls.push(["selectFolder", v]); }
    setParent(v) { this.calls.push(["parent", v]); }
    setMode(v) { this.calls.push(["mode", v]); }
    setOwnedByMe(v) { this.calls.push(["ownedByMe", v]); }
    setEnableDrives(v) { this.calls.push(["drives", v]); }
    setStarred(v) { this.calls.push(["starred", v]); }
  }
  if (labels) DocsView.prototype.setLabel = function setLabel(v) { this.calls.push(["label", v]); };
  return { DocsView, ViewId: { DOCS: "docs", FOLDERS: "folders" }, DocsViewMode: { LIST: "list", GRID: "grid" } };
}
const read = (view, key) => view.calls.filter((call) => call[0] === key).map((call) => call[1]);

test("Google Drive: lista, arranca en las carpetas de My Drive y tiene pestañas", () => {
  const views = drivePickerViews(fakePicker(), { allowedTypes: ["pdf"] });
  assert.deepStrictEqual(views.map((view) => read(view, "label")[0]), ["My Drive", "Shared with me", "Shared drives", "Starred"]);
  for (const view of views) {
    assert.deepStrictEqual(read(view, "mode"), ["list"]);
    assert.deepStrictEqual(read(view, "mime"), ["application/pdf"]);
    assert.deepStrictEqual(read(view, "folders"), [true]);
    assert.deepStrictEqual(read(view, "selectFolder"), [false], "las carpetas se navegan, no se eligen");
  }
  assert.deepStrictEqual(read(views[0], "parent"), ["root"]);
  assert.deepStrictEqual(read(views[1], "ownedByMe"), [false]);
  assert.deepStrictEqual(read(views[1], "parent"), [], "Shared with me no queda atado a una carpeta");
  assert.strictEqual(views[2].__sharedDrives, true);
  assert.deepStrictEqual(read(views[3], "starred"), [true]);
});

test("Google Drive con la carpeta del cliente: arranca ahi y My Drive queda como pestaña", () => {
  const views = drivePickerViews(fakePicker(), { allowedTypes: [], folderId: "client-folder-1" });
  assert.deepStrictEqual(views.map((view) => read(view, "label")[0]), ["Client folder", "My Drive", "Shared with me", "Shared drives", "Starred"]);
  assert.deepStrictEqual(read(views[0], "parent").slice(-1), ["client-folder-1"]);
  assert.deepStrictEqual(read(views[1], "parent"), ["root"]);
  assert.deepStrictEqual(read(views[0], "mime"), [], "sin filtro: cualquier archivo");
});

test("si el Picker no sabe nombrar pestañas, queda una sola vista en lista; si algo falla, la original", () => {
  const plain = drivePickerViews(fakePicker({ labels: false }), { allowedTypes: ["pdf"] });
  assert.strictEqual(plain.length, 1);
  assert.deepStrictEqual(read(plain[0], "mode"), ["list"]);
  const broken = fakePicker();
  broken.DocsView.prototype.setStarred = () => { throw new Error("not supported"); };
  const original = console.warn;
  console.warn = () => {};
  try {
    const fallback = drivePickerViews(broken, { allowedTypes: ["pdf"], folderId: "client-folder-1" });
    assert.strictEqual(fallback.length, 1);
    assert.deepStrictEqual(read(fallback[0], "parent"), ["client-folder-1"]);
    assert.deepStrictEqual(read(fallback[0], "mode"), [], "la vista original, tal cual era");
  } finally { console.warn = original; }
});

test("seleccionar una carpeta sigue funcionando", () => {
  const views = drivePickerViews(fakePicker(), { folderOnly: true });
  assert.deepStrictEqual(read(views[0], "view"), ["folders"]);
  assert.deepStrictEqual(read(views[0], "selectFolder"), [true]);
  assert.deepStrictEqual(read(views[0], "mime"), ["application/vnd.google-apps.folder"]);
});
