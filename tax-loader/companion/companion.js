const http = require("http");
const fs = require("fs");
const path = require("path");

const CONFIG = {
  port: Number(process.env.COMPANION_PORT || 7777),
  paths: {
    drake: process.env.DRAKE_IMPORT_DIR || "C:\\DrakeXX\\Import\\", // REQUIERE-DOC-OFICIAL: confirm local Drake import folder.
  },
  sharedToken: process.env.COMPANION_TOKEN || "cambiar-este-token",
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function safeFilename(name) {
  return path.basename(String(name || "tax_loader_import.csv")).replace(/[<>:"/\\|?*]/g, "_");
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Companion-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { status: "ok", software: ["drake"] });
    return;
  }

  if (req.method !== "POST" || req.url !== "/import") {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  let body = "";
  req.on("data", chunk => {
    body += chunk;
    if (body.length > 10 * 1024 * 1024) req.destroy();
  });

  req.on("end", () => {
    try {
      if (req.headers["x-companion-token"] !== CONFIG.sharedToken) {
        sendJson(res, 401, { error: "invalid companion token" });
        return;
      }

      const payload = JSON.parse(body || "{}");
      const software = String(payload.software || "");
      const dir = CONFIG.paths[software];
      if (!dir) {
        sendJson(res, 400, { error: `unknown software: ${software}` });
        return;
      }

      fs.mkdirSync(dir, { recursive: true });
      const outputPath = path.join(dir, safeFilename(payload.filename));
      fs.writeFileSync(outputPath, String(payload.content || ""), "utf8");

      sendJson(res, 200, {
        ok: true,
        written: outputPath,
        message: "File written for Drake import. Import it using the official Drake import workflow.",
        meta: payload.meta || {},
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });
});

server.listen(CONFIG.port, "127.0.0.1", () => {
  console.log(`[tax-loader companion] listening on http://127.0.0.1:${CONFIG.port}`);
  console.log(`[tax-loader companion] Drake import folder: ${CONFIG.paths.drake}`);
});
