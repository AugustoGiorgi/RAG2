"use strict";

const http = require("node:http");

function manageArgentinaUsers(key, { actor, action, data }, request = http.request) {
  const body = JSON.stringify({ actor, action, ...(data && { data: { username: data.username, displayName: data.displayName } }) });
  return new Promise((resolve, reject) => {
    const req = request("http://127.0.0.1:4180/internal/admin/users", {
      method: "POST",
      headers: { Host: "argentina.ragtax-ia.com", Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      signal: AbortSignal.timeout(12000),
    }, async (response) => {
      try {
        const status = response.statusCode;
        if (![200, 201, 400, 409, 429].includes(status)) {
          response.resume();
          resolve({ status: 503, payload: { error: "Argentina user administration is temporarily unavailable." } });
          return;
        }
        let raw = "";
        for await (const chunk of response) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 256 * 1024) throw new Error("Argentina user response is too large.");
        }
        const payload = JSON.parse(raw);
        if (status >= 400) {
          resolve({ status, payload: { error: typeof payload.error === "string" ? payload.error.slice(0, 300) : "Could not create the Argentina user." } });
        } else if (action === "list" && status === 200 && Array.isArray(payload.users)) {
          resolve({ status, payload: { users: payload.users.map(user => ({
            username: user.username, name: user.name, role: user.role, active: user.active, must_change: user.must_change,
          })) } });
        } else if (action === "create" && status === 201 && /^ar-[a-z0-9][a-z0-9._-]{2,36}$/.test(payload.username || "") && /^[A-Za-z0-9_-]{24}$/.test(payload.temporary || "")) {
          resolve({ status, payload: { username: payload.username, temporary: payload.temporary } });
        } else throw new Error("Invalid Argentina user response.");
      } catch (error) { reject(error); }
    });
    req.on("error", reject);
    req.end(body);
  });
}

module.exports = { manageArgentinaUsers };
