"use strict";

const fs = require("node:fs");
const http = require("node:http");

const argentinaOrigin = "https://argentina.ragtax-ia.com";
const reservedArgentinaLogin = (username) => /^(?:ar-|admin-argentina$)/i.test(username);

function readArgentinaBridgeKey() {
  const file = process.env.RAG_AR_LOGIN_BRIDGE_FILE || "/etc/rag-argentina/shared-login.key";
  let key;
  try { key = fs.readFileSync(file, "utf8").trim(); }
  catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid Argentina login bridge key.");
  return key;
}

function authenticateArgentina(key, username, password, request = http.request) {
  const body = JSON.stringify({ username, password });
  return new Promise((resolve, reject) => {
    const req = request("http://127.0.0.1:4180/internal/sso/login", {
      method: "POST",
      headers: { Host: "argentina.ragtax-ia.com", Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      signal: AbortSignal.timeout(12000),
    }, async (response) => {
      const { statusCode: status } = response;
      if (status !== 200) {
        response.resume();
        resolve({ status: [401, 429].includes(status) ? status : 503 });
        return;
      }
      try {
        let raw = "";
        for await (const chunk of response) {
          raw += chunk;
          if (raw.length > 256) throw new Error("Invalid Argentina sign-in response.");
        }
        const { code } = JSON.parse(raw);
        resolve(typeof code === "string" && /^[A-Za-z0-9_-]{43}$/.test(code) ? { status: 200, code } : { status: 503 });
      } catch (error) { reject(error); }
    });
    req.on("error", reject);
    req.end(body);
  });
}

module.exports = { argentinaOrigin, reservedArgentinaLogin, readArgentinaBridgeKey, authenticateArgentina };
