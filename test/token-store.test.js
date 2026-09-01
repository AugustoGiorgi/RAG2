"use strict";
// Almacén cifrado de credenciales (Google, QuickBooks, contabilidad).
//
// Falla real: "Google connected" en el popup y, un segundo después, la app mostrando
// desconectado — para siempre. La escritura funcionaba; la lectura siguiente encontraba una
// entrada vieja que no podía descifrar, lanzaba, y el catch de arriba devolvía un store vacío.
// Una sola entrada ilegible dejaba a TODOS los usuarios sin conexión, sin una línea de log.
const { test } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const grab = (name) => {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`no encontré ${name}`);
  const end = src.indexOf("\n}", start);
  return src.slice(start, end + 2);
};

/** Monta las funciones reales sobre una clave de prueba. `key` null = servidor sin clave. */
function build(key) {
  const bytes = key === null ? null : crypto.createHash("sha256").update(key).digest();
  const logs = [];
  // eslint-disable-next-line no-eval
  const api = eval(`(() => {
    const crypto = require("node:crypto");
    const TOKEN_ENCRYPTION_KEY_BYTES = ${bytes ? `Buffer.from("${bytes.toString("hex")}", "hex")` : "null"};
    const console = { error: (m) => logs.push(m) };
    ${grab("encryptSecretObject")}
    ${grab("decryptSecretObject")}
    ${grab("encryptUserMap")}
    ${grab("decryptUserMap")}
    return { encryptUserMap, decryptUserMap };
  })()`);
  return { ...api, logs };
}

test("ida y vuelta con la clave correcta", () => {
  const { encryptUserMap, decryptUserMap } = build("clave-de-prueba");
  const original = { ana: { access_token: "a1", scope: "drive gmail" }, beto: { access_token: "b2" } };
  const guardado = encryptUserMap(original);
  assert.strictEqual(guardado.ana.encrypted, true, "debe quedar cifrado en disco");
  assert.ok(!JSON.stringify(guardado).includes("a1"), "el token no puede quedar legible en el archivo");
  assert.deepStrictEqual(decryptUserMap(guardado), original);
});

test("una entrada ilegible no se lleva puestas a las demás", () => {
  // Este es el caso de produccion: una credencial vieja cifrada con OTRA clave, al lado de
  // una recien guardada. Antes, la vieja hacia fallar la lectura entera.
  const vieja = build("clave-anterior").encryptUserMap({ ana: { access_token: "vieja" } }).ana;
  const actual = build("clave-actual");
  const archivo = { ...actual.encryptUserMap({ beto: { access_token: "nueva" } }), ana: vieja };

  const leido = actual.decryptUserMap(archivo);
  assert.deepStrictEqual(leido.beto, { access_token: "nueva" }, "beto debe seguir conectado");
  assert.strictEqual(leido.ana, undefined, "ana pierde su credencial, y solo ella");
  assert.strictEqual(actual.logs.length, 1, "y el fallo tiene que quedar registrado");
  assert.match(actual.logs[0], /ana/);
  assert.match(actual.logs[0], /reconnect/i);
});

test("servidor sin TOKEN_ENCRYPTION_KEY: lo dice, y no borra a los demás", () => {
  // Asimetria que causaba el bug: sin clave, encryptSecretObject guarda en claro sin avisar,
  // pero decryptSecretObject lanza. Un archivo mixto era ilegible por completo.
  const cifrada = build("una-clave").encryptUserMap({ ana: { access_token: "x" } }).ana;
  const sinClave = build(null);
  const enClaro = sinClave.encryptUserMap({ beto: { access_token: "plano" } });
  assert.deepStrictEqual(enClaro.beto, { access_token: "plano" }, "sin clave guarda sin cifrar");

  const leido = sinClave.decryptUserMap({ ...enClaro, ana: cifrada });
  assert.deepStrictEqual(leido.beto, { access_token: "plano" });
  assert.strictEqual(leido.ana, undefined);
  assert.match(sinClave.logs[0], /TOKEN_ENCRYPTION_KEY is not set/);
});

test("un archivo entero en claro se lee tal cual", () => {
  // Instalaciones viejas, anteriores al cifrado.
  const { decryptUserMap } = build("clave");
  assert.deepStrictEqual(decryptUserMap({ ana: { access_token: "viejo" } }), { ana: { access_token: "viejo" } });
});

test("los tres almacenes registran un archivo ilegible en vez de callarse", () => {
  for (const fn of ["readGoogleTokenStore", "readQboStore", "readAccountingStore"]) {
    const cuerpo = grab(fn);
    assert.doesNotMatch(cuerpo, /catch \(_\)/, `${fn} no puede tragarse el error`);
    assert.match(cuerpo, /console\.error/, `${fn} tiene que registrarlo`);
  }
});
