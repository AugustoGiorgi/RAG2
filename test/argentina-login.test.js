"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { argentinaOrigin, reservedArgentinaLogin, authenticateArgentina } = require("../lib/argentina-login");

test("existing USA logins do not use the Argentina namespace", () => {
  for (const name of ["augusto", "ramiro", "argentina", "admin", "mary-ar"]) assert.equal(reservedArgentinaLogin(name), false);
  for (const name of ["admin-argentina", "Admin-Argentina", "ar-ramiro", "AR-Tester"]) assert.equal(reservedArgentinaLogin(name), true);
});

test("Argentina logins go only to the private endpoint and return an opaque code", async () => {
  const key = "a".repeat(64);
  const code = "b".repeat(43);
  const stub = (status, responseBody) => (url, opts, onResponse) => {
    assert.equal(url, "http://127.0.0.1:4180/internal/sso/login");
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers.Host, new URL(argentinaOrigin).host);
    assert.equal(opts.headers.Authorization, `Bearer ${key}`);
    const req = new EventEmitter();
    req.end = (body) => {
      assert.deepEqual(JSON.parse(body), { username: "ar-tester", password: "demo" });
      const res = Readable.from([JSON.stringify(responseBody || {})]);
      res.statusCode = status;
      void onResponse(res);
    };
    return req;
  };
  assert.deepEqual(await authenticateArgentina(key, "ar-tester", "demo", stub(200, { code })), { status: 200, code });
  assert.deepEqual(await authenticateArgentina(key, "ar-tester", "demo", stub(401)), { status: 401 });
  assert.deepEqual(await authenticateArgentina(key, "ar-tester", "demo", stub(429)), { status: 429 });
  assert.deepEqual(await authenticateArgentina(key, "ar-tester", "demo", stub(302)), { status: 503 });
  assert.deepEqual(await authenticateArgentina(key, "ar-tester", "demo", stub(200, { code: "//example.test" })), { status: 503 });
});
