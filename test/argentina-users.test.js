"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { manageArgentinaUsers } = require("../lib/argentina-users");

test("Argentina account management uses only the authenticated private endpoint", async () => {
  const key = "c".repeat(64);
  const args = { actor: "ramiro", action: "create", data: { username: "fede", displayName: "Fede", role: "admin", password: "must-not-travel", tenantId: "usa-firm" } };
  const request = (status, payload) => (url, opts, done) => {
    assert.equal(url, "http://127.0.0.1:4180/internal/admin/users");
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers.Host, "argentina.ragtax-ia.com");
    assert.equal(opts.headers.Authorization, "Bearer " + key);
    const req = new EventEmitter();
    req.end = body => {
      assert.deepEqual(JSON.parse(body), { actor: "ramiro", action: "create", data: { username: "fede", displayName: "Fede" } });
      const response = Readable.from([JSON.stringify(payload)]);
      response.statusCode = status;
      void done(response);
    };
    return req;
  };
  const temporary = "x".repeat(24);
  assert.deepEqual(await manageArgentinaUsers(key, args, request(201, { username: "ar-fede", temporary, password: "private" })), { status: 201, payload: { username: "ar-fede", temporary } });
  assert.equal((await manageArgentinaUsers(key, args, request(302, {}))).status, 503);
  assert.equal((await manageArgentinaUsers(key, args, request(404, {}))).status, 503);
  assert.deepEqual(await manageArgentinaUsers(key, args, request(400, { error: "Duplicate", secret: key })), { status: 400, payload: { error: "Duplicate" } });
  await assert.rejects(() => manageArgentinaUsers(key, args, request(201, { username: "usa-user", temporary })), /Invalid/);
});

test("Argentina account listings never return hashes or temporary passwords", async () => {
  const request = (url, opts, done) => {
    const req = new EventEmitter();
    req.end = body => {
      assert.deepEqual(JSON.parse(body), { actor: "ramiro", action: "list" });
      const response = Readable.from([JSON.stringify({ users: [{ username: "ar-fede", name: "Fede", role: "member", active: 1, must_change: 1, password: "hash", temporary: "secret" }] })]);
      response.statusCode = 200;
      void done(response);
    };
    return req;
  };
  const result = await manageArgentinaUsers("c".repeat(64), { actor: "ramiro", action: "list" }, request);
  assert.deepEqual(result.payload.users, [{ username: "ar-fede", name: "Fede", role: "member", active: 1, must_change: 1 }]);
});
