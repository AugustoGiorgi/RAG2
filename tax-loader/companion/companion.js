const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const CONFIG = {
  port: Number(process.env.COMPANION_PORT || 7777),
  paths: {
    drake: process.env.DRAKE_IMPORT_DIR || "C:\\DRAKE25\\TB\\",
  },
  sharedToken: process.env.COMPANION_TOKEN || "cambiar-este-token",
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function safeFilename(name) {
  return path.basename(String(name || "tax_loader_import.xls")).replace(/[<>:"/\\|?*]/g, "_");
}

function writeTrialBalanceTemplate(payload, outputPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tax-loader-drake-"));
  const payloadPath = path.join(tempDir, "payload.json");
  const scriptPath = path.join(tempDir, "fill-drake-template.ps1");
  fs.writeFileSync(payloadPath, JSON.stringify(payload), "utf8");
  fs.writeFileSync(scriptPath, `
param([string]$PayloadPath, [string]$OutputPath)
function Normalize-Title([string]$value) {
  return (($value -replace '[^A-Za-z0-9]', '').ToLowerInvariant())
}
$payload = Get-Content -LiteralPath $PayloadPath -Raw | ConvertFrom-Json
$templatePath = [string]$payload.meta.templatePath
$sheetName = [string]$payload.meta.sheetName
if (-not (Test-Path -LiteralPath $templatePath)) {
  throw "Drake template not found: $templatePath"
}
Copy-Item -LiteralPath $templatePath -Destination $OutputPath -Force
$excel = $null
$workbook = $null
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $workbook = $excel.Workbooks.Open($OutputPath)
  $worksheet = $workbook.Worksheets.Item($sheetName)
  if ($payload.content.clientName) { $worksheet.Cells.Item(1, 2).Value2 = [string]$payload.content.clientName }
  if ($payload.content.yearEnd) { $worksheet.Cells.Item(3, 2).Value2 = [string]$payload.content.yearEnd }

  $index = @{}
  $usedRows = $worksheet.UsedRange.Rows.Count
  for ($r = 1; $r -le $usedRows; $r++) {
    $title = [string]$worksheet.Cells.Item($r, 3).Text
    $key = Normalize-Title $title
    if ($key -and -not $index.ContainsKey($key)) { $index[$key] = $r }
  }

  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($row in $payload.content.rows) {
    $rowKey = Normalize-Title ([string]$row.accountTitle)
    if (-not $index.ContainsKey($rowKey)) {
      $missing.Add([string]$row.accountTitle)
      continue
    }
    $targetRow = [int]$index[$rowKey]
    if ($null -ne $row.debit -and "$($row.debit)" -ne "") {
      $worksheet.Cells.Item($targetRow, 5).Value2 = [double]$row.debit
    }
    if ($null -ne $row.credit -and "$($row.credit)" -ne "") {
      $worksheet.Cells.Item($targetRow, 8).Value2 = [double]$row.credit
    }
  }
  $workbook.Save()
  [pscustomobject]@{ ok = $true; written = $OutputPath; missing = @($missing) } | ConvertTo-Json -Compress
} finally {
  if ($workbook) { $workbook.Close($true) | Out-Null }
  if ($excel) {
    $excel.Quit() | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  }
}
`, "utf8");

  try {
    const stdout = execFileSync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-PayloadPath",
      payloadPath,
      "-OutputPath",
      outputPath,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return stdout.trim() ? JSON.parse(stdout.trim()) : { ok: true, written: outputPath, missing: [] };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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
      let result = { ok: true, written: outputPath };
      if (payload.kind === "drake_trial_balance_template") {
        result = writeTrialBalanceTemplate(payload, outputPath);
      } else if (payload.contentBase64) {
        fs.writeFileSync(outputPath, Buffer.from(payload.contentBase64, "base64"));
      } else {
        fs.writeFileSync(outputPath, String(payload.content || ""), "utf8");
      }

      sendJson(res, 200, {
        ok: true,
        written: outputPath,
        message: "File written for Drake import. Import it using the official Drake import workflow.",
        companionResult: result,
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
