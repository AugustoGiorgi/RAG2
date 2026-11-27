"use strict";
// Archivos estaticos: solo la pagina, sus scripts y estilos, y /assets. Antes se servia todo lo
// que hubiera en la carpeta de la app: con sesion, /data/*.json (usuarios y clientes de todas
// las firmas) o /.env; y sin sesion, /assets/..%2Fpackage.json se salia de /assets. Se prueba
// la funcion real de server.js.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "server.js"), "utf8").replace(/\r\n/g, "\n");
const grabConst = (name) => {
  const start = src.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`no encontre ${name}`);
  return src.slice(start, src.indexOf(";\n", start) + 1);
};
const grabFn = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`no encontre ${name}`);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
};
// eslint-disable-next-line no-new-func
const staticFilePath = new Function("path", "ROOT",
  `${grabConst("PUBLIC_ROOT_FILES")}\n${grabConst("PUBLIC_ASSETS_DIR")}\n${grabFn("staticFilePath")}\nreturn staticFilePath;`)(path, ROOT);

test("la pagina, sus scripts, estilos y /assets se sirven", () => {
  assert.strictEqual(staticFilePath("/"), path.join(ROOT, "index.html"));
  for (const file of ["/index.html", "/app.js", "/microsoft.js", "/styles.css", "/microsoft.css"]) {
    assert.strictEqual(staticFilePath(file), path.join(ROOT, file), file);
  }
  assert.strictEqual(staticFilePath("/assets/vendor/pdf.min.js"), path.join(ROOT, "assets", "vendor", "pdf.min.js"));
  assert.strictEqual(staticFilePath("/assets/rag-r-logo.png"), path.join(ROOT, "assets", "rag-r-logo.png"));
});

test("nada fuera de esa lista: datos, claves, codigo del servidor", () => {
  for (const blocked of ["/data/users.json", "/data/database.json", "/.env", "/server.js", "/package.json",
    "/lib/notice-tracker.js", "/knowledge_base/x.txt", "/templates/estimates/EstTax_Template_1040.xlsx", "/.git/config"]) {
    assert.strictEqual(staticFilePath(blocked), "", blocked);
  }
});

test("ningun truco para salirse de /assets", () => {
  for (const attack of [
    "/assets/..%2Fpackage.json", "/assets/%2E%2E%2Fpackage.json", "/assets/%2e%2e/.env", "/assets/../.env",
    "/assets/..%5C..%5Cpackage.json", "/assets/vendor/..%2F..%2Fdata%2Fusers.json", "/assets/.hidden",
    "/assets//etc/passwd", "/assets/", "/assets", "/assets/x%00.png", "/assets/%E0%A4%A", "/%2e%2e/.env",
  ]) {
    assert.strictEqual(staticFilePath(attack), "", attack);
  }
});

test("todo lo que referencian las paginas se sigue sirviendo", () => {
  const routes = new Set(["/", "/login", "/request-access", "/site.webmanifest", "/favicon.ico", "/favicon-48.png", "/favicon-96.png",
    "/favicon-144.png", "/favicon-192.png", "/favicon-512.png", "/apple-touch-icon.png"]);
  for (const page of ["index.html", "landing.html"]) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1])
      .filter((ref) => !/^(https?:|mailto:|data:|\/api\/|\/auth\/)/.test(ref))
      .map((ref) => (ref.startsWith("/") ? ref : `/${ref}`).split("?")[0]);
    for (const ref of refs) {
      if (routes.has(ref)) continue;
      assert.ok(staticFilePath(ref), `${page} usa ${ref} y no se serviria`);
      assert.ok(fs.existsSync(staticFilePath(ref)), `${ref} existe`);
    }
  }
});
