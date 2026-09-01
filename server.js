const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const zlib = require("node:zlib");
const net = require("node:net");
const tls = require("node:tls");
const { buildPresentation } = require("./lib/pptx-builder");
const { buildPlanningDeck } = require("./lib/pptx-builder");
const planningTax = require("./lib/tax-calculations");
const { QBOConnector }     = require("./qbo-connector");
const { createPool, isDatabaseConfigured } = require("./lib/postgres");
const { PDFParse } = require("pdf-parse");
const { buildStyledWorkpaperXlsx } = require("./lib/xlsx-workpaper");
const { buildM1Sheet, hasReconciliation } = require("./lib/m1-reconciliation");
const { canonicalizeWorkbookSheets, injectSectionTotalFormulas, injectFinancialStatementFormulas, linkEntryGuideToWorkpaper } = require("./lib/workbook-postprocess");
const { buildK1Sheet } = require("./lib/k1-builder");
const { enforceNumericVerdicts, ensureRequiredTieOutRows, tieOutChecklistPromptLines, detectReturnTypeFromFiles, auditDocumentCoverage } = require("./lib/tie-out");
const { runPriorYearChecks } = require("./lib/prior-year-bridge");
const { runEntityReturnChecks } = require("./lib/entity-return-checks");
const { runReturnConsistencyChecks } = require("./lib/return-consistency-checks");
const { verifyAbsenceClaims, verifyAttachmentClaims, verifyContinuityClaims, checkUnusedReconcilingLines } = require("./lib/review-guards");
const { saveWorkpaperToArchive, listArchive, loadNewestPriorWorkpaper, xlsxBufferToTemplate, templateToText } = require("./lib/workpaper-archive");

const ROOT = __dirname;
loadEnvFile(path.join(ROOT, ".env"));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Prompt-cache TTL for the Review request. A 5-minute write costs 1.25x base and only pays
// off if a second run lands inside the window; a 1-hour write costs 2x and needs three.
// Kept configurable because the answer is an empirical question about how the firm actually
// works, and the logged cache_read on every review is the evidence. Set REVIEW_CACHE_TTL to
// "1h" once the log shows reads, or "off" to stop paying the write premium for nothing.
const REVIEW_CACHE_TTL = String(process.env.REVIEW_CACHE_TTL || "5m").trim().toLowerCase();
const REVIEW_CACHE_CONTROL = REVIEW_CACHE_TTL === "off"
  ? null
  : REVIEW_CACHE_TTL === "1h"
    ? { type: "ephemeral", ttl: "1h" }
    : { type: "ephemeral" };
/** Applies the configured cache breakpoint, or none when caching is switched off. */
function withReviewCache(block) {
  return REVIEW_CACHE_CONTROL ? { ...block, cache_control: REVIEW_CACHE_CONTROL } : block;
}

const MODEL_FALLBACKS = (process.env.CLAUDE_MODEL || "claude-sonnet-4-6,claude-haiku-4-5-20251001")
  .split(",").map((m) => m.trim()).filter(Boolean);
// 10 minutes. A review generates ~14k tokens, which takes 4-5 minutes; against a 5-minute
// cap the call was aborted a breath from finishing and the entire request ran a second time
// with a tighter extract. That second run is what made a review take 15 minutes.
//
// This was reverted once, on the theory that it had caused three reviews to stop reading the
// scanned attachments. The theory was wrong. A timeout cannot change a prompt; it changes
// only WHICH of two prompts gets answered - and the runs in question answered the same one.
// The good review cited Form 8582 line 6, which sits at 86% of a document the compacted
// retry truncates away, so it can only have come from the full first attempt. Identical
// request, different behaviour: the model does not always open the attached images. That is
// addressed where the attachments are announced, not here.
const ANTHROPIC_REQUEST_TIMEOUT_MS = Number(process.env.ANTHROPIC_REQUEST_TIMEOUT_MS || 600000);
// Silence between chunks, not total duration. A streaming generation that is still producing
// tokens is not stuck no matter how long it runs; two minutes of nothing is.
const ANTHROPIC_STREAM_IDLE_TIMEOUT_MS = Number(process.env.ANTHROPIC_STREAM_IDLE_TIMEOUT_MS || 120000);
// Streaming back on, this time on evidence rather than a hunch.
//
// It was switched off after three reviews stopped reading the scanned attachments, on the
// theory that the hand-written SSE parser was to blame. That theory was wrong: the problem
// outlived the revert by six more runs, and the package diagnostic eventually showed the
// attachments arriving intact and the generation ending on end_turn, never truncated. The
// parser had nothing to do with it - the model was reading page 1 of each scan and stopping.
//
// It is needed again now. The page-by-page inventory pushed output past 15k tokens and the
// generation runs longer than the 10-minute cap, so the request is aborted near the end and
// the whole thing re-runs compacted: 15 minutes, and the weaker of the two reviews is the
// one that survives. Without streaming the server sends nothing until it is done, so a long
// healthy generation is indistinguishable from a hang. With it, the clock measures silence
// between chunks instead of total duration, and a request still producing tokens is never
// killed for taking its time.
const STREAM_ABOVE_MAX_TOKENS = Number(process.env.CLAUDE_STREAM_ABOVE_MAX_TOKENS || 8000);
// 20000, not 16000. The run that finally showed its own numbers used 14,378 output tokens of
// a 16,000 cap - 90% - and the review now has to enumerate what it finds inside each scanned
// attachment before it starts writing issues. Extended thinking is off here (temperature 0
// requires it), so the model has no scratchpad: anything it "works out" has to be written
// down. Asking it to read nine scanned pages without room to record what they say is asking
// it to skip them, which is exactly what it did. The 10-minute timeout absorbs the extra
// couple of minutes.
const REVIEW_MAX_TOKENS = Number(process.env.CLAUDE_REVIEW_MAX_TOKENS || 20000);
// 420k chars ≈ 110k tokens: a full 1040 package (current + prior return + consolidated
// 1099s + K-1s + estimate vouchers) fits without middle-truncation. The old 140k budget
// cut the middle of the current return, so forms like 8960/Sch D/8949 vanished and the
// reviewer flagged them as missing. The timeout-retry path still compacts to 80k.
const REVIEW_MAX_TOTAL_CHARS = Number(process.env.CLAUDE_REVIEW_MAX_TOTAL_CHARS || 420000);
const REVIEW_MAX_CHARS_PER_FILE = Number(process.env.CLAUDE_REVIEW_MAX_CHARS_PER_FILE || 160000);
const REVIEW_MIN_CHARS_PER_FILE = Number(process.env.CLAUDE_REVIEW_MIN_CHARS_PER_FILE || 6000);
const REVIEW_RETRY_MAX_TOTAL_CHARS = Number(process.env.CLAUDE_REVIEW_RETRY_MAX_TOTAL_CHARS || 80000);
const REVIEW_RETRY_MAX_CHARS_PER_FILE = Number(process.env.CLAUDE_REVIEW_RETRY_MAX_CHARS_PER_FILE || 30000);
const REVIEW_RETRY_MIN_CHARS_PER_FILE = Number(process.env.CLAUDE_REVIEW_RETRY_MIN_CHARS_PER_FILE || 3000);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 64);
const MAX_BODY_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
// DATA_DIR is env-overridable so the automated test suite can boot the real server
// against a throwaway data directory. Production (env unset) behaves exactly as before.
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const CLIENTS_PATH = path.join(DATA_DIR, "clients.json");
const FIRM_LIBRARY_PATH = path.join(DATA_DIR, "firm_library.json");
const DEADLINES_PATH = path.join(DATA_DIR, "deadlines.json");
const AI_LEARNING_PATH = path.join(DATA_DIR, "ai_learning.json");
const FEEDBACK_PATH = path.join(DATA_DIR, "feedback.json");
const COST_LOG_PATH = path.join(DATA_DIR, "cost_log.json");
const AUDIT_LOG_PATH = path.join(DATA_DIR, "audit_log.json");
const INCIDENTS_PATH = path.join(DATA_DIR, "incidents.json");
const ALERT_WEBHOOK_URL = String(process.env.ALERT_WEBHOOK_URL || "").trim();
const USER_CREDITS_PATH = path.join(DATA_DIR, "user_credits.json");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const TRACKER_PATH = path.join(DATA_DIR, "tracker.json");
const ACCESS_REQUESTS_PATH = path.join(DATA_DIR, "access_requests.json");
const CLIENT_FILES_DIR = path.join(DATA_DIR, "client_files");
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const LOCAL_SECRETS_PATH = path.join(DATA_DIR, "local-secrets.json");
const LOCAL_SECRETS = loadLocalSecrets();
const GOOGLE_TOKEN_PATH = path.join(DATA_DIR, "google_tokens.json");
const QBO_TOKEN_PATH = path.join(DATA_DIR, "qbo_tokens.json");
const ACCOUNTING_TOKEN_PATH = path.join(DATA_DIR, "accounting_tokens.json");
let databasePool = null;
let databaseReady = false;
let databaseHydrating = false;
let databaseSyncQueue = Promise.resolve();
let databaseSyncLastError = "";
const MASTER_REVIEW_PROMPT_PATH = path.join(ROOT, "senior-review-master-prompt.txt");
const KNOWLEDGE_BASE_DIR = path.resolve(process.env.KNOWLEDGE_BASE_DIR || path.join(ROOT, "knowledge_base"));
const REVIEW_EXAMPLES_DIR = path.resolve(process.env.REVIEW_EXAMPLES_DIR || path.join(ROOT, "review_examples"));
const READABLE_CONTEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json"]);
const BACKEND_ONLY_CONTEXT_FILES = new Map([
  ["knowledge_base", new Set(["IRS_Instructions_URL_Reference 2025 - 2024.docx.txt".toLowerCase()])],
  ["review_examples", new Set(["Agent notes _1_.docx.txt".toLowerCase()])],
]);
const MAX_CONTEXT_FILES = Number(process.env.MAX_CONTEXT_FILES || 30);
const MAX_CONTEXT_CHARS_PER_FILE = Number(process.env.MAX_CONTEXT_CHARS_PER_FILE || 250000);
const MAX_CONTEXT_UPLOAD_FILES = Number(process.env.MAX_CONTEXT_UPLOAD_FILES || 50);
const MAX_CONTEXT_UPLOAD_CHARS_PER_FILE = Number(process.env.MAX_CONTEXT_UPLOAD_CHARS_PER_FILE || 250000);
const MAX_FILES_PER_REVIEW = Number(process.env.MAX_FILES_PER_REVIEW || 15);
const MAX_DRIVE_FOLDER_FILES = Number(process.env.MAX_DRIVE_FOLDER_FILES || 200);
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const AUTH_REQUIRED = String(process.env.AUTH_REQUIRED || "true").toLowerCase() !== "false";
const AUTH_SECRET = String(process.env.AUTH_SECRET || LOCAL_SECRETS.authSecret || "codex-local-auth-secret-please-change-2026");
const AUTH_USERS_JSON = String(process.env.AUTH_USERS_JSON || LOCAL_SECRETS.authUsersJson || '[{"username":"augusto","passwordHash":"pbkdf2$120000$codex-local-salt$nzYSc-lwbuGw7zPOzwosdfjkfab8wjNn1VTiTtLJbEo","role":"admin","displayName":"Augusto"}]');
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "tax_review_session";
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 8 * 60 * 60);
const COOKIE_SECURE = String(process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === "production" ? "true" : "false")).toLowerCase() === "true";
const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX || 8);
const API_RATE_LIMIT_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || 240);
const USER_AI_RATE_LIMIT_WINDOW_MS = Number(process.env.USER_AI_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000);
const USER_AI_RATE_LIMIT_MAX = Number(process.env.USER_AI_RATE_LIMIT_MAX || 80);
const USER_UPLOAD_RATE_LIMIT_WINDOW_MS = Number(process.env.USER_UPLOAD_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000);
const USER_UPLOAD_RATE_LIMIT_MAX = Number(process.env.USER_UPLOAD_RATE_LIMIT_MAX || 160);
const ADMIN_WRITE_RATE_LIMIT_WINDOW_MS = Number(process.env.ADMIN_WRITE_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000);
const ADMIN_WRITE_RATE_LIMIT_MAX = Number(process.env.ADMIN_WRITE_RATE_LIMIT_MAX || 40);
const ADMIN_READ_RATE_LIMIT_WINDOW_MS = Number(process.env.ADMIN_READ_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const ADMIN_READ_RATE_LIMIT_MAX = Number(process.env.ADMIN_READ_RATE_LIMIT_MAX || 120);
const TOKEN_ENCRYPTION_KEY = String(process.env.TOKEN_ENCRYPTION_KEY || LOCAL_SECRETS.tokenEncryptionKey || "").trim();
const TOKEN_ENCRYPTION_KEY_BYTES = tokenEncryptionKeyBytes(TOKEN_ENCRYPTION_KEY);
const DATABASE_PERSISTENCE_ENABLED = isDatabaseConfigured();
const DEFAULT_TENANT_ID = String(process.env.DEFAULT_TENANT_ID || "rag-tax-ai").trim() || "rag-tax-ai";
const DEFAULT_TENANT_NAME = String(process.env.DEFAULT_TENANT_NAME || "RAG Tax AI").trim() || "RAG Tax AI";
const ADMIN_2FA_ENABLED = String(process.env.ADMIN_2FA_ENABLED || "false").toLowerCase() === "true";
const ADMIN_2FA_CODE_TTL_MS = Number(process.env.ADMIN_2FA_CODE_TTL_MS || 10 * 60 * 1000);
const ADMIN_2FA_MAX_ATTEMPTS = Number(process.env.ADMIN_2FA_MAX_ATTEMPTS || 5);
const ADMIN_2FA_EMAIL = String(process.env.ADMIN_2FA_EMAIL || process.env.ACCESS_REQUEST_NOTIFY_EMAIL || "").trim();
const CLIENT_FILE_PERSISTENCE_ENABLED = String(process.env.ENABLE_CLIENT_FILE_PERSISTENCE || "false").toLowerCase() === "true";
const CLIENT_FILE_RETENTION_DAYS = Number(process.env.CLIENT_FILE_RETENTION_DAYS || 365);
const WEB_SEARCH_ENABLED = String(process.env.ENABLE_CLAUDE_WEB_SEARCH || "true").toLowerCase() === "true";
const WEB_SEARCH_MAX_USES = Number(process.env.CLAUDE_WEB_SEARCH_MAX_USES || 3);
const WEB_SEARCH_ALLOWED_DOMAINS = String(process.env.CLAUDE_WEB_ALLOWED_DOMAINS || "")
  .split(",").map((domain) => domain.trim()).filter(Boolean);
const CLAUDE_INPUT_COST_PER_MTOK = Number(process.env.CLAUDE_INPUT_COST_PER_MTOK || 3);
const CLAUDE_OUTPUT_COST_PER_MTOK = Number(process.env.CLAUDE_OUTPUT_COST_PER_MTOK || 15);
const MODEL_COSTS = {
  "claude-sonnet-4-20250514": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-sonnet-4-5-20250929": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-sonnet-4-5-20251001": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
  "claude-3-5-sonnet-20241022": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-3-5-sonnet-latest": { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  "claude-opus-4-20250514": { inputPerMTok: 15, outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  "claude-opus-4-1": { inputPerMTok: 15, outputPerMTok: 75, cacheWritePerMTok: 18.75, cacheReadPerMTok: 1.5 },
  "claude-opus-4-5": { inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
};
const ANTHROPIC_API_KEY = String(process.env.ANTHROPIC_API_KEY || LOCAL_SECRETS.anthropicApiKey || "").trim();
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || LOCAL_SECRETS.googleClientId || "").trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || LOCAL_SECRETS.googleClientSecret || "").trim();
const GOOGLE_REDIRECT_URI = String(process.env.GOOGLE_REDIRECT_URI || LOCAL_SECRETS.googleRedirectUri || `http://${HOST === "0.0.0.0" ? "127.0.0.1" : HOST}:${PORT}/auth/google/callback`).trim();
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_USERINFO_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
const GOOGLE_OAUTH_SCOPE = (process.env.GOOGLE_OAUTH_SCOPES || [GOOGLE_USERINFO_SCOPE, GOOGLE_DRIVE_SCOPE, GOOGLE_GMAIL_COMPOSE_SCOPE].join(" "))
  .split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean).join(" ");
const GMAIL_SEND_ENABLED = String(process.env.ENABLE_GMAIL_SEND || "false").toLowerCase() === "true";
const QBO_CLIENT_ID = String(process.env.QBO_CLIENT_ID || LOCAL_SECRETS.qboClientId || "").trim();
const QBO_CLIENT_SECRET = String(process.env.QBO_CLIENT_SECRET || LOCAL_SECRETS.qboClientSecret || "").trim();
const QBO_REDIRECT_URI = String(process.env.QBO_REDIRECT_URI || LOCAL_SECRETS.qboRedirectUri || `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/auth/accounting/quickbooks/callback`).trim();
const QBO_ENVIRONMENT = String(process.env.QBO_ENVIRONMENT || LOCAL_SECRETS.qboEnvironment || "sandbox").trim();
const QBO_SCOPES = "com.intuit.quickbooks.accounting openid profile email";
if (ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
const MASTER_REVIEW_PROMPT = loadMasterReviewPrompt();
ensureDatabase();
const researchHistories = new Map();
const rateLimitBuckets = new Map();
const adminTwoFactorChallenges = new Map();

const ACCOUNTING_SOFTWARE = {
  quickbooks: {
    id: "quickbooks",
    name: "QuickBooks Online",
    vendor: "Intuit",
    logo: "QBO",
    type: "cloud",
    authType: "oauth2",
    setupUrl: "https://developer.intuit.com",
    envVars: ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI"],
    scopes: ["com.intuit.quickbooks.accounting"],
    reports: ["ProfitAndLoss", "ProfitAndLossDetail", "BalanceSheet", "BalanceSheetDetail", "TrialBalance", "GeneralLedger", "CashFlow", "AgedReceivables", "AgedPayables", "ExpensesByVendorSummary", "IncomeByCustomerSummary", "PayrollSummary"],
    supportsMultiCompany: true,
    supportsCash: true,
  },
  xero: {
    id: "xero",
    name: "Xero",
    vendor: "Xero",
    logo: "XE",
    type: "cloud",
    authType: "oauth2",
    setupUrl: "https://developer.xero.com",
    envVars: ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REDIRECT_URI"],
    scopes: ["openid", "profile", "email", "accounting.reports.read", "accounting.settings.read", "offline_access"],
    reports: ["ProfitAndLoss", "BalanceSheet", "TrialBalance", "CashSummary", "AgedReceivablesByContact", "AgedPayablesByContact", "ExecutiveSummary"],
    supportsMultiCompany: true,
    supportsCash: true,
  },
  manual_upload: {
    id: "manual_upload",
    name: "Manual Upload",
    vendor: "Fallback",
    logo: "UP",
    type: "manual",
    authType: "none",
    setupUrl: "",
    envVars: [],
    scopes: [],
    reports: [],
    supportsMultiCompany: false,
    supportsCash: true,
    note: "Always available. Upload exported reports manually.",
  },
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

// ---------------------------------------------------------------------------
// Corrections DB â€” 47 historical corrections from Agent_notes.docx
// ---------------------------------------------------------------------------
function loadLocalSecrets() {
  if (!fsSync.existsSync(LOCAL_SECRETS_PATH)) return {};
  try {
    const rawText = fsSync.readFileSync(LOCAL_SECRETS_PATH, "utf8").replace(/^\uFEFF/, "");
    const raw = JSON.parse(rawText);
    return {
      anthropicApiKey: readLocalSecretValue(raw.anthropicApiKey),
      googleClientId: String(raw.googleClientId || ""),
      googleClientSecret: readLocalSecretValue(raw.googleClientSecret),
      qboClientId: String(raw.qboClientId || ""),
      qboClientSecret: readLocalSecretValue(raw.qboClientSecret),
      qboRedirectUri: String(raw.qboRedirectUri || ""),
      qboEnvironment: String(raw.qboEnvironment || ""),
      authSecret: readLocalSecretValue(raw.authSecret),
      authUsersJson: String(raw.authUsersJson || ""),
    };
  } catch (error) {
    console.warn("Could not read data/local-secrets.json:", error.message);
    return {};
  }
}

function loadEnvFile(filePath) {
  try {
    if (!fsSync.existsSync(filePath)) return;
    const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn("[Env] Could not load .env:", error.message);
  }
}

function readLocalSecretValue(value) {
  const text = String(value || "");
  if (!text) return "";
  if (!isLikelyWindowsEncryptedSecret(text)) return text;
  const decrypted = decryptWindowsLocalSecret(text);
  return decrypted || "";
}

function isLikelyWindowsEncryptedSecret(value) {
  const text = String(value || "").trim();
  return text.length > 120 && /^[0-9a-f]+$/i.test(text) && text.startsWith("01000000d08c9ddf");
}

function decryptWindowsLocalSecret(value) {
  if (process.platform !== "win32") return "";
  try {
    const script = [
      "$secure = ConvertTo-SecureString -String $env:LOCAL_SECRET_VALUE",
      "$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
      "try { [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }",
    ].join("; ");
    return childProcess.execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      env: { ...process.env, LOCAL_SECRET_VALUE: value },
      timeout: 5000,
      windowsHide: true,
    }).trim();
  } catch (_) {
    return "";
  }
}

const CORRECTIONS_DB = [
  { stage:"initial", type:"Schedule", client:"Match Point Enterprise", desc:"Interests and charitable contributions missing from book-to-tax tab" },
  { stage:"initial", type:"Schedule", client:"Match Point Enterprise", desc:"Bonus incorrectly in line 13 rents â€” needs reclassification" },
  { stage:"initial", type:"Schedule", client:"Match Point Enterprise", desc:"Guaranteed payments should move to line 10 page 1 of 1065" },
  { stage:"initial", type:"Schedule", client:"Match Point Enterprise", desc:"Penalties should be classified as non-deductible expenses" },
  { stage:"initial", type:"Address",  client:"Venty Fan",              desc:"Address changed to 6900 Westcliff Dr #503 Las Vegas NV â€” verify" },
  { stage:"initial", type:"Income",   client:"Venty Fan",              desc:"Interest income should move from 1120 page 1 to Schedule K" },
  { stage:"initial", type:"Income",   client:"Venty Fan",              desc:"1125-E: Matt $150k vs K1 $120k â€” Philip missing from officer comp" },
  { stage:"initial", type:"Address",  client:"Champion Media Solutions", desc:"Bradley's address on K1 needs to be updated" },
  { stage:"initial", type:"Schedule", client:"Champion Media Solutions", desc:"Schedule G ownership percentage not updated" },
  { stage:"initial", type:"Address",  client:"JXL Creative LLC",       desc:"Form CT-60 address does not match prior year" },
  { stage:"initial", type:"Schedule", client:"JXL Creative LLC",       desc:"Form CT-399 must be attached to resolve efile errors" },
  { stage:"initial", type:"Schedule", client:"Icon Digital LLC",       desc:"Balance sheet out of balance by $24,006 in NC" },
  { stage:"initial", type:"Income",   client:"Icon Digital LLC",       desc:"Interest income moved from other income to Schedule K" },
  { stage:"initial", type:"Schedule", client:"CPH International",      desc:"Credit card credits â€” other income vs credit classification unclear" },
  { stage:"initial", type:"Schedule", client:"Manaus LLC",             desc:"Retirement -$15,235 in other deductions should be line 17 positive" },
  { stage:"initial", type:"Schedule", client:"Blueberry Fence LLC",    desc:"Partnership representative must be updated before filing" },
  { stage:"initial", type:"Schedule", client:"Blueberry Fence LLC",    desc:"Only 1 K1 for NY â€” should have one per partner" },
  { stage:"initial", type:"Schedule", client:"JCLewis Advisory",       desc:"Schedule L is not balanced" },
  { stage:"initial", type:"Schedule", client:"The Hive",               desc:"NJ depreciation override method unknown" },
  { stage:"initial", type:"Address",  client:"The Hive",               desc:"Address changed to Hoboken â€” new bank account info missing" },
  { stage:"initial", type:"Schedule", client:"Groovy Bean Company",    desc:"Form 7203 PY ending does not match CY beginning balance" },
  { stage:"initial", type:"Schedule", client:"Groovy Bean Company",    desc:"NM apportionment changed to 100% from 0% â€” needs verification" },
  { stage:"initial", type:"Schedule", client:"KT's BBQ",               desc:"Form 7203 and M2 beginning balance not matching TY 2024" },
  { stage:"initial", type:"TIN",      client:"Lazy Cow Media LLC",     desc:"Shareholder SSN changed from 392-11-1969 to 843-44-1020" },
  { stage:"initial", type:"Schedule", client:"Lazy Cow Media LLC",     desc:"R&D expense in other deductions should be R&D credit (Form 6765)" },
  { stage:"initial", type:"Schedule", client:"Muse Aesthetics",        desc:"Georgia Withholding Tax and Sales Tax Registration Numbers missing" },
  { stage:"initial", type:"Schedule", client:"Fleek Lab Inc",          desc:"M3 efile error â€” duplicate PY amortization suspected" },
  { stage:"initial", type:"Schedule", client:"Fleek Lab Inc",          desc:"Gain on sale -$2.8M and unrealized gain -$1.3M pending details" },
  { stage:"initial", type:"Schedule", client:"Ebite Inc",              desc:"BS and P&L not matching QBO" },
  { stage:"initial", type:"Schedule", client:"1501 Inc",               desc:"Accounting method changed from cash to accrual to match PY" },
  { stage:"initial", type:"Schedule", client:"Barker Corp",            desc:"Accounting method changed from cash to accrual to match PY" },
  { stage:"initial", type:"Schedule", client:"Madre Nature LLC",       desc:"TX apportionment jumped from 8% to 100% â€” needs client verification" },
  { stage:"initial", type:"Schedule", client:"Organic Bunny",          desc:"Net assets: $149,135 on return vs expected $149,320" },
  { stage:"initial", type:"Schedule", client:"Psychedelic Games",      desc:"Loan payments in deductions â€” moved to interest expense" },
  { stage:"manager", type:"Schedule", client:"Coda Capital",           desc:"Distributions should be income then offset via other deductions" },
  { stage:"manager", type:"Schedule", client:"Vital Pet Life",         desc:"Tesla Model Y 2025 lease â€” business use % and addback unclear" },
  { stage:"manager", type:"Schedule", client:"Champion Media",         desc:"R&D Study done â€” forms 3800, 4562 and 6765 added to ProConnect" },
  { stage:"manager", type:"Schedule", client:"Lang.ai",                desc:"NY/NYC/CA apportionment does not match financial report" },
  { stage:"manager", type:"Schedule", client:"Uptalent",               desc:"Foreign-owned corp efile errors â€” Form 5472 owner amounts missing" },
  { stage:"manager", type:"Schedule", client:"Barun Corp",             desc:"R&D study pending â€” payroll info needed for Form 6765" },
  { stage:"manager", type:"Schedule", client:"Groovy Bean Company",    desc:"FICA tip credit not found â€” location and amount needed" },
  { stage:"manager", type:"Schedule", client:"Jamison Kirk",           desc:"Child Care donation in itemized deductions â€” should be credits" },
  { stage:"manager", type:"Schedule", client:"Madre Nature LLC",       desc:"R&D credit payroll info pending" },
  { stage:"final",   type:"TIN",      client:"Wisdom of Age",          desc:"Driver's licence expired 2025 â€” new info needed for efile" },
  { stage:"final",   type:"TIN",      client:"Stabile Nicholas",       desc:"Missing W2 from M Booyh & Associates ($31,699) and NY PIN missing" },
  { stage:"final",   type:"Schedule", client:"Swulius Amanda",         desc:"Form 7203 basis does not match Organic Bunny 1120s" },
  { stage:"final",   type:"Schedule", client:"Ebite Inc",              desc:"DE apportionment override placement incorrect vs PY" },
  { stage:"final",   type:"Schedule", client:"Profound Platform",      desc:"R&D expense in deductions but study was cancelled per client" },
];

const TAX_SOFTWARE_LIST = [
  {
    id: "proconnect",
    name: "ProConnect Tax",
    vendor: "Intuit",
    type: "cloud",
    logo: "PT",
    navigationStyle: "left_sidebar",
    description: "Cloud-based. Left sidebar navigation with collapsible sections.",
    screenTerminology: { screen: "Input screen", section: "Section", field: "Field", navigate: "Go to [Screen] in the left sidebar > [Section] > [Field]" },
    commonScreenPaths: {
      clientInfo: "General > Client Information",
      efiling: "General > Electronic Filing",
      grossReceipts: "Income > Gross Receipts",
      cogs: "Income > Cost of Goods Sold",
      officerComp: "Deductions > Compensation of Officers (1125-E)",
      depreciation: "Deductions > Depreciation (4562)",
      otherDeductions: "Deductions > Other Deductions",
      scheduleL: "Balance Sheet > Assets / Liabilities",
      scheduleM1: "Reconciliation > Schedule M-1",
      scheduleM3: "Reconciliation > Schedule M-3",
      scheduleK: "Schedule K > Income (Loss)",
      stateReturn: "State & Local > [State] > [Screen]",
      investments: "Income > Investment Income",
      dispositions: "Revenue > Dispositions (Schedule D)",
    },
  },
  {
    id: "lacerte",
    name: "Lacerte",
    vendor: "Intuit",
    type: "desktop",
    logo: "LT",
    navigationStyle: "screen_numbers",
    description: "Desktop software. Screens accessed by number from the left panel.",
    screenTerminology: { screen: "Screen", section: "Line", field: "Line", navigate: "Go to Screen [N] ([Screen Name]) > Line [N]" },
    commonScreenPaths: {
      clientInfo: "Screen 1 (Client Information)",
      efiling: "Screen 2 (Electronic Filing)",
      grossReceipts: "Screen 14 (Income)",
      cogs: "Screen 15 (Cost of Goods Sold)",
      officerComp: "Screen 23 (Compensation of Officers)",
      depreciation: "Screen 22 (Depreciation)",
      otherDeductions: "Screen 25 (Other Deductions)",
      scheduleL: "Screen 29 (Balance Sheet)",
      scheduleM1: "Screen 31 (Schedule M-1)",
      scheduleM3: "Screen 31A (Schedule M-3)",
      scheduleK: "Screen 20 (Schedule K)",
      stateReturn: "State Screens (left panel, state abbreviation)",
      investments: "Screen 11 (Interest and Dividends)",
      dispositions: "Screen 17D (Capital Gains and Losses)",
    },
  },
  {
    id: "proseries",
    name: "ProSeries Professional",
    vendor: "Intuit",
    type: "desktop",
    logo: "PS",
    navigationStyle: "form_based",
    description: "Desktop software. Navigate by form name. Supports Interview mode and Forms mode.",
    screenTerminology: { screen: "Form", section: "Section", field: "Line", navigate: "Open [Form name] from the form list > [Section] > Line [N]" },
    commonScreenPaths: {
      clientInfo: "Client Information worksheet",
      efiling: "Electronic Filing worksheet",
      grossReceipts: "Form 1120 > Page 1 > Line 1",
      cogs: "Form 1125-A",
      officerComp: "Form 1125-E",
      depreciation: "Form 4562",
      otherDeductions: "Form 1120 > Page 1 > Line 26",
      scheduleL: "Form 1120 > Schedule L",
      scheduleM1: "Form 1120 > Schedule M-1",
      scheduleM3: "Schedule M-3",
      scheduleK: "Form 1065 > Schedule K",
      stateReturn: "State form ([State abbreviation])",
      investments: "Schedule B (Interest and Dividends)",
      dispositions: "Schedule D / Form 8949",
    },
  },
  {
    id: "drake",
    name: "Drake Tax",
    vendor: "Drake Software",
    type: "desktop",
    logo: "DT",
    navigationStyle: "screen_codes",
    description: "Desktop software. Data entry screens accessed by typing a screen code.",
    screenTerminology: { screen: "Screen", section: "Field", field: "Field", navigate: "Type screen code [CODE] in the data entry area > [Field]" },
    commonScreenPaths: {
      clientInfo: "Screen: DATA (Client Data Entry)",
      efiling: "Screen: EF (Electronic Filing)",
      grossReceipts: "Screen: 1120 (Corporation Return) > Line 1",
      cogs: "Screen: A (Schedule A / COGS)",
      officerComp: "Screen: E (Form 1125-E)",
      depreciation: "Screen: 4562 (Depreciation)",
      otherDeductions: "Screen: OD (Other Deductions)",
      scheduleL: "Screen: L (Balance Sheet)",
      scheduleM1: "Screen: M1 (Schedule M-1)",
      scheduleM3: "Screen: M3 (Schedule M-3)",
      scheduleK: "Screen: K (Schedule K)",
      stateReturn: "State screen (state abbreviation as code)",
      investments: "Screen: INT or DIV",
      dispositions: "Screen: D (Schedule D) or 8949",
    },
  },
  {
    id: "ultratax",
    name: "UltraTax CS",
    vendor: "Thomson Reuters",
    type: "desktop",
    logo: "UT",
    navigationStyle: "folder_tree",
    description: "Desktop software. Organized in folders in the left panel.",
    screenTerminology: { screen: "Input screen", section: "Section", field: "Field", navigate: "Open [Folder] in the left panel > [Screen name] > [Field]" },
    commonScreenPaths: {
      clientInfo: "General folder > Client Information",
      efiling: "General folder > Electronic Filing",
      grossReceipts: "Income folder > Gross Receipts",
      cogs: "Income folder > Cost of Goods Sold",
      officerComp: "Deductions folder > Officer Compensation",
      depreciation: "Deductions folder > Depreciation (4562)",
      otherDeductions: "Deductions folder > Other Deductions",
      scheduleL: "Balance Sheet folder > Schedule L",
      scheduleM1: "Reconciliation folder > Schedule M-1",
      scheduleM3: "Reconciliation folder > Schedule M-3",
      scheduleK: "K Folder > Schedule K Input",
      stateReturn: "[State] folder > applicable screens",
      investments: "Income folder > Interest / Dividends",
      dispositions: "Income folder > Schedule D",
    },
  },
  {
    id: "cch_axcess",
    name: "CCH Axcess Tax",
    vendor: "Wolters Kluwer",
    type: "cloud",
    logo: "AX",
    navigationStyle: "interview_tabs",
    description: "Cloud-based. Navigate using Interview tabs or Worksheet view.",
    screenTerminology: { screen: "Worksheet", section: "Tab", field: "Line", navigate: "Go to [Tab name] > [Worksheet] > Line [N]" },
    commonScreenPaths: {
      clientInfo: "General > Identification tab",
      efiling: "General > Electronic Filing tab",
      grossReceipts: "Income/Deductions > Income tab > Gross Receipts line",
      cogs: "Income/Deductions > COGS worksheet",
      officerComp: "Income/Deductions > Officers Compensation worksheet",
      depreciation: "Income/Deductions > Depreciation worksheet (4562)",
      otherDeductions: "Income/Deductions > Other Deductions worksheet",
      scheduleL: "Balance Sheet > Schedule L tab",
      scheduleM1: "Reconciliation > Schedule M-1 tab",
      scheduleM3: "Reconciliation > Schedule M-3 tab",
      scheduleK: "Schedule K tab",
      stateReturn: "States tab > [State] > applicable worksheet",
      investments: "Income/Deductions > Interest/Dividends tab",
      dispositions: "Income/Deductions > Schedule D worksheet",
    },
  },
  {
    id: "cch_prosystem",
    name: "CCH ProSystem fx Tax",
    vendor: "Wolters Kluwer",
    type: "desktop",
    logo: "FX",
    navigationStyle: "interview_tabs",
    description: "Desktop software. Interview-based navigation with tabs and worksheets.",
    screenTerminology: { screen: "Worksheet", section: "Interview tab", field: "Line", navigate: "Interview tab [Name] > Worksheet [Name] > Line [N]" },
    commonScreenPaths: {
      clientInfo: "General tab > Identification worksheet",
      efiling: "General tab > Electronic Filing worksheet",
      grossReceipts: "Income tab > Gross Receipts",
      cogs: "Income tab > COGS worksheet",
      officerComp: "Income tab > Officer Compensation worksheet",
      depreciation: "Deductions tab > Depreciation worksheet",
      otherDeductions: "Deductions tab > Other Deductions",
      scheduleL: "Balance Sheet tab > Schedule L",
      scheduleM1: "Schedule M tab > M-1 worksheet",
      scheduleM3: "Schedule M tab > M-3 worksheet",
      scheduleK: "Schedule K tab",
      stateReturn: "States tab > [State] worksheets",
      investments: "Income tab > Interest and Dividends",
      dispositions: "Income tab > Schedule D worksheet",
    },
  },
  {
    id: "gosystem",
    name: "GoSystem RS",
    vendor: "Thomson Reuters",
    type: "cloud",
    logo: "GS",
    navigationStyle: "category_folders",
    description: "Cloud-based. Categories in the left navigation panel.",
    screenTerminology: { screen: "Category", section: "Screen", field: "Field", navigate: "Left panel > [Category] > [Screen] > [Field]" },
    commonScreenPaths: {
      clientInfo: "General > Identification",
      efiling: "General > Electronic Filing",
      grossReceipts: "Income > Business Income > Gross Receipts",
      cogs: "Income > Cost of Goods Sold",
      officerComp: "Deductions > Officer Compensation",
      depreciation: "Deductions > Depreciation",
      otherDeductions: "Deductions > Other Deductions",
      scheduleL: "Balance Sheet > Schedule L",
      scheduleM1: "Reconciliation > M-1",
      scheduleM3: "Reconciliation > M-3",
      scheduleK: "Schedule K > Income",
      stateReturn: "States > [State] > relevant category",
      investments: "Income > Interest and Dividends",
      dispositions: "Income > Gains and Losses",
    },
  },
  {
    id: "taxslayer_pro",
    name: "TaxSlayer Pro",
    vendor: "TaxSlayer",
    type: "desktop",
    logo: "TS",
    navigationStyle: "menu_based",
    description: "Desktop software. Menu-driven navigation from the main menu.",
    screenTerminology: { screen: "Menu option", section: "Section", field: "Field", navigate: "Main Menu > [Option] > [Sub-option] > [Field]" },
    commonScreenPaths: {
      clientInfo: "Main Menu > Client Data > Personal Information",
      efiling: "Main Menu > Electronic Filing",
      grossReceipts: "Business Return Menu > Income > Gross Receipts",
      cogs: "Business Return Menu > Cost of Goods Sold",
      officerComp: "Business Return Menu > Officer Compensation",
      depreciation: "Business Return Menu > Depreciation (4562)",
      otherDeductions: "Business Return Menu > Other Deductions",
      scheduleL: "Business Return Menu > Balance Sheet",
      scheduleM1: "Business Return Menu > Schedule M-1",
      scheduleM3: "Business Return Menu > Schedule M-3",
      scheduleK: "Partnership Menu > Schedule K",
      stateReturn: "State Return Menu > [State]",
      investments: "Income Menu > Interest/Dividends",
      dispositions: "Income Menu > Capital Gains",
    },
  },
  {
    id: "atx",
    name: "ATX",
    vendor: "Wolters Kluwer",
    type: "desktop",
    logo: "AT",
    navigationStyle: "form_tree",
    description: "Desktop software. Forms listed in a tree on the left.",
    screenTerminology: { screen: "Form", section: "Part", field: "Line", navigate: "Left form tree > [Form name] > [Part/Page] > Line [N]" },
    commonScreenPaths: {
      clientInfo: "Client Information form",
      efiling: "EF Information form",
      grossReceipts: "Form 1120 > Page 1 > Line 1",
      cogs: "Form 1125-A",
      officerComp: "Form 1125-E",
      depreciation: "Form 4562",
      otherDeductions: "Form 1120 > Page 1 > Other Deductions statement",
      scheduleL: "Form 1120 > Schedule L",
      scheduleM1: "Form 1120 > Schedule M-1",
      scheduleM3: "Schedule M-3 form",
      scheduleK: "Form 1065 > Schedule K",
      stateReturn: "State form tree > [State] forms",
      investments: "Schedule B form",
      dispositions: "Schedule D / Form 8949",
    },
  },
  {
    id: "other",
    name: "Other / Not Listed",
    vendor: "Other",
    type: "generic",
    logo: "OT",
    navigationStyle: "generic",
    description: "Generic instructions using standard IRS form and line references.",
    screenTerminology: { screen: "Section", section: "Section", field: "Line", navigate: "Navigate to [Form name] > [Section] > Line [N]" },
    commonScreenPaths: {
      clientInfo: "Client/Entity Information section",
      efiling: "Electronic Filing section",
      grossReceipts: "Form [X] > Income section > Gross Receipts (Line 1)",
      cogs: "Cost of Goods Sold section / Form 1125-A",
      officerComp: "Officer Compensation section / Form 1125-E",
      depreciation: "Depreciation section / Form 4562",
      otherDeductions: "Other Deductions section",
      scheduleL: "Balance Sheet / Schedule L",
      scheduleM1: "Book-to-Tax Reconciliation / Schedule M-1",
      scheduleM3: "Schedule M-3",
      scheduleK: "Schedule K",
      stateReturn: "State return section",
      investments: "Interest and Dividend Income section",
      dispositions: "Capital Gains section / Schedule D",
    },
  },
];

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    res.corsOrigin = getAllowedOrigin(req);
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") { sendCorsPreflight(res); return; }
    if (req.method === "GET" && req.url === "/login") { await handleLoginPage(req, res); return; }
    if (req.method === "GET" && req.url === "/request-access") { await handleAccessRequestPage(req, res); return; }
    // Public marketing page: visitors without a session get the landing; authenticated
    // users fall through to the app exactly as before. If landing.html is missing, the
    // old behavior (redirect to /login) is preserved.
    if (req.method === "GET" && requestUrl.pathname === "/" && !getSession(req)) { await handleLandingPage(req, res); return; }
    if (isApiRequest(req) && req.url !== "/api/login" && isRateLimited(req, "api", API_RATE_LIMIT_MAX, API_RATE_LIMIT_WINDOW_MS)) {
      sendJson(res, 429, { error: "Too many requests. Please wait a moment and try again." });
      return;
    }
    if (req.method === "POST" && req.url === "/api/login") { await handleLogin(req, res); return; }
    if (req.method === "POST" && req.url === "/api/access-request") { await handleAccessRequest(req, res); return; }
    if (req.method === "POST" && req.url === "/api/logout") { await handleLogout(req, res); return; }
    if (req.method === "GET" && req.url === "/api/auth/status") { await handleAuthStatus(req, res); return; }
    if (requestUrl.pathname === "/api/auth/change-password" && req.method === "POST") { await handleChangePassword(req, res); return; }
    if (req.method === "GET" && requestUrl.pathname === "/auth/google") { await handleGoogleAuth(req, res); return; }
    if (req.method === "GET" && requestUrl.pathname === "/auth/google/callback") { await handleGoogleCallback(req, res, requestUrl); return; }
    if (req.method === "GET" && requestUrl.pathname === "/auth/qbo") { await handleQboAuth(req, res); return; }
    if (req.method === "GET" && requestUrl.pathname === "/auth/qbo/callback") { await handleQboCallback(req, res, requestUrl); return; }
    if (req.method === "GET" && requestUrl.pathname.startsWith("/auth/accounting/")) { await handleAccountingAuthRoute(req, res, requestUrl); return; }
    if (req.method === "GET" && req.url === "/healthz") { await handleHealth(req, res); return; }
    if ((req.method === "GET" || req.method === "HEAD") && requestUrl.pathname.startsWith("/assets/")) { await serveStatic(req, res); return; }
    if ((req.method === "GET" || req.method === "HEAD") && FAVICON_ROUTES[requestUrl.pathname]) { await serveFavicon(req, res, FAVICON_ROUTES[requestUrl.pathname]); return; }
    if (req.method === "GET" && requestUrl.pathname === "/privacy") { servePrivacyPolicy(res); return; }
    if (req.method === "GET" && requestUrl.pathname === "/eula") { serveEula(res); return; }
    if (req.method === "GET" && requestUrl.pathname === "/terms") { serveEula(res); return; }
    if ((req.method === "GET" || req.method === "HEAD") && requestUrl.pathname === "/site.webmanifest") { await serveWebManifest(req, res); return; }
    if (!requireAuthenticated(req, res)) return;
    if (!requireFineGrainedRateLimit(req, res, requestUrl)) return;
    if (isTokenConsumingRoute(req, requestUrl) && !requireUserSpendBudget(req, res)) return;
    if (isTokenConsumingRoute(req, requestUrl) && !(await requireCreditsForRoute(req, res, requestUrl))) return;
    if (isTokenConsumingRoute(req, requestUrl) && !acquireUserSlot(req, res)) return;
    // For token-consuming routes: set up AbortController, global slot, and release hooks.
    if (req._concurrencyUsername) {
      // Create an AbortController so handlers can cancel the Anthropic fetch when
      // the client disconnects, saving tokens on abandoned requests.
      const abortController = new AbortController();
      req._abortController = abortController;
      // Wait for a global Anthropic slot (max MAX_CONCURRENT_GLOBAL simultaneous calls).
      // If all slots are in use, this await parks the request in a queue until one frees
      // rather than rejecting it — the client waits but does not get an error.
      await acquireGlobalSlot();
      // IMPORTANT: listen on res (ServerResponse) not req (IncomingMessage).
      // req "close" fires when the request body stream is consumed — which happens
      // immediately after readJsonBody() reads the POST body, long before the
      // response is written. res "close" fires only when the actual TCP socket
      // closes prematurely (real client disconnect).
      res.once("finish", () => { releaseUserSlot(req); releaseGlobalSlot(); });
      res.once("close", () => {
        if (!res.writableEnded) {
          abortController.abort();
          const username = req._concurrencyUsername || "unknown";
          console.log(`[ABORTED] userId=${username} path=${requestUrl.pathname} reason=client_closed`);
        }
        releaseUserSlot(req);
        releaseGlobalSlot();
      });
    }
    if (requestUrl.pathname.startsWith("/api/credits")) { await handleCreditsApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/cost")) { await handleCostApi(req, res, requestUrl); return; }
    if (req.method === "POST" && req.url === "/api/research/chat") { await handleResearchChat(req, res); return; }
    if (req.method === "DELETE" && req.url === "/api/research/chat") { await handleResearchClear(req, res); return; }
    if (req.method === "POST" && req.url === "/api/review") { await handleReview(req, res); return; }
    if (req.method === "POST" && req.url === "/api/review/respond") { await handleReviewResponse(req, res); return; }
    if (req.method === "GET" && requestUrl.pathname === "/api/irs-instructions") { await handleIrsInstructions(req, res, requestUrl); return; }
    if (req.method === "POST" && req.url === "/api/prepare-workpaper") { await handlePrepareWorkpaper(req, res); return; }
    if (req.method === "POST" && req.url === "/api/preparation/export-drake") { await handlePreparationExportDrake(req, res); return; }
    if (req.method === "POST" && req.url === "/api/preparation/drake-generate") { await handleDrakeGenerate(req, res); return; }
    if (req.method === "POST" && req.url === "/api/preparation/data-entry-guide") { await handlePreparationDataEntryGuide(req, res); return; }
    if (req.method === "POST" && req.url === "/api/preparation/drake-ui-load") { await handleDrakeUiLoad(req, res); return; }
    if (req.method === "GET" && requestUrl.pathname.startsWith("/api/estimated-taxes/templates/")) { await handleEstimatedTaxesTemplateDownload(req, res, requestUrl); return; }
    if (req.method === "POST" && req.url === "/api/estimated-taxes/detect-period") { await handleEstimatedTaxesDetectPeriod(req, res); return; }
    if (req.method === "POST" && req.url === "/api/estimated-taxes/calculate") { await handleEstimatedTaxesCalculate(req, res); return; }
    if (req.method === "POST" && req.url === "/api/extension/calculate") { await handleExtensionCalculate(req, res); return; }
    if (req.method === "POST" && req.url === "/api/planning/analyze") { await handlePlanningAnalyze(req, res); return; }
    if (req.method === "POST" && req.url === "/api/planning/scenarios") { await handlePlanningScenarios(req, res); return; }
    if (req.method === "POST" && req.url === "/api/planning/scenario") { await handlePlanningScenarioCustom(req, res); return; }
    if (req.method === "POST" && req.url === "/api/planning/recompute") { await handlePlanningRecompute(req, res); return; }
    if (req.method === "POST" && req.url === "/api/planning/opportunities") { await handlePlanningOpportunities(req, res); return; }
    if (req.method === "POST" && req.url === "/api/planning/deck") { await handlePlanningDeck(req, res); return; }
    if (requestUrl.pathname.startsWith("/api/planning/templates")) { await handlePlanningTemplatesApi(req, res, requestUrl); return; }
    if (req.method === "POST" && req.url === "/api/planning/generate") { await handlePlanningGenerate(req, res); return; }
    if (req.method === "POST" && req.url === "/api/planning/quarterly") { await handlePlanningQuarterly(req, res); return; }
    if (req.method === "POST" && req.url === "/api/planning/deck-html") { await handlePlanningDeckHtml(req, res); return; }
    if (requestUrl.pathname === "/api/planning/saved" || requestUrl.pathname.startsWith("/api/planning/saved/")) { await handlePlanningSaved(req, res, requestUrl); return; }
    if (req.method === "POST" && req.url === "/api/presentations/generate") { await handlePresentationsGenerate(req, res); return; }
    if (req.method === "POST" && req.url === "/api/calculations/run") { await handleCalculationsRun(req, res); return; }
    if (req.method === "POST" && req.url === "/api/notices") { await handleNotices(req, res); return; }
    if (req.method === "POST" && req.url === "/api/diagnostics") { await handleDiagnostics(req, res); return; }
    if (req.method === "POST" && req.url === "/api/organizer") { await handleOrganizer(req, res); return; }
    if (req.method === "POST" && req.url === "/api/deliverable") { await handleDeliverable(req, res); return; }
    if (req.method === "POST" && req.url === "/api/deliverable/email-draft") { await handleDeliverableEmailDraft(req, res); return; }
    if (req.method === "POST" && req.url === "/api/deliverable/load-client-folder") { await handleDeliverableLoadClientFolder(req, res); return; }
    if (req.method === "POST" && req.url === "/api/deliverable/generate-draft") { await handleDeliverableGenerateDraft(req, res); return; }
    if (req.method === "POST" && req.url === "/api/deliverable/send-gmail") { await handleDeliverableSendGmail(req, res); return; }
    if (req.method === "POST" && req.url === "/api/deliverable/create-gmail-draft") { await handleDeliverableCreateGmailDraft(req, res); return; }
    if (req.method === "GET" && req.url === "/api/deliverable/gmail-status") { await handleDeliverableGmailStatus(req, res); return; }
    if (req.method === "GET" && requestUrl.pathname === "/api/tax-software/list") { sendJson(res, 200, publicTaxSoftwareList()); return; }
    if (req.method === "GET" && requestUrl.pathname === "/api/preparation/archive") {
      const clientId = String(requestUrl.searchParams.get("clientId") || "").trim();
      if (!clientId) { sendJson(res, 400, { error: "clientId is required." }); return; }
      const client = readDb().clients?.[clientId];
      if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
      if (!requireOwnerAccess(req, res, clientOwner(client))) return;
      sendJson(res, 200, { archive: listArchive(CLIENT_FILES_DIR, clientId) });
      return;
    }
    if (req.method === "GET" && requestUrl.pathname === "/api/database/export") {
      if (!requireAdmin(req, res)) return;
      appendAuditLog(req, "database.export", { clients: Object.keys(readDb().clients || {}).length });
      sendJson(res, 200, readDb());
      return;
    }
    if (req.method === "DELETE" && requestUrl.pathname === "/api/database") {
      if (!requireAdmin(req, res)) return;
      appendAuditLog(req, "database.delete_all", {});
      writeDb({ clients: {}, sessions: {} });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname.startsWith("/api/library")) {
      if (req.method !== "GET" && !requireAdmin(req, res)) return;
      await handleLibraryApi(req, res, requestUrl);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/deadlines")) { await handleDeadlinesApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/learning")) {
      if (!requireAdmin(req, res)) return;
      await handleLearningApi(req, res, requestUrl);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/feedback")) { await handleFeedbackApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/requests")) { await handleRequestsApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/database/drive-sync")) { await handleDatabaseDriveSyncApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/admin/audit-log")) {
      if (!requireAdmin(req, res)) return;
      const limit = Math.min(Number(requestUrl.searchParams.get("limit") || 200), 1000);
      sendJson(res, 200, { entries: readAuditEntries(limit) });
      return;
    }
    if (requestUrl.pathname === "/api/admin/health" && req.method === "GET") {
      if (!requireAdmin(req, res)) return;
      const incidents = (readJsonFile(INCIDENTS_PATH, { entries: [] }).entries || []).slice(-40).reverse();
      const weekAgo = Date.now() - 7 * 864e5;
      sendJson(res, 200, {
        uptimeSeconds: Math.round((Date.now() - BOOTED_AT) / 1000),
        bootedAt: new Date(BOOTED_AT).toISOString(),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        node: process.version,
        lastBackup: newestBackupInfo(),
        alertWebhookConfigured: Boolean(ALERT_WEBHOOK_URL),
        incidentsLast7d: incidents.filter((e) => e.type !== "boot" && new Date(e.at).getTime() > weekAgo).length,
        bootsLast7d: incidents.filter((e) => e.type === "boot" && new Date(e.at).getTime() > weekAgo).length,
        incidents: incidents.slice(0, 12),
      });
      return;
    }
    if (requestUrl.pathname.startsWith("/api/admin/budget-groups")) {
      if (!requireAdmin(req, res)) return;
      await handleAdminBudgetGroupsApi(req, res, requestUrl);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/admin/users")) {
      if (!requireUserManager(req, res)) return;
      await handleAdminUsersApi(req, res, requestUrl);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/tracker")) { await handleTrackerApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/pto")) { await handlePtoApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/clients")) { await handleClientApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/sessions")) { await handleSessionApi(req, res, requestUrl); return; }
    if (req.method === "GET" && req.url === "/api/config") { await handleConfig(req, res); return; }
    if (requestUrl.pathname.startsWith("/api/drive")) { await handleDriveApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/accounting")) { await handleAccountingApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/qbo")) { await handleQboApi(req, res, requestUrl); return; }
    if (requestUrl.pathname.startsWith("/api/cch")) { await handleCchApi(req, res, requestUrl); return; }
    if (req.method === "GET" && req.url.startsWith("/api/context")) { await handleContextList(req, res); return; }
    if (req.method === "POST" && req.url === "/api/context/upload") {
      if (!requireAdmin(req, res)) return;
      await handleContextUpload(req, res);
      return;
    }
    if (req.method === "GET") { await serveStatic(req, res); return; }
    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, { error: error.expose ? error.message : "Unexpected server error." });
  }
});

startServer();

async function startServer() {
  await initializeDatabasePersistence();
  server.listen(PORT, HOST, () => {
    console.log(`AI Tax Agent listening on ${HOST}:${PORT}`);
    // Boot record + crash-loop detection: >3 boots in 10 minutes means pm2 is restart-looping
    // a crashing process — that specific pattern fires an alert (webhook if configured).
    try {
      const entries = readJsonFile(INCIDENTS_PATH, { entries: [] }).entries || [];
      const tenMinAgo = Date.now() - 10 * 60000;
      const recentBoots = entries.filter((e) => e.type === "boot" && new Date(e.at).getTime() > tenMinAgo).length;
      recordIncident("boot", `listening on ${HOST}:${PORT}`, { alert: recentBoots >= 3 });
      if (recentBoots >= 3) console.warn(`[Health] ${recentBoots} boots in 10 minutes — possible crash loop.`);
    } catch (_) {}
    try {
      const index = rebuildDeadlinesIndex();
      console.log(`[Deadlines] Index rebuilt - ${(index.upcoming || []).length} upcoming deadlines`);
    } catch (error) {
      console.warn("[Deadlines] Could not rebuild index:", error.message);
    }
  });
}

setInterval(() => {
  try { checkDeadlineNotifications(); } catch (error) { console.warn("[Deadlines] Notification check failed:", error.message); }
}, 6 * 60 * 60 * 1000);

setInterval(() => {
  try { enforceClientFileRetention(); } catch (error) { console.warn("[Retention] Cleanup failed:", error.message); }
}, 6 * 60 * 60 * 1000);

// ---------------------------------------------------------------------------
// Tracker, dynamic statuses, sections, and PTO calendar
// ---------------------------------------------------------------------------
const DEFAULT_TRACKER_STATUSES = [
  { id: "not_ready", label: "Not Ready", color: "#94a3b8", bg: "#f1f5f9", order: 1, isDefault: true, isFinal: false },
  { id: "waiting_client", label: "Waiting for Client", color: "#f59e0b", bg: "#fffbeb", order: 2, isDefault: false, isFinal: false },
  { id: "ready_to_prep", label: "Ready to Prep", color: "#3b82f6", bg: "#eff6ff", order: 3, isDefault: false, isFinal: false },
  { id: "on_prep", label: "On Prep", color: "#8b5cf6", bg: "#f5f3ff", order: 4, isDefault: false, isFinal: false },
  { id: "on_review", label: "On Review", color: "#06b6d4", bg: "#ecfeff", order: 5, isDefault: false, isFinal: false },
  { id: "manager_review", label: "Manager Review", color: "#f97316", bg: "#fff7ed", order: 6, isDefault: false, isFinal: false },
  { id: "final_review", label: "Final Review", color: "#ec4899", bg: "#fdf2f8", order: 7, isDefault: false, isFinal: false },
  { id: "ready_to_send", label: "Ready to Send", color: "#10b981", bg: "#f0fdf4", order: 8, isDefault: false, isFinal: false },
  { id: "completed", label: "Completed", color: "#1B3A6B", bg: "#eff6ff", order: 9, isDefault: true, isFinal: true },
];

function defaultTrackerData() {
  const now = new Date().toISOString();
  return {
    globalStatuses: structuredCloneSafe(DEFAULT_TRACKER_STATUSES),
    sectionStatuses: {},
    sections: {
      tax_returns: { id: "tax_returns", name: "Tax Returns", color: "#2563eb", icon: "\u{1F4CB}", order: 1, createdAt: now },
      estimates: { id: "estimates", name: "Estimates", color: "#06b6d4", icon: "\u{1F4C5}", order: 2, createdAt: now },
      extensions: { id: "extensions", name: "Extensions", color: "#8b5cf6", icon: "\u{23F3}", order: 3, createdAt: now },
      deliverables: { id: "deliverables", name: "Deliverables", color: "#10b981", icon: "\u{1F4E8}", order: 4, createdAt: now },
    },
    tasks: {},
    users: {},
    pto: { entries: {}, settings: { requireApproval: false, maxDaysPerYear: null, ptoDaysAllotted: {} } },
  };
}

function readTracker() {
  ensureDatabase();
  const tracker = readJsonFile(TRACKER_PATH, defaultTrackerData());
  let changed = false;
  if (!Array.isArray(tracker.globalStatuses) || tracker.globalStatuses.length === 0) {
    tracker.globalStatuses = structuredCloneSafe(DEFAULT_TRACKER_STATUSES);
    changed = true;
  }
  tracker.sectionStatuses = tracker.sectionStatuses || {};
  tracker.sections = tracker.sections || {};
  tracker.tasks = tracker.tasks || {};
  tracker.users = tracker.users || {};
  tracker.pto = tracker.pto || { entries: {}, settings: {} };
  tracker.pto.entries = tracker.pto.entries || {};
  tracker.pto.settings = { requireApproval: false, maxDaysPerYear: null, ptoDaysAllotted: {}, ...(tracker.pto.settings || {}) };
  if (!Object.keys(tracker.sections).length) {
    Object.assign(tracker.sections, defaultTrackerData().sections);
    changed = true;
  }
  if (changed) writeTracker(tracker);
  return tracker;
}

function writeTracker(tracker) {
  writeJsonFile(TRACKER_PATH, tracker);
}

async function handleTrackerApi(req, res, requestUrl) {
  const tracker = readTracker();
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && requestUrl.pathname === "/api/tracker") { sendJson(res, 200, publicTrackerData(tracker, req)); return; }
  if (req.method === "GET" && requestUrl.pathname === "/api/tracker/statuses") { sendJson(res, 200, sortByOrder(tracker.globalStatuses)); return; }
  if (req.method === "GET" && parts[2] === "statuses" && parts[3] === "section" && parts[4]) { sendJson(res, 200, statusesForSection(tracker, decodeURIComponent(parts[4]))); return; }
  if (req.method === "POST" && requestUrl.pathname === "/api/tracker/statuses") {
    const payload = await readJsonBody(req);
    const status = createTrackerStatus(tracker.globalStatuses, payload);
    tracker.globalStatuses.push(status);
    writeTracker(tracker);
    sendJson(res, 200, status);
    return;
  }
  if (req.method === "POST" && parts[2] === "statuses" && parts[3] === "section" && parts[4]) {
    const sectionId = decodeURIComponent(parts[4]);
    const payload = await readJsonBody(req);
    if (!tracker.sectionStatuses[sectionId]) tracker.sectionStatuses[sectionId] = structuredCloneSafe(sortByOrder(tracker.globalStatuses));
    const status = createTrackerStatus(tracker.sectionStatuses[sectionId], payload);
    tracker.sectionStatuses[sectionId].push(status);
    writeTracker(tracker);
    sendJson(res, 200, status);
    return;
  }
  if (req.method === "PUT" && requestUrl.pathname === "/api/tracker/statuses/reorder") {
    const payload = await readJsonBody(req);
    reorderStatuses(tracker.globalStatuses, payload.statuses || []);
    writeTracker(tracker);
    sendJson(res, 200, sortByOrder(tracker.globalStatuses));
    return;
  }
  if (req.method === "PUT" && parts[2] === "statuses" && parts[3]) {
    const payload = await readJsonBody(req);
    const statusId = decodeURIComponent(parts[3]);
    updateStatusCollection(tracker.globalStatuses, statusId, payload);
    Object.values(tracker.sectionStatuses).forEach((list) => updateStatusCollection(list, statusId, payload));
    if (payload.isFinal === true) {
      markSingleFinal(tracker.globalStatuses, statusId);
      Object.values(tracker.sectionStatuses).forEach((list) => markSingleFinal(list, statusId));
    }
    writeTracker(tracker);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "DELETE" && parts[2] === "statuses" && parts[3]) {
    if (!requireAdmin(req, res)) return;
    const statusId = decodeURIComponent(parts[3]);
    const target = tracker.globalStatuses.find((status) => status.id === statusId);
    if (target?.isDefault) { sendJson(res, 400, { error: "default_status", message: "Default statuses cannot be deleted." }); return; }
    const taskCount = Object.values(tracker.tasks).filter((task) => task.status === statusId).length;
    if (taskCount) { sendJson(res, 400, { error: "status_in_use", taskCount, message: `${taskCount} tasks use this status. Move them first.` }); return; }
    tracker.globalStatuses = tracker.globalStatuses.filter((status) => status.id !== statusId);
    Object.keys(tracker.sectionStatuses).forEach((sectionId) => { tracker.sectionStatuses[sectionId] = tracker.sectionStatuses[sectionId].filter((status) => status.id !== statusId); });
    writeTracker(tracker);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "PUT" && parts[2] === "sections" && parts[4] === "use-custom-statuses") {
    const sectionId = decodeURIComponent(parts[3]);
    const payload = await readJsonBody(req);
    if (payload.useCustom) tracker.sectionStatuses[sectionId] = tracker.sectionStatuses[sectionId] || structuredCloneSafe(sortByOrder(tracker.globalStatuses));
    else delete tracker.sectionStatuses[sectionId];
    writeTracker(tracker);
    sendJson(res, 200, { ok: true, statuses: statusesForSection(tracker, sectionId) });
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/tracker/sections") { sendJson(res, 200, sortSections(tracker)); return; }
  if (req.method === "POST" && requestUrl.pathname === "/api/tracker/sections") {
    const payload = await readJsonBody(req);
    const section = createTrackerSection(tracker, payload);
    tracker.sections[section.id] = section;
    writeTracker(tracker);
    sendJson(res, 200, section);
    return;
  }
  if (req.method === "PUT" && requestUrl.pathname === "/api/tracker/sections/reorder") {
    const payload = await readJsonBody(req);
    (payload.sections || []).forEach((item) => { if (tracker.sections[item.id]) tracker.sections[item.id].order = Number(item.order) || tracker.sections[item.id].order; });
    writeTracker(tracker);
    sendJson(res, 200, sortSections(tracker));
    return;
  }
  if (req.method === "PUT" && parts[2] === "sections" && parts[3]) {
    const sectionId = decodeURIComponent(parts[3]);
    const payload = await readJsonBody(req);
    if (!tracker.sections[sectionId]) { sendJson(res, 404, { error: "Section not found." }); return; }
    if (payload.name !== undefined) {
      const name = String(payload.name || "").trim();
      if (!name || name.length > 50) { sendJson(res, 400, { error: "Section name is required and must be 50 characters or less." }); return; }
      tracker.sections[sectionId].name = name;
    }
    if (payload.color !== undefined && isValidHex(payload.color)) tracker.sections[sectionId].color = payload.color;
    if (payload.icon !== undefined) tracker.sections[sectionId].icon = String(payload.icon || "").slice(0, 4);
    writeTracker(tracker);
    sendJson(res, 200, tracker.sections[sectionId]);
    return;
  }
  if (req.method === "DELETE" && parts[2] === "sections" && parts[3]) {
    if (!requireAdmin(req, res)) return;
    const sectionId = decodeURIComponent(parts[3]);
    const payload = await readJsonBody(req).catch(() => ({}));
    const tasks = Object.values(tracker.tasks).filter((task) => task.sectionId === sectionId);
    if (tasks.length && !payload.action) { sendJson(res, 400, { error: "section_has_tasks", taskCount: tasks.length }); return; }
    if (tasks.length && payload.action === "move") tasks.forEach((task) => { task.sectionId = payload.targetSectionId; });
    if (tasks.length && payload.action === "delete") tasks.forEach((task) => { delete tracker.tasks[task.id]; });
    delete tracker.sections[sectionId];
    delete tracker.sectionStatuses[sectionId];
    writeTracker(tracker);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/tracker/tasks") {
    const payload = await readJsonBody(req);
    const task = createTrackerTask(tracker, payload, req.user || getSession(req));
    tracker.tasks[task.id] = task;
    writeTracker(tracker);
    sendJson(res, 200, task);
    return;
  }
  if (req.method === "PUT" && parts[2] === "tasks" && parts[3]) {
    const taskId = decodeURIComponent(parts[3]);
    if (!tracker.tasks[taskId]) { sendJson(res, 404, { error: "Task not found." }); return; }
    const payload = await readJsonBody(req);
    tracker.tasks[taskId] = { ...tracker.tasks[taskId], ...pickTaskFields(payload), updatedAt: new Date().toISOString() };
    writeTracker(tracker);
    sendJson(res, 200, tracker.tasks[taskId]);
    return;
  }
  if (req.method === "POST" && parts[2] === "tasks" && parts[3] && parts[4] === "time") {
    const taskId = decodeURIComponent(parts[3]);
    const task = tracker.tasks[taskId];
    if (!task) { sendJson(res, 404, { error: "Task not found." }); return; }
    const payload = await readJsonBody(req);
    const minutes = Math.max(1, Math.min(1440, Math.round(Number(payload.minutes || 0))));
    if (!minutes) { sendJson(res, 400, { error: "Minutes are required." }); return; }
    const user = trackerUser(req.user || getSession(req));
    const entry = {
      id: crypto.randomUUID(),
      minutes,
      note: String(payload.note || "").slice(0, 500),
      loggedBy: user.id,
      loggedByName: user.name,
      loggedAt: new Date().toISOString(),
    };
    task.timeEntries = Array.isArray(task.timeEntries) ? task.timeEntries : [];
    task.timeEntries.push(entry);
    task.totalMinutes = (Number(task.totalMinutes) || 0) + minutes;
    task.updatedAt = new Date().toISOString();
    writeTracker(tracker);
    sendJson(res, 200, task);
    return;
  }
  if (req.method === "DELETE" && parts[2] === "tasks" && parts[3]) {
    delete tracker.tasks[decodeURIComponent(parts[3])];
    writeTracker(tracker);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { error: "Tracker route not found." });
}

async function handlePtoApi(req, res, requestUrl) {
  const tracker = readTracker();
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && requestUrl.pathname === "/api/pto") {
    const year = requestUrl.searchParams.get("year") || String(new Date().getFullYear());
    const userId = requestUrl.searchParams.get("userId") || "";
    const entries = Object.values(tracker.pto.entries).filter((entry) => (!year || entry.startDate.startsWith(year) || entry.endDate.startsWith(year)) && (!userId || entry.userId === userId));
    sendJson(res, 200, { entries: sortPto(entries), settings: tracker.pto.settings });
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/pto/my") {
    const user = trackerUser(req.user || getSession(req));
    const entries = Object.values(tracker.pto.entries).filter((entry) => entry.userId === user.id);
    sendJson(res, 200, { entries: sortPto(entries) });
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/pto") {
    const payload = await readJsonBody(req);
    const user = trackerUser(req.user || getSession(req));
    const entry = createPtoEntry(tracker, payload, user);
    const overlap = Object.values(tracker.pto.entries).find((item) => item.userId === entry.userId && item.status !== "rejected" && datesOverlap(item.startDate, item.endDate, entry.startDate, entry.endDate));
    if (overlap) { sendJson(res, 400, { error: "pto_overlap", message: "You already have PTO on some of these days." }); return; }
    if (entry.status === "approved") await syncPtoEntryToGoogleCalendar(entry).catch(() => null);
    tracker.pto.entries[entry.id] = entry;
    writeTracker(tracker);
    sendJson(res, 200, entry);
    return;
  }
  if (req.method === "PUT" && parts[1] === "pto" && parts[2] && !["approve", "reject"].includes(parts[3])) {
    const id = decodeURIComponent(parts[2]);
    const entry = tracker.pto.entries[id];
    if (!entry) { sendJson(res, 404, { error: "PTO entry not found." }); return; }
    const user = trackerUser(req.user || getSession(req));
    if (entry.userId !== user.id && user.role !== "admin") { sendJson(res, 403, { error: "You can only edit your own PTO." }); return; }
    const payload = await readJsonBody(req);
    tracker.pto.entries[id] = { ...entry, ...ptoEditableFields(payload), ...ptoDates(payload), updatedAt: new Date().toISOString() };
    writeTracker(tracker);
    sendJson(res, 200, tracker.pto.entries[id]);
    return;
  }
  if (req.method === "DELETE" && parts[1] === "pto" && parts[2]) {
    const id = decodeURIComponent(parts[2]);
    const entry = tracker.pto.entries[id];
    const user = trackerUser(req.user || getSession(req));
    if (entry && entry.userId !== user.id && user.role !== "admin") { sendJson(res, 403, { error: "You can only delete your own PTO." }); return; }
    if (entry?.googleEventId) await deletePtoGoogleCalendarEvent(entry).catch(() => null);
    delete tracker.pto.entries[id];
    writeTracker(tracker);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "PUT" && parts[1] === "pto" && parts[3] === "approve") {
    if (!requireAdmin(req, res)) return;
    const entry = tracker.pto.entries[decodeURIComponent(parts[2])];
    if (!entry) { sendJson(res, 404, { error: "PTO entry not found." }); return; }
    entry.status = "approved";
    entry.reviewedBy = trackerUser(req.user || getSession(req)).id;
    entry.reviewedAt = new Date().toISOString();
    await syncPtoEntryToGoogleCalendar(entry).catch(() => null);
    writeTracker(tracker);
    sendJson(res, 200, entry);
    return;
  }
  if (req.method === "PUT" && parts[1] === "pto" && parts[3] === "reject") {
    if (!requireAdmin(req, res)) return;
    const payload = await readJsonBody(req).catch(() => ({}));
    const entry = tracker.pto.entries[decodeURIComponent(parts[2])];
    if (!entry) { sendJson(res, 404, { error: "PTO entry not found." }); return; }
    entry.status = "rejected";
    entry.note = [entry.note, payload.reason ? `Rejected: ${payload.reason}` : ""].filter(Boolean).join("\n");
    entry.reviewedBy = trackerUser(req.user || getSession(req)).id;
    entry.reviewedAt = new Date().toISOString();
    if (entry.googleEventId) await deletePtoGoogleCalendarEvent(entry).catch(() => null);
    entry.syncedToGoogle = false;
    entry.googleEventId = null;
    writeTracker(tracker);
    sendJson(res, 200, entry);
    return;
  }
  if (req.method === "GET" && parts[1] === "pto" && parts[2] === "stats" && parts[3]) {
    const year = requestUrl.searchParams.get("year") || String(new Date().getFullYear());
    sendJson(res, 200, ptoStats(tracker, decodeURIComponent(parts[3]), year));
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/pto/settings") { sendJson(res, 200, tracker.pto.settings); return; }
  if (req.method === "PUT" && requestUrl.pathname === "/api/pto/settings") {
    if (!requireAdmin(req, res)) return;
    const payload = await readJsonBody(req);
    tracker.pto.settings = { ...tracker.pto.settings, ...payload, ptoDaysAllotted: payload.ptoDaysAllotted || tracker.pto.settings.ptoDaysAllotted || {} };
    writeTracker(tracker);
    sendJson(res, 200, tracker.pto.settings);
    return;
  }
  sendJson(res, 404, { error: "PTO route not found." });
}

function publicTrackerData(tracker, req = null) {
  // Firm scoping: tasks and PTO entries are only returned to users of the creator's firm
  // (tracker boards carry client names). Without a request context (internal callers),
  // the data is returned unfiltered.
  const visible = (owner) => !req || canAccessOwner(req, String(owner || ""));
  const tasks = Object.values(tracker.tasks)
    .filter((task) => visible(task.createdBy || task.ownerUsername))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const ptoEntries = sortPto(Object.values(tracker.pto.entries))
    .filter((entry) => visible(entry.userId || entry.username || entry.createdBy));
  return { sections: sortSections(tracker), statuses: sortByOrder(tracker.globalStatuses), sectionStatuses: tracker.sectionStatuses, tasks, pto: { entries: ptoEntries, settings: tracker.pto.settings } };
}

function sortByOrder(list) {
  return [...(list || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.label).localeCompare(String(b.label)));
}

function sortSections(tracker) {
  return Object.values(tracker.sections || {}).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name)));
}

function statusesForSection(tracker, sectionId) {
  return sortByOrder(tracker.sectionStatuses?.[sectionId] || tracker.globalStatuses);
}

function slugId(label, existingIds) {
  const base = String(label || "item").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item";
  let id = base;
  let counter = 2;
  while (existingIds.has(id)) id = `${base}_${counter++}`;
  return id;
}

function createTrackerStatus(existing, payload) {
  const label = String(payload.label || "").trim();
  if (!label) throw new Error("Status label is required.");
  const ids = new Set((existing || []).map((status) => status.id));
  return { id: slugId(label, ids), label, color: isValidHex(payload.color) ? payload.color : "#3b82f6", bg: isValidHex(payload.bg) ? payload.bg : "#eff6ff", order: Number(payload.order) || (existing || []).length + 1, isDefault: false, isFinal: Boolean(payload.isFinal) };
}

function updateStatusCollection(list, statusId, payload) {
  const status = (list || []).find((item) => item.id === statusId);
  if (!status) return;
  if (payload.label !== undefined) status.label = String(payload.label || status.label).trim() || status.label;
  if (payload.color !== undefined && isValidHex(payload.color)) status.color = payload.color;
  if (payload.bg !== undefined && isValidHex(payload.bg)) status.bg = payload.bg;
  if (payload.isFinal !== undefined) status.isFinal = Boolean(payload.isFinal);
}

function markSingleFinal(list, statusId) {
  (list || []).forEach((status) => { status.isFinal = status.id === statusId; });
}

function reorderStatuses(list, ordered) {
  const orderMap = new Map((ordered || []).map((item) => [item.id, Number(item.order)]));
  (list || []).forEach((status, index) => { status.order = orderMap.get(status.id) || index + 1; });
}

function createTrackerSection(tracker, payload) {
  const name = String(payload.name || "").trim();
  if (!name || name.length > 50) throw new Error("Section name is required and must be 50 characters or less.");
  const id = slugId(name, new Set(Object.keys(tracker.sections || {})));
  return { id, name, color: isValidHex(payload.color) ? payload.color : "#2563eb", icon: String(payload.icon || "\u{1F4C1}").slice(0, 4), order: Number(payload.order) || Object.keys(tracker.sections || {}).length + 1, createdAt: new Date().toISOString() };
}

function createTrackerTask(tracker, payload, session) {
  const sectionId = tracker.sections[payload.sectionId] ? payload.sectionId : sortSections(tracker)[0]?.id;
  const statuses = statusesForSection(tracker, sectionId);
  return { id: crypto.randomUUID(), title: String(payload.title || "Untitled task").trim(), clientName: String(payload.clientName || "").trim(), sectionId, status: statuses.find((status) => status.id === payload.status)?.id || statuses[0]?.id || "not_ready", assignee: String(payload.assignee || session?.displayName || session?.username || "").trim(), dueDate: String(payload.dueDate || "").slice(0, 10), notes: String(payload.notes || ""), totalMinutes: 0, timeEntries: [], createdBy: session?.username || "unknown", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

function pickTaskFields(payload) {
  const allowed = {};
  ["title", "clientName", "sectionId", "status", "assignee", "dueDate", "notes"].forEach((key) => { if (payload[key] !== undefined) allowed[key] = String(payload[key] || ""); });
  return allowed;
}

function isValidHex(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ""));
}

function trackerUser(session) {
  const displayName = session?.displayName || session?.username || "User";
  const id = session?.username || "anonymous";
  return { id, role: session?.role === "admin" ? "admin" : "user", name: displayName, initials: displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "U", color: userColor(id) };
}

function userColor(seed) {
  const colors = ["#2563eb", "#8b5cf6", "#06b6d4", "#10b981", "#f97316", "#ec4899", "#64748b"];
  const total = String(seed || "").split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return colors[total % colors.length];
}

function createPtoEntry(tracker, payload, user) {
  const dates = ptoDates(payload);
  const status = tracker.pto.settings.requireApproval ? "pending" : "approved";
  return { id: crypto.randomUUID(), userId: user.id, userName: user.name, userInitials: user.initials, userColor: user.color, type: ["vacation", "sick", "personal", "holiday", "other"].includes(payload.type) ? payload.type : "vacation", ...dates, note: String(payload.note || ""), status, reviewedBy: status === "approved" ? user.id : null, reviewedAt: status === "approved" ? new Date().toISOString() : null, createdAt: new Date().toISOString(), syncedToGoogle: false, googleEventId: null };
}

async function syncPtoEntryToGoogleCalendar(entry) {
  const tokens = readGoogleTokens();
  if (!tokens?.access_token || !String(tokens.scope || "").includes(GOOGLE_CALENDAR_SCOPE)) return entry;
  const event = {
    summary: `${ptoTypeEmojiServer(entry.type)} ${entry.userName} - ${ptoTypeLabelServer(entry.type)}`,
    description: [entry.note, "Submitted via RAG Tax AI"].filter(Boolean).join("\n\n"),
    start: { date: entry.startDate },
    end: { date: addDaysIso(entry.endDate, 1) },
    colorId: googleCalendarColorId(entry.userColor),
  };
  const response = await googleApiFetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok && data.id) {
    entry.syncedToGoogle = true;
    entry.googleEventId = data.id;
  }
  return entry;
}

async function deletePtoGoogleCalendarEvent(entry) {
  const tokens = readGoogleTokens();
  if (!tokens?.access_token || !entry.googleEventId || !String(tokens.scope || "").includes(GOOGLE_CALENDAR_SCOPE)) return;
  await googleApiFetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(entry.googleEventId)}`, { method: "DELETE" });
}

function ptoTypeLabelServer(type) {
  return ({ vacation: "Vacation", sick: "Sick", personal: "Personal", holiday: "Holiday", other: "Other" })[type] || "PTO";
}

function ptoTypeEmojiServer(type) {
  return ({ vacation: "PTO", sick: "Sick", personal: "Personal", holiday: "Holiday", other: "PTO" })[type] || "PTO";
}

function addDaysIso(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function googleCalendarColorId(hex) {
  const palette = {
    1: "#7986cb", 2: "#33b679", 3: "#8e24aa", 4: "#e67c73", 5: "#f6c026",
    6: "#f5511d", 7: "#039be5", 8: "#616161", 9: "#3f51b5", 10: "#0b8043", 11: "#d60000",
  };
  const rgb = hexToRgb(hex || "#2563eb");
  let best = "9";
  let bestDistance = Infinity;
  Object.entries(palette).forEach(([id, color]) => {
    const target = hexToRgb(color);
    const distance = ((rgb.r - target.r) ** 2) + ((rgb.g - target.g) ** 2) + ((rgb.b - target.b) ** 2);
    if (distance < bestDistance) { best = id; bestDistance = distance; }
  });
  return best;
}

function hexToRgb(hex) {
  const value = String(hex || "#000000").replace("#", "");
  return { r: parseInt(value.slice(0, 2), 16) || 0, g: parseInt(value.slice(2, 4), 16) || 0, b: parseInt(value.slice(4, 6), 16) || 0 };
}

function ptoDates(payload) {
  const startDate = String(payload.startDate || "").slice(0, 10);
  const endDate = String(payload.endDate || startDate).slice(0, 10);
  const halfDay = Boolean(payload.halfDay);
  return { startDate, endDate, totalDays: halfDay ? 0.5 : calculateWorkingDays(startDate, endDate), halfDay, halfDayPeriod: halfDay ? (payload.halfDayPeriod === "afternoon" ? "afternoon" : "morning") : null };
}

function ptoEditableFields(payload) {
  return { type: ["vacation", "sick", "personal", "holiday", "other"].includes(payload.type) ? payload.type : "vacation", note: String(payload.note || "") };
}

function calculateWorkingDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return 0;
  let count = 0;
  const cur = new Date(start.getTime());
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return new Date(`${aStart}T00:00:00`) <= new Date(`${bEnd}T00:00:00`) && new Date(`${bStart}T00:00:00`) <= new Date(`${aEnd}T00:00:00`);
}

function sortPto(entries) {
  return [...(entries || [])].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

function ptoStats(tracker, userId, year) {
  const entries = Object.values(tracker.pto.entries).filter((entry) => entry.userId === userId && (entry.startDate.startsWith(year) || entry.endDate.startsWith(year)));
  const approved = entries.filter((entry) => entry.status === "approved");
  const pending = entries.filter((entry) => entry.status === "pending");
  const allotted = tracker.pto.settings.ptoDaysAllotted?.[userId] ?? null;
  const used = approved.reduce((sum, entry) => sum + Number(entry.totalDays || 0), 0);
  const pendingDays = pending.reduce((sum, entry) => sum + Number(entry.totalDays || 0), 0);
  const byType = {};
  approved.forEach((entry) => { byType[entry.type] = (byType[entry.type] || 0) + Number(entry.totalDays || 0); });
  return { year, userId, userName: entries[0]?.userName || userId, allotted, used, pending: pendingDays, remaining: allotted === null ? null : allotted - used, byType };
}

// ---------------------------------------------------------------------------
// Estimated taxes and extensions
// ---------------------------------------------------------------------------
const EST_STATE_RULES = {
  CA: { rate: 0.093, url: "https://www.ftb.ca.gov/pay/estimated-tax/", name: "California" },
  NY: { rate: 0.0685, url: "https://www.tax.ny.gov/pit/estimated_tax/", name: "New York" },
  TX: { rate: 0, url: "https://comptroller.texas.gov/taxes/franchise/", name: "Texas" },
  FL: { rate: 0.055, url: "https://floridarevenue.com/taxes/taxesfees/Pages/corporate.aspx", name: "Florida" },
  IL: { rate: 0.0495, url: "https://tax.illinois.gov/individuals/estimated-payments.html", name: "Illinois" },
  NJ: { rate: 0.0637, url: "https://www.nj.gov/treasury/taxation/estimated_tax.shtml", name: "New Jersey" },
  PA: { rate: 0.0307, url: "https://www.revenue.pa.gov/TaxTypes/PIT/Pages/Estimated-Tax.aspx", name: "Pennsylvania" },
  OH: { rate: 0.035, url: "https://tax.ohio.gov/individual/resources/estimated-payments", name: "Ohio" },
  GA: { rate: 0.0539, url: "https://dor.georgia.gov/estimated-tax-payments", name: "Georgia" },
  NC: { rate: 0.045, url: "https://www.ncdor.gov/file-pay/estimated-income-tax", name: "North Carolina" },
  MA: { rate: 0.05, url: "https://www.mass.gov/estimated-taxes", name: "Massachusetts" },
  WA: { rate: 0, url: "", name: "Washington" },
  NV: { rate: 0, url: "", name: "Nevada" },
  WY: { rate: 0, url: "", name: "Wyoming" },
  SD: { rate: 0, url: "", name: "South Dakota" },
  AK: { rate: 0, url: "", name: "Alaska" },
  TN: { rate: 0, url: "", name: "Tennessee" },
};

const EXTENSION_DEADLINES = {
  "1040": { originalMonth: 4, originalDay: 15, extendedMonth: 10, extendedDay: 15, form: "4868", formName: "Application for Automatic Extension of Time to File", formUrl: "https://www.irs.gov/pub/irs-pdf/f4868.pdf", instrUrl: "https://www.irs.gov/pub/irs-pdf/i4868.pdf", onlinePayUrl: "https://directpay.irs.gov", autoApproved: true, notes: "Extension is automatic. Pay estimated tax due by the original deadline to avoid penalties and interest." },
  "1041": { originalMonth: 4, originalDay: 15, extendedMonth: 9, extendedDay: 30, form: "7004", formName: "Application for Automatic Extension of Time to File Certain Business Income Tax Returns", formUrl: "https://www.irs.gov/pub/irs-pdf/f7004.pdf", instrUrl: "https://www.irs.gov/pub/irs-pdf/i7004.pdf", onlinePayUrl: "https://www.eftps.gov", autoApproved: true, notes: "5.5 month extension. Estimated tax must be paid by the original due date." },
  "1065": { originalMonth: 3, originalDay: 15, extendedMonth: 9, extendedDay: 15, form: "7004", formName: "Application for Automatic Extension of Time to File", formUrl: "https://www.irs.gov/pub/irs-pdf/f7004.pdf", instrUrl: "https://www.irs.gov/pub/irs-pdf/i7004.pdf", onlinePayUrl: "https://www.eftps.gov", autoApproved: true, notes: "Partnerships generally do not pay entity-level federal income tax. Extension extends filing deadline only." },
  "1120": { originalMonth: 4, originalDay: 15, extendedMonth: 10, extendedDay: 15, form: "7004", formName: "Application for Automatic Extension of Time to File", formUrl: "https://www.irs.gov/pub/irs-pdf/f7004.pdf", instrUrl: "https://www.irs.gov/pub/irs-pdf/i7004.pdf", onlinePayUrl: "https://www.eftps.gov", autoApproved: true, notes: "Extension extends filing deadline 6 months. Estimated tax is due by original deadline." },
  "1120-S": { originalMonth: 3, originalDay: 15, extendedMonth: 9, extendedDay: 15, form: "7004", formName: "Application for Automatic Extension of Time to File", formUrl: "https://www.irs.gov/pub/irs-pdf/f7004.pdf", instrUrl: "https://www.irs.gov/pub/irs-pdf/i7004.pdf", onlinePayUrl: "https://www.eftps.gov", autoApproved: true, notes: "S corporations do not pay federal income tax at entity level. Extension extends filing deadline only." },
  "990": { originalMonth: 5, originalDay: 15, extendedMonth: 11, extendedDay: 15, form: "8868", formName: "Application for Automatic Extension of Time to File an Exempt Organization Return", formUrl: "https://www.irs.gov/pub/irs-pdf/f8868.pdf", instrUrl: "https://www.irs.gov/pub/irs-pdf/i8868.pdf", onlinePayUrl: "https://www.irs.gov/charities-non-profits/e-file-for-charities-and-non-profits", autoApproved: true, notes: "6 month automatic extension." },
  "990-T": { originalMonth: 5, originalDay: 15, extendedMonth: 11, extendedDay: 15, form: "8868", formName: "Application for Automatic Extension - Form 990-T", formUrl: "https://www.irs.gov/pub/irs-pdf/f8868.pdf", instrUrl: "https://www.irs.gov/pub/irs-pdf/i8868.pdf", onlinePayUrl: "https://www.eftps.gov", autoApproved: true, notes: "Unrelated business income tax must be paid by original due date." },
  "706": { form: "4768", formName: "Application for Extension of Time to File a Return and/or Pay U.S. Estate Taxes", formUrl: "https://www.irs.gov/pub/irs-pdf/f4768.pdf", instrUrl: "https://www.irs.gov/pub/irs-pdf/i4768.pdf", onlinePayUrl: "https://www.eftps.gov", autoApproved: false, notes: "Extension of time to file is generally 6 months from the original estate tax deadline. Payment extension requires separate approval." },
  "709": { originalMonth: 4, originalDay: 15, extendedMonth: 10, extendedDay: 15, form: "4868", formName: "Extension via Form 4868", formUrl: "https://www.irs.gov/pub/irs-pdf/f4868.pdf", instrUrl: "https://www.irs.gov/pub/irs-pdf/i4868.pdf", onlinePayUrl: "https://directpay.irs.gov", autoApproved: true, notes: "Gift tax extension is obtained through the individual extension." },
};

const STATE_EXTENSION_RULES = {
  CA: { autoWithFederal: true, requiresSeparateForm: false, extendedMonths: 6, payDeadline: "April 15, YYYY", minimumPayment: "90% of current year tax or 100% of prior year tax", url: "https://www.ftb.ca.gov/pay/due-dates/extension.html", notes: "California automatically grants a 6-month extension. No separate individual extension form required." },
  NY: { autoWithFederal: false, requiresSeparateForm: true, stateForm: "IT-370", stateFormUrl: "https://www.tax.ny.gov/pdf/current_forms/it/it370.pdf", extendedMonths: 6, payDeadline: "April 15, YYYY", minimumPayment: "Amount to bring total payments to 90% of current year tax", url: "https://www.tax.ny.gov/pit/estimated_tax/extension.htm", notes: "New York requires Form IT-370 by original due date." },
  TX: { noStateIncomeTax: true, notes: "Texas has no state income tax. Franchise tax has separate extension rules.", url: "https://comptroller.texas.gov/taxes/franchise/filing-requirements.php" },
  FL: { autoWithFederal: true, requiresSeparateForm: false, notes: "Florida has no personal income tax. Corporate income tax generally follows federal extension.", url: "https://floridarevenue.com/taxes/taxesfees/Pages/corporate.aspx" },
  IL: { autoWithFederal: true, requiresSeparateForm: false, minimumPayment: "100% of prior year tax or 90% of current year tax", url: "https://tax.illinois.gov/individuals/estimated-payments.html", notes: "Illinois automatically extends if federal extension filed and required tax is paid." },
  NJ: { autoWithFederal: true, requiresSeparateForm: false, minimumPayment: "80% of current year tax due", url: "https://www.nj.gov/treasury/taxation/njit25.shtml", notes: "New Jersey follows federal extension if payment requirements are met." },
  PA: { autoWithFederal: true, requiresSeparateForm: false, minimumPayment: "90% of current year tax", url: "https://www.revenue.pa.gov/TaxTypes/PIT/Pages/Extensions.aspx", notes: "Pennsylvania automatically grants extension if payment requirements are met." },
  OH: { autoWithFederal: true, requiresSeparateForm: false, url: "https://tax.ohio.gov/individual/resources/estimated-payments", notes: "Ohio automatically extends if federal extension filed." },
  GA: { autoWithFederal: false, requiresSeparateForm: true, stateForm: "IT-303", stateFormUrl: "https://gtc.dor.ga.gov/_/", minimumPayment: "90% of current year tax", url: "https://dor.georgia.gov/filing-extensions", notes: "Georgia requires Form IT-303." },
  NC: { autoWithFederal: true, requiresSeparateForm: false, minimumPayment: "90% of current year tax", url: "https://www.ncdor.gov/file-pay/pay-individual-income-tax/extensions-individual-income-tax", notes: "North Carolina automatically grants extension if federal extension filed." },
  MA: { autoWithFederal: false, requiresSeparateForm: false, minimumPayment: "80% of current year tax", url: "https://www.mass.gov/info-details/extensions-for-filing-massachusetts-income-taxes", notes: "Massachusetts grants automatic extension if 80% of tax is paid." },
  WA: { noStateIncomeTax: true, notes: "Washington has no state income tax." },
  NV: { noStateIncomeTax: true, notes: "Nevada has no state income tax." },
  WY: { noStateIncomeTax: true, notes: "Wyoming has no state income tax." },
  SD: { noStateIncomeTax: true, notes: "South Dakota has no state income tax." },
  AK: { noStateIncomeTax: true, notes: "Alaska has no state income tax." },
  TN: { noStateIncomeTax: true, notes: "Tennessee has no state income tax." },
};

async function handleEstimatedTaxesDetectPeriod(req, res) {
  const payload = await readJsonBody(req);
  const file = {
    name: payload.name || "P&L",
    type: payload.type || "",
    text: payload.text || decodeEstimatedTextContent(payload),
    content: payload.content || "",
  };
  const period = detectEstimatedTaxPeriod(file);
  sendJson(res, 200, {
    detectedPeriod: period?.label || "",
    detectedMonths: period?.months || null,
    annFactor: period?.factor || null,
  });
}

async function handleEstimatedTaxesCalculate(req, res) {
  const payload = normalizeEstimatedTaxesPayload(await readJsonBody(req));
  if (!payload.entityType || !payload.period || !payload.plFile) {
    sendJson(res, 400, { error: "Select entity type, period, and upload the current-year P&L before generating the workpaper." });
    return;
  }
  const result = await buildEstimatedTaxesCompleteWithClaude(req, payload);
  if (result.error) {
    sendJson(res, result.status || 502, { error: result.error, details: result.details || "" });
    return;
  }
  sendJson(res, 200, result);
}

async function handleEstimatedTaxesTemplateDownload(_req, res, requestUrl) {
  const entityType = normalizeEstimatedEntityTypeServer(decodeURIComponent(requestUrl.pathname.split("/").pop() || ""));
  const templatePath = estimatedTemplatePathForEntity(entityType);
  if (!templatePath || !fsSync.existsSync(templatePath)) {
    sendJson(res, 404, { error: `No estimated tax template found for ${entityType}.` });
    return;
  }
  const buffer = fsSync.readFileSync(templatePath);
  res.writeHead(200, {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${path.basename(templatePath)}"`,
    "content-length": buffer.length,
  });
  res.end(buffer);
}

async function handleExtensionCalculate(req, res) {
  const payload = await readJsonBody(req);
  sendJson(res, 200, calculateExtension(payload));
}

// ===========================================================================
// Tax Planning Studio (Phase 1)
//
// The AI extracts facts and proposes scenario *definitions* (which levers to
// pull). EVERY tax dollar is recomputed here with lib/tax-calculations.js — the
// model's own arithmetic is never trusted for liability numbers.
// ===========================================================================

const PLANNING_MODELS = [...MODEL_FALLBACKS, "claude-sonnet-4-5-20250929"];
// Profile fields a scenario adjustment is allowed to touch (mirrors applyAdjustments).
const PLANNING_FIELDS = [
  "wages", "netSEIncome", "otherIncome", "longTermGains", "shortTermGains",
  "deductions", "qbi", "w2Wages", "retirementContribution", "sec179", "bonusDepreciation",
  "selfEmployedHealthInsurance", "hsaContribution",
];

function planningNum(value) {
  const n = Number(String(value == null ? "" : value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizePlanningProfile(baseData = {}) {
  const b = baseData || {};
  const income = b.income || {};
  const ded = b.deductions || {};
  return {
    clientName: String(b.clientName || "").trim(),
    entityType: String(b.entityType || "").trim(),
    taxYear: Number(b.taxYear) || new Date().getFullYear(),
    filingStatus: planningTax.normalizeStatus(b.filingStatus),
    state: String(b.state || "").trim().toUpperCase(),
    dependents: Number(b.dependents) || 0,
    wages: planningNum(b.wages != null ? b.wages : income.wages),
    businessIncomeTotal: planningNum(b.businessIncomeTotal),
    ownershipPct: b.ownershipPct != null ? Math.min(100, Math.max(0, planningNum(b.ownershipPct))) : 100,
    netSEIncome: (function() {
      const total = planningNum(b.businessIncomeTotal);
      const pct = b.ownershipPct != null ? planningNum(b.ownershipPct) : null;
      if (total > 0 && pct != null) return planningRound(total * pct / 100);
      return planningNum(b.netSEIncome != null ? b.netSEIncome : income.grossReceipts);
    })(),
    otherIncome: planningNum(b.otherIncome != null ? b.otherIncome : income.otherIncome),
    longTermGains: planningNum(b.longTermGains != null ? b.longTermGains : income.capitalGains),
    shortTermGains: planningNum(b.shortTermGains),
    deductions: planningNum(b.deductions != null ? b.deductions : ded.total),
    qbi: planningNum(b.qbi),
    w2Wages: planningNum(b.w2Wages),
    retirementContribution: planningNum(b.retirementContribution),
    sec179: planningNum(b.sec179),
    bonusDepreciation: planningNum(b.bonusDepreciation),
    selfEmployedHealthInsurance: planningNum(b.selfEmployedHealthInsurance),
    hsaContribution: planningNum(b.hsaContribution),
    withholding: planningNum(b.withholding),
    estimatedTaxPaid: planningNum(b.estimatedTaxPaid),
    priorYearTax: planningNum(b.priorYearTax),
  };
}

function planningRound(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function sanitizePlanningAdjustments(adjustments) {
  if (!Array.isArray(adjustments)) return [];
  return adjustments
    .filter((a) => a && PLANNING_FIELDS.includes(String(a.field)))
    .map((a) => {
      const out = { field: String(a.field), rationale: String(a.rationale || "").slice(0, 400) };
      if (a.newValue != null) out.newValue = planningNum(a.newValue);
      else if (a.delta != null) out.delta = planningNum(a.delta);
      if (a.originalValue != null) out.originalValue = planningNum(a.originalValue);
      return out;
    });
}

function buildPlanningBaseScenario(profile, year) {
  const taxCalc = planningTax.computeScenarioTax(profile, [], year);
  const taxCalcNext = planningTax.computeScenarioTax(profile, [], year + 1);
  return {
    id: "base",
    name: "Base (current)",
    description: "Your current situation with no planning changes applied.",
    isBase: true,
    adjustments: [],
    taxCalc,
    taxCalcNext,
    savingsVsBase: { dollars: 0, percentage: 0 },
  };
}

function finalizePlanningScenario(profile, def, baseTotal, year, index) {
  const adjustments = sanitizePlanningAdjustments(def.adjustments);
  const taxCalc = planningTax.computeScenarioTax(profile, adjustments, year);
  const taxCalcNext = planningTax.computeScenarioTax(profile, adjustments, year + 1);
  const dollars = planningRound((baseTotal || 0) - taxCalc.total);
  const percentage = baseTotal > 0 ? planningRound((dollars / baseTotal) * 100) : 0;
  return {
    id: String(def.id || `scenario-${index + 1}`),
    name: String(def.name || `Scenario ${index + 1}`).slice(0, 120),
    description: String(def.description || "").slice(0, 600),
    adjustments,
    taxCalc,
    taxCalcNext,
    savingsVsBase: { dollars, percentage },
  };
}

async function planningFileContent(files, promptText) {
  const ctx = await buildUploadedFileContext(Array.isArray(files) ? files : []);
  const content = [
    ...ctx.documents.slice(0, 8).map((doc) => ({
      type: "document",
      source: { type: "base64", media_type: doc.type || "application/pdf", data: doc.content },
      title: doc.name,
      context: "tax planning source document",
    })),
    ...ctx.images.slice(0, 6).map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.type || "image/png", data: img.content },
    })),
    { type: "text", text: promptText.replace("__FILE_TEXT__", ctx.text || "(no extractable text — read attached documents/images)") },
  ];
  return { content, hasInput: Boolean(ctx.text || ctx.documents.length || ctx.images.length) };
}

async function callPlanningClaude(req, content, systemText, action, payload, maxTokens = 8000) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return { error: "Claude API key is not configured.", status: 400 };
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens,
    webSearch: false,
    models: PLANNING_MODELS,
    system: [{ type: "text", text: systemText }],
    signal: req._abortController?.signal,
    userId: req.user?.username || getSession(req)?.username || "unknown",
    feature: "tax_planning",
  });
  if (!result.ok) return { error: `Claude request failed: ${result.error}`, status: result.status || 502 };
  logClaudeCost(req, result, action, "planning", payload || {}, startedAt);
  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  if (!parsed) return { error: "Claude did not return valid JSON.", status: 502, details: raw.slice(0, 1500) };
  return { data: parsed };
}

async function handlePlanningAnalyze(req, res) {
  const payload = await readJsonBody(req);
  const instructions = String(payload.instructions || "").slice(0, 6000);
  const clientType = String(payload.clientType || "").slice(0, 20);
  const planYear = Number(payload.planYear) || new Date().getFullYear() + 1;
  const linkedEntities = Array.isArray(payload.linkedEntities) ? payload.linkedEntities.slice(0, 3) : [];

  const linkedNote = linkedEntities.length
    ? `Linked entities: ${linkedEntities.map((e) => `${e.type}${e.name ? ` (${e.name})` : ""}`).join(", ")}.`
    : "";

  const prompt = [
    `Extract a tax-planning profile. Return type: ${clientType || "unspecified"}. Planning year: ${planYear}. ${linkedNote}`,
    "Documents may be from a prior year. Extract facts about income, deductions, and entity structure. Return facts only — do NOT compute taxes.",
    "",
    "CRITICAL — STATE: Always extract the 2-letter resident state (e.g. NY, CA, NJ, FL). Look for it on:",
    "  • Form 1040 page 1 header or state field  • State return cover page (e.g. NY IT-201, CA 540, NJ-1040)",
    "  • Business address on 1120S, 1065, or K-1  • W-2 state box",
    "Never leave 'state' blank or null if the state is identifiable anywhere in the documents.",
    "",
    `PROJECTION — Plan year is ${planYear}. If source documents are from a prior tax year:`,
    `  • Use prior-year income figures as the baseline projection for ${planYear} unless the documents contain explicit projections, bookkeeping reports, or quarterly estimates for ${planYear}.`,
    "  • Do NOT set wages, netSEIncome, otherIncome, longTermGains, or shortTermGains to 0 unless the client truly has no income of that type.",
    "  • If quarterly estimated tax payments are provided, back-calculate the estimated annual income they represent.",
    "  • Project pass-through K-1 income from prior year if no current-year figure is available.",
    "",
    "CPA INSTRUCTIONS: " + (instructions || "(none)"),
    "",
    "DOCUMENT TEXT: __FILE_TEXT__",
    "",
    'Return ONLY JSON in ```json``` fences (numbers only, no $ signs):',
    '{',
    '  "clientName":string, "entityType":string, "taxYear":number,',
    '  "filingStatus":"Single"|"MFJ"|"MFS"|"HOH", "state":string, "dependents":number,',
    '  "wages":number,',
    '  "businessIncomeTotal":number (total entity ordinary income before owner split; K-1 Box 1 aggregate, Schedule C net profit, entity net income),',
    '  "ownershipPct":number (0-100; from K-1 percentage, partnership agreement; 100 if sole owner),',
    '  "netSEIncome":number (= businessIncomeTotal × ownershipPct / 100, plus any guaranteed payments),',
    '  "otherIncome":number (dividends, interest, royalties, 1099-MISC not from main business — NOT business pass-through income),',
    '  "longTermGains":number, "shortTermGains":number,',
    '  "deductions":number (itemized; 0 if standard deduction applies),',
    '  "qbi":number (qualified business income for §199A — usually equals netSEIncome for pass-throughs),',
    '  "w2Wages":number (W-2 wages paid by the business entity, for QBI W-2 wage limit),',
    '  "selfEmployedHealthInsurance":number (SE health insurance premiums deductible above-the-line; from Sch 1 line 17 or entity K-1 footnotes),',
    '  "hsaContribution":number (HSA contributions deductible above-the-line; from Form 8889 or payroll),',
    '  "withholding":number (total federal income tax withheld from W-2s for the plan year; Box 2 of W-2),',
    '  "estimatedTaxPaid":number (federal estimated tax payments already made for the plan year; Q1+Q2+Q3 if mid-year),',
    '  "priorYearTax":number (total federal income tax from prior year return; Form 1040 line 24 or 1120S Schedule D),',
    '  "keyObservations":[string]',
    '}',
  ].join("\n");

  const { content, hasInput } = await planningFileContent(payload.files, prompt);
  if (!hasInput && !instructions) {
    sendJson(res, 400, { error: "Upload at least one document or provide instructions before analyzing." });
    return;
  }
  const result = await callPlanningClaude(req, content, "Extract tax facts from documents. Return only valid JSON. Never compute or invent tax liability numbers.", "planning_analyze", payload, 4000);
  if (result.error) { sendJson(res, result.status || 502, { error: result.error, details: result.details || "" }); return; }

  const profile = normalizePlanningProfile(result.data);
  // Override taxYear with the explicitly chosen plan year
  profile.taxYear = planYear;
  const year = planYear;
  const currentTax = planningTax.computeScenarioTax(profile, [], year);
  sendJson(res, 200, {
    baseData: { ...profile, currentTax },
    keyObservations: Array.isArray(result.data.keyObservations) ? result.data.keyObservations.slice(0, 5).map((s) => String(s)) : [],
  });
}

async function handlePlanningScenarios(req, res) {
  const payload = await readJsonBody(req);
  const profile = normalizePlanningProfile(payload.baseData);
  const year = Number(payload.year) || profile.taxYear;
  const instructions = String(payload.instructions || "").slice(0, 4000);
  const base = buildPlanningBaseScenario(profile, year);

  const prompt = [
    "Given this client's tax profile and the CPA's instructions, propose 3 to 5 relevant tax-planning scenarios.",
    "",
    "PROFILE (facts):",
    JSON.stringify(profile),
    "",
    "BASE LIABILITY (already computed by the system, for reference): total = " + base.taxCalc.total,
    "",
    "CPA INSTRUCTIONS:",
    instructions || "(none)",
    "",
    "Each scenario is a set of ADJUSTMENTS to these allowed fields ONLY: " + PLANNING_FIELDS.join(", ") + ".",
    "Do NOT output tax numbers — the system computes them. Output only the levers to pull.",
    "Return ONLY JSON inside ```json``` fences:",
    '{ "scenarios": [ { "id": string, "name": string, "description": string,',
    '  "adjustments": [ { "field": string, "newValue": number, "rationale": string } ] } ] }',
    "Examples of good scenarios: max SEP-IRA (retirementContribution), Sec 179 asset purchase (sec179),",
    "S-corp salary optimization (wages/netSEIncome), defer income (otherIncome), bunch deductions (deductions).",
  ].join("\n");

  const result = await callPlanningClaude(req, [{ type: "text", text: prompt }], "You design tax-planning scenarios as field adjustments and return only valid JSON. Never output computed tax numbers.", "planning_scenarios", payload);
  if (result.error) { sendJson(res, result.status || 502, { error: result.error, details: result.details || "" }); return; }

  const defs = Array.isArray(result.data.scenarios) ? result.data.scenarios.slice(0, 5) : [];
  const scenarios = [base, ...defs.map((def, i) => finalizePlanningScenario(profile, def, base.taxCalc.total, year, i))];
  sendJson(res, 200, { scenarios });
}

async function handlePlanningScenarioCustom(req, res) {
  const payload = await readJsonBody(req);
  const profile = normalizePlanningProfile(payload.baseData);
  const year = Number(payload.year) || profile.taxYear;
  const instruction = String(payload.instruction || "").slice(0, 2000);
  const baseTotal = planningNum(payload.baseTotal) || planningTax.computeScenarioTax(profile, [], year).total;
  if (!instruction) { sendJson(res, 400, { error: "Describe the scenario you want to model." }); return; }

  const prompt = [
    "The CPA wrote this instruction for a new tax-planning scenario:",
    `"${instruction}"`,
    "",
    "Client profile (facts):",
    JSON.stringify(profile),
    "",
    "Convert it into ONE scenario expressed as adjustments to these allowed fields ONLY: " + PLANNING_FIELDS.join(", ") + ".",
    "If the instruction is ambiguous, assume the conservative case and say so in rationale.",
    "Do NOT output tax numbers. Return ONLY JSON inside ```json``` fences:",
    '{ "id": string, "name": string, "description": string,',
    '  "adjustments": [ { "field": string, "newValue": number, "rationale": string } ] }',
  ].join("\n");

  const result = await callPlanningClaude(req, [{ type: "text", text: prompt }], "You convert a natural-language tax-planning request into one scenario of field adjustments and return only valid JSON.", "planning_scenario_custom", payload, 4000);
  if (result.error) { sendJson(res, result.status || 502, { error: result.error, details: result.details || "" }); return; }

  const scenario = finalizePlanningScenario(profile, result.data, baseTotal, year, 0);
  sendJson(res, 200, { scenario });
}

async function handlePlanningOpportunities(req, res) {
  const payload = await readJsonBody(req);
  const profile = normalizePlanningProfile(payload.baseData);
  const scenarios = Array.isArray(payload.scenarios) ? payload.scenarios : [];
  // Feed the AI the system-computed savings so dollar figures originate from real math.
  const computedSavings = scenarios
    .filter((s) => s && !s.isBase)
    .map((s) => ({ name: s.name, savings: s?.savingsVsBase?.dollars || 0 }));

  const prompt = [
    "Given this client's profile and the system-computed scenario savings, identify the most relevant savings opportunities to present.",
    "",
    "PROFILE:", JSON.stringify(profile),
    "",
    "COMPUTED SCENARIO SAVINGS (use THESE dollar figures; do not invent your own math):",
    JSON.stringify(computedSavings),
    "",
    "Return ONLY JSON inside ```json``` fences:",
    '{ "opportunities": [ {',
    '  "id": string, "title": string, "category": string,',
    '  "estimatedSavings": { "min": number, "max": number },',
    '  "deadline": string|null, "complexity": "Simple"|"Moderate"|"Complex",',
    '  "description": string (<=2 sentences, plain language for the client),',
    '  "cpaNote": string (technical detail for the CPA), "requiresAction": boolean, "actionDeadline": string|null,',
    '  "scenarioName": string|null (name of the computed scenario that supports this savings figure — must match a name in COMPUTED SCENARIO SAVINGS exactly),',
    '  "calcExplanation": string (1-2 sentences explaining the specific tax mechanism: which field changes, how it reduces taxable income, and what the approximate savings breakdown is across federal/state/SE tax)',
    "} ] }",
    "Categories: Retirement Planning, Business Deductions, Entity Structure, Income Timing, Investment Strategy, Credits & Incentives, Estate & Gift, State Tax.",
  ].join("\n") + styleProfilePromptBlock(activeStyleProfile(req));

  const result = await callPlanningClaude(req, [{ type: "text", text: prompt }], "You identify tax-savings opportunities in plain language and return only valid JSON. Use the provided computed savings figures.", "planning_opportunities", payload);
  if (result.error) { sendJson(res, result.status || 502, { error: result.error, details: result.details || "" }); return; }

  const opportunities = (Array.isArray(result.data.opportunities) ? result.data.opportunities : []).slice(0, 12).map((o, i) => ({
    id: String(o.id || `opp-${i + 1}`),
    title: String(o.title || "Opportunity").slice(0, 160),
    category: String(o.category || "Other").slice(0, 60),
    estimatedSavings: { min: planningNum(o?.estimatedSavings?.min), max: planningNum(o?.estimatedSavings?.max) },
    deadline: o.deadline ? String(o.deadline).slice(0, 80) : null,
    complexity: ["Simple", "Moderate", "Complex"].includes(o.complexity) ? o.complexity : "Moderate",
    description: String(o.description || "").slice(0, 400),
    cpaNote: String(o.cpaNote || "").slice(0, 400),
    requiresAction: Boolean(o.requiresAction),
    actionDeadline: o.actionDeadline ? String(o.actionDeadline).slice(0, 80) : null,
    scenarioName: o.scenarioName ? String(o.scenarioName).slice(0, 160) : null,
    calcExplanation: o.calcExplanation ? String(o.calcExplanation).slice(0, 600) : null,
  }));
  sendJson(res, 200, { opportunities });
}

// Deterministic recompute for manual scenario edits — no AI, pure tax math.
async function handlePlanningRecompute(req, res) {
  const payload = await readJsonBody(req);
  const profile = normalizePlanningProfile(payload.baseData);
  const year = Number(payload.year) || profile.taxYear;
  const adjustments = sanitizePlanningAdjustments(payload.adjustments);
  const baseTotal = planningNum(payload.baseTotal) || planningTax.computeScenarioTax(profile, [], year).total;
  const taxCalc = planningTax.computeScenarioTax(profile, adjustments, year);
  const dollars = planningRound(baseTotal - taxCalc.total);
  const percentage = baseTotal > 0 ? planningRound((dollars / baseTotal) * 100) : 0;
  sendJson(res, 200, { taxCalc, savingsVsBase: { dollars, percentage }, adjustments });
}

// Maps the active style profile's extracted visual theme to pptx-builder theme fields.
function buildThemeFromProfile(profile) {
  const colors = profile?.combinedSummary?.colors;
  const fonts = profile?.combinedSummary?.fonts;
  if (!colors && !fonts) return {};
  const theme = {};
  if (colors) {
    // dk2 = secondary dark (brand primary), accent1 = first accent, accent2 = second accent
    // lt1 = light background, dk1 = dark text
    if (colors.dk2)     theme.primaryColor    = colors.dk2;
    if (colors.accent1) theme.secondaryColor  = colors.accent1;
    if (colors.accent2) theme.accentColor     = colors.accent2;
    if (colors.lt1)     theme.backgroundColor = colors.lt1;
    if (colors.dk1)     theme.textColor       = colors.dk1;
  }
  if (fonts) {
    if (fonts.title) theme.fontTitle = fonts.title;
    if (fonts.body)  theme.fontBody  = fonts.body;
  }
  return theme;
}

async function handlePlanningDeck(req, res) {
  const payload = await readJsonBody(req);
  const profile = activeStyleProfile(req);
  try {
    const buffer = await buildPlanningDeck({
      clientName: payload.clientName || payload?.baseData?.clientName || "Client",
      year: payload.year || payload?.baseData?.taxYear || new Date().getFullYear(),
      firmName: payload.firmName || "RAG Tax AI",
      baseData: payload.baseData || {},
      scenarios: Array.isArray(payload.scenarios) ? payload.scenarios : [],
      opportunities: Array.isArray(payload.opportunities) ? payload.opportunities : [],
      nextSteps: Array.isArray(payload.nextSteps) ? payload.nextSteps : [],
      disclaimer: payload.disclaimer || profile?.combinedSummary?.disclaimer || "",
      // Merge: profile visual theme overrides any client-side theme override
      theme: { ...buildThemeFromProfile(profile), ...(payload.theme || {}) },
    });
    const clientSlug = safeFileName(String(payload.clientName || payload?.baseData?.clientName || "Client"));
    const year = String(payload.year || payload?.baseData?.taxYear || new Date().getFullYear());
    sendJson(res, 200, {
      filename: `TaxPlanning_${clientSlug}_${year}.pptx`,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      contentBase64: buffer.toString("base64"),
    });
  } catch (error) {
    sendJson(res, 502, { error: `Could not generate the planning deck: ${error.message || "unknown error"}` });
  }
}

// ---------------------------------------------------------------------------
// Merged generate: scenarios + opportunities in one AI call.
// ---------------------------------------------------------------------------
async function handlePlanningGenerate(req, res) {
  const payload = await readJsonBody(req);
  const profile = normalizePlanningProfile(payload.baseData);
  const year = Number(payload.year) || profile.taxYear;
  const instructions = String(payload.instructions || "").slice(0, 4000);
  const clientType = String(payload.clientType || "").slice(0, 20);
  const linkedEntities = Array.isArray(payload.linkedEntities) ? payload.linkedEntities.slice(0, 3) : [];
  const base = buildPlanningBaseScenario(profile, year);

  const typeHints = {
    "1040":  "Focus on individual: retirement (SEP-IRA/Solo-401k/Defined Benefit), S-corp election, QBI, capital gains harvesting, NIIT, deduction bunching.",
    "1120S": "Focus on S-corp: reasonable salary optimization (wages vs distributions), retirement plan, Sec 179/bonus depreciation, QBID, shareholder basis.",
    "1065":  "Focus on partnership: guaranteed payments vs distributions, self-employment tax on GPs, basis planning, section 754 election, retirement for partners.",
    "1120":  "Focus on C-corp: accumulated earnings, salary vs dividend, fiscal year selection, Sec 179/bonus depreciation, deferred compensation, NOL planning.",
    "990":   "Focus on exempt org: UBIT exposure, compensation reasonableness, endowment investment policy, state registration compliance.",
  };
  const typeContext = clientType
    ? `Return type: ${clientType}. ${typeHints[clientType] || ""}`
    : "";
  const linkedNote = linkedEntities.length
    ? `Linked entities in scope: ${linkedEntities.map((e) => `${e.type}${e.name ? ` (${e.name})` : ""}`).join(", ")}.`
    : "";

  const prompt = [
    `Client tax profile (${clientType || "unknown"}, planning year ${year}): ` + JSON.stringify(profile),
    "Base tax (system-computed): $" + Math.round(base.taxCalc.total).toLocaleString(),
    typeContext,
    linkedNote,
    "CPA instructions: " + (instructions || "(none)"),
    "",
    "Propose 3-5 tax-planning scenarios as field ADJUSTMENTS only. No tax numbers — the system computes them.",
    "Allowed fields: " + PLANNING_FIELDS.join(", "),
    "Good levers: max SEP-IRA/Solo-401k (retirementContribution), Sec 179 purchase (sec179), S-corp salary split (wages+netSEIncome), defer income (otherIncome), bunch deductions.",
    "",
    'Return ONLY JSON in ```json``` fences:',
    '{"scenarios":[{"id":string,"name":string,"description":string,"adjustments":[{"field":string,"newValue":number,"rationale":string}]}]}',
  ].join("\n");

  const result = await callPlanningClaude(req, [{ type: "text", text: prompt }], "Design tax-planning scenarios as field adjustments. Return only valid JSON. Never output computed tax numbers.", "planning_generate", payload, 6000);
  if (result.error) { sendJson(res, result.status || 502, { error: result.error, details: result.details || "" }); return; }

  const defs = Array.isArray(result.data.scenarios) ? result.data.scenarios.slice(0, 5) : [];
  const scenarios = [base, ...defs.map((def, i) => finalizePlanningScenario(profile, def, base.taxCalc.total, year, i))];
  sendJson(res, 200, { scenarios });
}

// ---------------------------------------------------------------------------
// Quarterly estimated tax payments — deterministic, no AI.
// ---------------------------------------------------------------------------
async function handlePlanningQuarterly(req, res) {
  const payload = await readJsonBody(req);
  const profile = normalizePlanningProfile(payload.baseData);
  const year = Number(payload.year) || profile.taxYear;
  const adjustments = sanitizePlanningAdjustments(payload.adjustments || []);
  const taxCalc = planningTax.computeScenarioTax(profile, adjustments, year);
  const annual = taxCalc.total;
  const q = Math.ceil(annual / 4);
  const quarters = [
    { quarter: "Q1", label: `April 15, ${year}`, amount: q },
    { quarter: "Q2", label: `June 16, ${year}`, amount: q },
    { quarter: "Q3", label: `September 15, ${year}`, amount: q },
    { quarter: "Q4", label: `January 15, ${year + 1}`, amount: Math.max(0, annual - q * 3) },
  ];
  sendJson(res, 200, {
    annual,
    quarters,
    taxCalc,
    note: "Quarterly estimates based on 100% of projected current-year liability. Actual amounts may vary based on withholding and safe-harbor rules.",
  });
}

// ---------------------------------------------------------------------------
// HTML deck — standalone print-to-PDF page, no external deps.
// ---------------------------------------------------------------------------
async function handlePlanningDeckHtml(req, res) {
  const payload = await readJsonBody(req);
  const clientName = String(payload.clientName || payload?.baseData?.clientName || "Client");
  const year = String(payload.year || payload?.baseData?.taxYear || new Date().getFullYear());
  const scenarios = Array.isArray(payload.scenarios) ? payload.scenarios : [];
  const opportunities = Array.isArray(payload.opportunities) ? payload.opportunities : [];
  const nextSteps = Array.isArray(payload.nextSteps) ? payload.nextSteps : [];
  const profile = activeStyleProfile(req);
  const disclaimer = payload.disclaimer || profile?.combinedSummary?.disclaimer
    || "Prepared for planning purposes only. Figures are estimates based on information provided and current tax law. Consult your tax advisor before taking action.";

  const base = scenarios.find((s) => s.isBase) || scenarios[0] || {};
  const baseCalc = base.taxCalc || {};
  const fmt = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
  const fmtPct = (n) => { const v = Number(n) || 0; return ((Math.abs(v) <= 1 ? v * 100 : v).toFixed(1)) + "%"; };

  const scenarioRows = scenarios.map((s) => {
    const c = s.taxCalc || {};
    const sav = s?.savingsVsBase?.dollars || 0;
    const isBest = !s.isBase && sav > 0;
    return `<tr${isBest ? ' class="best"' : ""}><td>${s.name || ""}${isBest ? " ★" : ""}</td><td>${fmt(c.federalTax)}</td><td>${fmt(c.stateTax)}</td><td>${fmt(c.seTax)}</td><td><strong>${fmt(c.total)}</strong></td><td>${sav > 0 ? `<strong>${fmt(sav)}</strong>` : "—"}</td><td>${fmtPct(c.effectiveRate)}</td></tr>`;
  }).join("");

  const oppCards = [...opportunities]
    .sort((a, b) => (Number(b?.estimatedSavings?.max) || 0) - (Number(a?.estimatedSavings?.max) || 0))
    .slice(0, 8)
    .map((o) => {
      const min = Number(o?.estimatedSavings?.min) || 0;
      const max = Number(o?.estimatedSavings?.max) || 0;
      return `<div class="opp"><h3>${o.title || ""}</h3><p class="range">${max ? `${fmt(min)}–${fmt(max)} potential savings` : ""}</p><p class="cat">${o.category || ""} · ${o.complexity || "Moderate"}</p><p>${o.description || ""}</p></div>`;
    }).join("");

  const stepsHtml = nextSteps.length
    ? `<div class="page"><h2>Next Steps</h2><ol>${nextSteps.map((s) => `<li><strong>${s.action || ""}</strong>${s.deadline ? ` — by ${s.deadline}` : ""}<span class="owner">${s.owner || ""}</span></li>`).join("")}</ol></div>`
    : "";

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Tax Planning — ${clientName} ${year}</title><style>@page{size:letter;margin:1in}*{box-sizing:border-box}body{font-family:Georgia,serif;color:#1a1a2e;font-size:12pt}h1{font-size:24pt;margin-bottom:4pt}h2{font-size:16pt;border-bottom:1px solid #ddd;padding-bottom:4pt;margin-top:24pt}.page{page-break-after:always}.cover{text-align:center;padding-top:2in}.hero{display:flex;gap:24pt;margin:20pt 0}.hero div{text-align:center;flex:1;background:#f5f5f5;padding:12pt;border-radius:4pt}.num{display:block;font-size:20pt;font-weight:bold}label{font-size:9pt;color:#555}table{width:100%;border-collapse:collapse;margin-top:12pt;font-size:10pt}th{background:#1a1a2e;color:#fff;padding:6pt 8pt;text-align:left}td{padding:5pt 8pt;border-bottom:1px solid #eee}tr.best td{background:#f0fff4;font-weight:bold}.opps{display:grid;grid-template-columns:1fr 1fr;gap:12pt;margin-top:12pt}.opp{border:1px solid #ddd;border-radius:4pt;padding:10pt}.opp h3{margin:0 0 4pt;font-size:11pt}.range{color:#16a34a;font-weight:bold;font-size:10pt;margin:2pt 0}.cat{color:#666;font-size:9pt;margin:2pt 0}ol li{margin-bottom:8pt}.owner{margin-left:8pt;color:#666;font-size:10pt}footer{font-size:8pt;color:#888;border-top:1px solid #ddd;padding-top:8pt;margin-top:24pt}.tip{margin-top:24pt;font-size:10pt;background:#f0f9ff;padding:10pt;border-radius:4pt}@media print{.tip{display:none}}</style></head><body>
<div class="page cover"><h1>Tax Planning Analysis</h1><p style="color:#555">${clientName}</p><p style="color:#555">Tax Year ${year}</p><p style="margin-top:12pt;color:#999;font-size:10pt">Prepared ${new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</p><p class="tip">To save as PDF: Press <strong>Ctrl+P</strong> (Windows) or <strong>Cmd+P</strong> (Mac) → choose <strong>Save as PDF</strong>.</p></div>
<div class="page"><h2>Current Situation</h2><div class="hero"><div><span class="num">${fmt(baseCalc.total)}</span><label>Total tax</label></div><div><span class="num">${fmtPct(baseCalc.effectiveRate)}</span><label>Effective rate</label></div><div><span class="num">${fmt(baseCalc.taxableIncome)}</span><label>Taxable income</label></div></div><h2>Scenario Comparison</h2><table><thead><tr><th>Scenario</th><th>Federal</th><th>State</th><th>SE Tax</th><th>Total</th><th>Savings</th><th>Eff. Rate</th></tr></thead><tbody>${scenarioRows}</tbody></table></div>
${oppCards ? `<div class="page"><h2>Recommended Opportunities</h2><div class="opps">${oppCards}</div></div>` : ""}
${stepsHtml}
<footer>${disclaimer}</footer></body></html>`;

  sendJson(res, 200, { html, filename: `TaxPlanning_${safeFileName(clientName)}_${year}.html` });
}

// ---------------------------------------------------------------------------
// Saved analyses — per-user CRUD, no AI.
// ---------------------------------------------------------------------------
const PLANNING_SAVED_PATH = path.join(DATA_DIR, "planning_saved.json");
function readPlanningSaved() { return readJsonFile(PLANNING_SAVED_PATH, {}); }
function writePlanningSaved(store) { writeJsonFile(PLANNING_SAVED_PATH, store); }

async function handlePlanningSaved(req, res, requestUrl) {
  const key = planningUserKey(req);
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const id = parts[3];

  if (req.method === "GET" && !id) {
    const store = readPlanningSaved();
    const list = Array.isArray(store[key]) ? store[key] : [];
    sendJson(res, 200, { saved: list.map(({ id: eid, clientName, taxYear, savedAt }) => ({ id: eid, clientName, taxYear, savedAt })) });
    return;
  }
  if (req.method === "GET" && id) {
    const store = readPlanningSaved();
    const entry = (store[key] || []).find((e) => e.id === id);
    if (!entry) { sendJson(res, 404, { error: "Not found." }); return; }
    sendJson(res, 200, { entry });
    return;
  }
  if (req.method === "POST" && !id) {
    const payload = await readJsonBody(req);
    const store = readPlanningSaved();
    if (!Array.isArray(store[key])) store[key] = [];
    if (store[key].length >= 20) store[key].shift();
    const entry = {
      id: crypto.randomUUID(),
      clientName: String(payload.clientName || "").slice(0, 120),
      taxYear: Number(payload.taxYear) || new Date().getFullYear(),
      savedAt: new Date().toISOString(),
      baseData: payload.baseData || {},
      scenarios: Array.isArray(payload.scenarios) ? payload.scenarios : [],
      opportunities: Array.isArray(payload.opportunities) ? payload.opportunities : [],
    };
    store[key].push(entry);
    writePlanningSaved(store);
    sendJson(res, 200, { id: entry.id, savedAt: entry.savedAt });
    return;
  }
  if (req.method === "DELETE" && id) {
    const store = readPlanningSaved();
    if (!Array.isArray(store[key])) { sendJson(res, 404, { error: "Not found." }); return; }
    const idx = store[key].findIndex((e) => e.id === id);
    if (idx === -1) { sendJson(res, 404, { error: "Not found." }); return; }
    store[key].splice(idx, 1);
    writePlanningSaved(store);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 405, { error: "Method not allowed." });
}

// ---------------------------------------------------------------------------
// Phase 2 — Template Library + Style Profile.
// Per-user JSON stores (firm style learned from prior presentations).
// ---------------------------------------------------------------------------

const PLANNING_TEMPLATES_PATH = path.join(DATA_DIR, "planning_templates.json");
const PLANNING_STYLE_PROFILE_PATH = path.join(DATA_DIR, "planning_style_profile.json");
const PLANNING_TEMPLATE_CATEGORIES = ["presentation", "recommendation", "template"];

function planningUserKey(req) {
  return String(req?.user?.username || "firm");
}

function readPlanningTemplates() {
  return readJsonFile(PLANNING_TEMPLATES_PATH, {});
}
function writePlanningTemplates(store) {
  writeJsonFile(PLANNING_TEMPLATES_PATH, store);
}
function readPlanningProfiles() {
  return readJsonFile(PLANNING_STYLE_PROFILE_PATH, {});
}
function writePlanningProfiles(store) {
  writeJsonFile(PLANNING_STYLE_PROFILE_PATH, store);
}

function userPlanningTemplates(req) {
  const store = readPlanningTemplates();
  const list = store[planningUserKey(req)];
  return Array.isArray(list) ? list : [];
}

function activeStyleProfile(req) {
  const profiles = readPlanningProfiles();
  const profile = profiles[planningUserKey(req)];
  return profile && profile.combinedSummary ? profile : null;
}

// Returns true when a style field contains a real extracted value (not an error/unknown placeholder).
function isUsableStyleValue(v) {
  if (!v) return false;
  const s = String(v).toLowerCase().trim();
  if (!s || s === "unknown" || s === "n/a" || s === "none" || s === "null") return false;
  // AI returned an error message when extraction failed
  if (s.includes("could not be extracted") || s.includes("could not be parsed") ||
      s.includes("binary") || s.includes("not readable") || s.includes("unable to determine") ||
      s.includes("not identifiable")) return false;
  return true;
}

// Strips a style-summary object down to the known shape (defends the prompt).
function sanitizeStyleSummary(obj = {}) {
  const arr = (v) => (Array.isArray(v) ? v.slice(0, 12).map((x) => String(x).slice(0, 200)).filter(isUsableStyleValue) : []);
  const clean = (v) => { const s = String(v || "").slice(0, 200); return isUsableStyleValue(s) ? s : ""; };
  const summary = {
    tone: clean(obj.tone),
    structure: arr(obj.structure),
    numberFormat: clean(obj.numberFormat),
    keyPhrases: arr(obj.keyPhrases),
    disclaimer: isUsableStyleValue(obj.disclaimer) ? String(obj.disclaimer || "").slice(0, 1000) : "",
    recommendationStyle: clean(obj.recommendationStyle),
    clientLanguage: clean(obj.clientLanguage),
  };
  // Preserve visual theme extracted separately (not via Claude)
  if (obj.colors && typeof obj.colors === "object") summary.colors = obj.colors;
  if (obj.fonts && typeof obj.fonts === "object") summary.fonts = obj.fonts;
  // Flag profiles that are essentially empty after cleaning
  const usableFields = [summary.tone, summary.numberFormat, summary.recommendationStyle, summary.clientLanguage]
    .filter(Boolean).length + summary.keyPhrases.length + summary.structure.length;
  summary._extractionQuality = usableFields >= 2 ? "good" : "failed";
  return summary;
}

function styleProfilePromptBlock(profile) {
  if (!profile || !profile.combinedSummary) return "";
  const s = profile.combinedSummary;
  // Don't pollute the prompt with a failed/empty profile
  if (s._extractionQuality === "failed") return "";
  const lines = [
    "",
    "IMPORTANT — FIRM STYLE (match these preferences in all wording you generate):",
  ];
  if (s.tone) lines.push(`- Tone: ${s.tone}`);
  if (s.structure?.length) lines.push(`- Typical structure: ${s.structure.join("; ")}`);
  if (s.numberFormat) lines.push(`- How numbers are presented: ${s.numberFormat}`);
  if (s.keyPhrases?.length) lines.push(`- Characteristic phrases: ${s.keyPhrases.join("; ")}`);
  if (s.recommendationStyle) lines.push(`- Recommendation style: ${s.recommendationStyle}`);
  if (s.clientLanguage) lines.push(`- Client language level: ${s.clientLanguage}`);
  if (s.disclaimer) lines.push(`- Standard disclaimer: ${s.disclaimer}`);
  // If only the header line was added, nothing useful — skip the block
  if (lines.length <= 2) return "";
  return lines.join("\n");
}

async function generateStyleSummary(req, file, category) {
  const prompt = [
    "Analyze this tax-planning document from a CPA firm.",
    `It is an example of a ${category} the firm used with a client.`,
    "",
    "DOCUMENT TEXT:",
    "__FILE_TEXT__",
    "",
    "Extract and return ONLY JSON inside ```json``` fences with this exact shape:",
    "{",
    '  "tone": string, "structure": [string], "numberFormat": string,',
    '  "keyPhrases": [string] (max 10), "disclaimer": string,',
    '  "recommendationStyle": string, "clientLanguage": string',
    "}",
  ].join("\n");
  const { content, hasInput } = await planningFileContent([file], prompt);
  if (!hasInput) return { error: "No readable content in the uploaded template." };
  const result = await callPlanningClaude(req, content, "You analyze a CPA firm's planning document and return only valid JSON describing its style.", "planning_style_summary", { category }, 3000);
  if (result.error) return result;
  const summary = sanitizeStyleSummary(result.data);
  // For PPTX, extract visual theme (colors/fonts) directly from the ZIP — no AI guessing needed
  const isPptx = /\.pptx$/i.test(file.name) || (file.type || "").includes("presentationml");
  if (isPptx && file.content) {
    try {
      const visualTheme = extractPptxVisualTheme(Buffer.from(file.content, "base64"));
      if (visualTheme) {
        if (visualTheme.colors) summary.colors = visualTheme.colors;
        if (visualTheme.fonts) summary.fonts = visualTheme.fonts;
      }
    } catch (_) {}
  }
  return { data: summary };
}

async function regeneratePlanningProfile(req) {
  const templates = userPlanningTemplates(req).filter((t) => t.isActive && t.styleSummary);
  const profiles = readPlanningProfiles();
  const key = planningUserKey(req);
  if (!templates.length) {
    delete profiles[key];
    writePlanningProfiles(profiles);
    return { profile: null };
  }
  // Pick visual theme from the most recently uploaded active PPTX template
  const templateWithTheme = [...templates].reverse().find((t) => t.styleSummary?.colors || t.styleSummary?.fonts);

  if (templates.length === 1) {
    profiles[key] = { combinedSummary: templates[0].styleSummary, lastUpdated: new Date().toISOString(), templateCount: 1 };
    writePlanningProfiles(profiles);
    return { profile: profiles[key] };
  }
  const summaries = templates.map((t) => t.styleSummary);
  const prompt = [
    "You are given style summaries from a CPA firm's planning documents.",
    "Combine the best of each into ONE coherent style profile. On conflicts, prefer the most recent.",
    "",
    "SUMMARIES (most recent last):",
    JSON.stringify(summaries),
    "",
    "Return ONLY JSON inside ```json``` fences with the same shape as an individual summary:",
    '{ "tone": string, "structure": [string], "numberFormat": string, "keyPhrases": [string], "disclaimer": string, "recommendationStyle": string, "clientLanguage": string }',
  ].join("\n");
  const result = await callPlanningClaude(req, [{ type: "text", text: prompt }], "You merge CPA-firm style summaries into one profile and return only valid JSON.", "planning_style_profile", {}, 3000);
  if (result.error) return result;
  const combined = sanitizeStyleSummary(result.data);
  // Carry the visual theme from the PPTX template into the combined profile
  if (templateWithTheme?.styleSummary?.colors) combined.colors = templateWithTheme.styleSummary.colors;
  if (templateWithTheme?.styleSummary?.fonts) combined.fonts = templateWithTheme.styleSummary.fonts;
  profiles[key] = { combinedSummary: combined, lastUpdated: new Date().toISOString(), templateCount: templates.length };
  writePlanningProfiles(profiles);
  return { profile: profiles[key] };
}

function publicPlanningTemplate(t) {
  return {
    id: t.id, filename: t.filename, fileType: t.fileType, category: t.category,
    uploadedAt: t.uploadedAt, isActive: t.isActive, styleSummary: t.styleSummary,
    extractionFailed: t.styleSummary?._extractionQuality === "failed",
  };
}

async function handlePlanningTemplatesApi(req, res, requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean); // ["api","planning","templates", maybe id/regenerate-profile]
  const key = planningUserKey(req);

  // POST /api/planning/templates/regenerate-profile
  if (req.method === "POST" && parts[3] === "regenerate-profile") {
    const result = await regeneratePlanningProfile(req);
    if (result.error) { sendJson(res, result.status || 502, { error: result.error }); return; }
    sendJson(res, 200, { styleProfile: result.profile });
    return;
  }

  // GET /api/planning/templates
  if (req.method === "GET" && !parts[3]) {
    sendJson(res, 200, {
      templates: userPlanningTemplates(req).map(publicPlanningTemplate),
      styleProfile: activeStyleProfile(req),
    });
    return;
  }

  // POST /api/planning/templates  (upload one file -> style summary)
  if (req.method === "POST" && !parts[3]) {
    const payload = await readJsonBody(req);
    const file = payload.file || {};
    if (!file.name || !file.content) { sendJson(res, 400, { error: "Upload a file (name + content) to add a template." }); return; }
    const category = PLANNING_TEMPLATE_CATEGORIES.includes(payload.category) ? payload.category : "presentation";
    const summary = await generateStyleSummary(req, file, category);
    if (summary.error) { sendJson(res, summary.status || 502, { error: summary.error }); return; }

    const store = readPlanningTemplates();
    if (!Array.isArray(store[key])) store[key] = [];
    const template = {
      id: crypto.randomUUID(),
      filename: String(file.name).slice(0, 200),
      fileType: String(file.type || mimeFromName(file.name) || "").slice(0, 120),
      category,
      uploadedAt: new Date().toISOString(),
      rawText: "", // not persisted to keep the store light; summary is what matters
      styleSummary: summary.data,
      isActive: true,
    };
    store[key].push(template);
    writePlanningTemplates(store);
    await regeneratePlanningProfile(req);
    sendJson(res, 200, { template: publicPlanningTemplate(template), styleProfile: activeStyleProfile(req) });
    return;
  }

  // PATCH /api/planning/templates/:id  (toggle active)
  if (req.method === "PATCH" && parts[3]) {
    const payload = await readJsonBody(req);
    const store = readPlanningTemplates();
    const list = Array.isArray(store[key]) ? store[key] : [];
    const target = list.find((t) => t.id === parts[3]);
    if (!target) { sendJson(res, 404, { error: "Template not found." }); return; }
    if (payload.isActive != null) target.isActive = Boolean(payload.isActive);
    writePlanningTemplates(store);
    await regeneratePlanningProfile(req);
    sendJson(res, 200, { template: publicPlanningTemplate(target), styleProfile: activeStyleProfile(req) });
    return;
  }

  // DELETE /api/planning/templates/:id
  if (req.method === "DELETE" && parts[3]) {
    const store = readPlanningTemplates();
    const list = Array.isArray(store[key]) ? store[key] : [];
    const next = list.filter((t) => t.id !== parts[3]);
    store[key] = next;
    writePlanningTemplates(store);
    await regeneratePlanningProfile(req);
    sendJson(res, 200, { ok: true, styleProfile: activeStyleProfile(req) });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
}

function summarizeEstimatedTaxFiles(files = []) {
  const buckets = {
    financial_report: [],
    prior_year_template: [],
    supporting_document: [],
    other: [],
  };
  for (const file of Array.isArray(files) ? files : []) {
    const role = String(file.role || "financial_report");
    const bucket = buckets[role] || buckets.other;
    bucket.push({ name: String(file.name || "Uploaded file"), type: String(file.type || ""), size: Number(file.size || 0) });
  }
  return {
    financialReports: buckets.financial_report,
    priorYearTemplates: buckets.prior_year_template,
    supportingDocuments: buckets.supporting_document,
    other: buckets.other,
    hasTemplate: buckets.prior_year_template.length > 0,
  };
}

function decodeEstimatedTextContent(payload = {}) {
  const type = String(payload.type || "").toLowerCase();
  const name = String(payload.name || "").toLowerCase();
  if (!payload.content || (!type.includes("text") && !type.includes("csv") && !/\.csv$|\.txt$/i.test(name))) return "";
  try {
    return Buffer.from(String(payload.content || ""), "base64").toString("utf8");
  } catch (_) {
    return "";
  }
}

function normalizeEstimatedTaxesPayload(payload = {}) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const byRole = (role) => files.find((file) => String(file.role || "") === role) || null;
  const entityType = normalizeEstimatedEntityTypeServer(payload.entityType || payload.returnType || "1040");
  const customTemplateFile = payload.customTemplateFile || payload.templateFile || byRole("custom_template") || byRole("prior_year_template") || null;
  const templateFile = customTemplateFile;
  const plFile = payload.plFile || byRole("current_year_pl") || files.find((file) => detectEstimatedDocumentType(file) === "PL_STATEMENT") || null;
  const balanceSheetFile = payload.balanceSheetFile || byRole("current_year_balance_sheet") || null;
  const taxReturnFiles = Array.isArray(payload.taxReturnFiles) ? payload.taxReturnFiles : files.filter((file) => /return/i.test(String(file.role || "")));
  const normalizedFiles = [
    templateFile ? { ...templateFile, role: "custom_template" } : null,
    plFile ? { ...plFile, role: "current_year_pl" } : null,
    balanceSheetFile ? { ...balanceSheetFile, role: "current_year_balance_sheet" } : null,
    ...taxReturnFiles.map((file) => ({ ...file, role: file.role || "prior_year_return" })),
  ].filter(Boolean);
  return {
    ...payload,
    entityType,
    period: normalizeEstimatedPeriod(payload.period || payload.quarter || "Q1"),
    quarter: normalizeEstimatedPeriod(payload.period || payload.quarter || "Q1"),
    returnType: estimatedEntityDisplayName(entityType),
    federalPayments: payload.federalPayments || {},
    statePayments: Array.isArray(payload.statePayments) ? payload.statePayments : [],
    customTemplateFile,
    templateFile,
    plFile,
    balanceSheetFile,
    taxReturnFiles,
    files: normalizedFiles,
  };
}

function normalizeEstimatedEntityTypeServer(entityType) {
  const value = String(entityType || "1040").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (value === "1120S") return "1120S";
  if (["1040", "1041", "1065", "1120"].includes(value)) return value;
  return "1040";
}

function estimatedEntityDisplayName(entityType) {
  const value = normalizeEstimatedEntityTypeServer(entityType);
  return value === "1120S" ? "1120-S" : value;
}

function normalizeEstimatedPeriod(period) {
  const value = String(period || "Q1").toUpperCase();
  return ["Q1", "Q2", "Q3", "Q4", "ANNUAL"].includes(value) ? value : "Q1";
}

function estimatedTemplatePathForEntity(entityType) {
  const value = normalizeEstimatedEntityTypeServer(entityType);
  const fileName = `EstTax_Template_${value}.xlsx`;
  return path.join(ROOT, "templates", "estimates", fileName);
}

function estimatedTemplateContext(payload = {}) {
  if (payload.templateFile?.text) {
    return {
      source: `Custom uploaded template: ${payload.templateFile.name || "template"}`,
      text: String(payload.templateFile.text || "").slice(0, 90000),
    };
  }
  if (payload.templateFile?.content) {
    try {
      const buffer = Buffer.from(String(payload.templateFile.content || ""), "base64");
      return {
        source: `Custom uploaded template: ${payload.templateFile.name || "template"}`,
        text: extractXlsxText(buffer).slice(0, 90000),
      };
    } catch (_) {}
  }
  const templatePath = estimatedTemplatePathForEntity(payload.entityType);
  if (templatePath && fsSync.existsSync(templatePath)) {
    try {
      return {
        source: `Standard template: ${path.basename(templatePath)}`,
        text: extractXlsxText(fsSync.readFileSync(templatePath)).slice(0, 90000),
      };
    } catch (_) {}
  }
  return { source: "No template readable", text: "" };
}

async function buildEstimatedTaxesCompleteWithClaude(req, payload) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return { error: "Claude API key is not configured. The estimated tax workpaper cannot be generated without AI extraction.", status: 400 };
  const fileContext = await buildEstimatedTaxFileContext(payload.files || []);
  const templateContext = estimatedTemplateContext(payload);
  if (!fileContext.hasText && !fileContext.documents.length && !fileContext.images.length) {
    return { error: "No readable text could be extracted from the uploaded files. Upload readable XLSX/PDF/CSV files.", status: 400 };
  }
  const plPeriod = detectEstimatedTaxPeriod(payload.plFile || {}) || fileContext.plSummary?.files?.[0]?.period || null;
  const plMonths = Number(payload.plMonthsOverride || plPeriod?.months || 0) || null;
  const annFactor = plMonths ? +(12 / plMonths).toFixed(4) : null;
  const content = [
    ...fileContext.documents.slice(0, 8).map((doc) => ({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: doc.content },
      title: doc.name,
      context: doc.role || "estimated tax source file",
    })),
    ...fileContext.images.slice(0, 6).map((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.type || "image/png", data: image.content },
    })),
    { type: "text", text: buildEstimatedTaxesCompletePrompt(payload, fileContext, { plPeriod, plMonths, annFactor, templateContext }) },
  ];
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 16000,
    webSearch: false,
    models: [...MODEL_FALLBACKS, "claude-sonnet-4-5-20250929"],
    thinking: { type: "enabled", budget_tokens: 10000 },
    system: [{
      type: "text",
      text: withDatabaseContext([
        "You are a senior CPA estimated-tax workpaper preparer.",
        "You must read the uploaded prior-year template, current-year P&L, optional balance sheet, and tax returns.",
        "The current-year P&L uploaded in Zone 2 is the authoritative source for current-year income and expenses.",
        "Do not combine current-year P&L data with old P&L/template data. Prior-year template values are structure/context only.",
        "If a current-year amount is absent from the current-year P&L, treat it as zero or missing and flag it. Do not silently reuse the prior-year amount.",
        "Schedule A standard/itemized deduction data must come from the prior-year return Schedule A when relevant. Other taxes must come from Schedule 2.",
        "For book-to-tax adjustments, reconcile the current-year P&L, then annualize the reconciled taxable income.",
        "Projected income is calculated from taxable income plus book-to-tax adjustments, not from net operating income.",
        "Return only valid JSON inside ```json``` fences using the requested complete estimated tax schema. Do not include prose outside JSON.",
      ].join("\n"), payload, "estimated_taxes"),
    }],
  });
  if (!result.ok) return { error: `Claude could not complete the estimate calculation: ${result.error}`, status: result.status || 502 };
  logClaudeCost(req, result, "estimated_taxes", "estimated_taxes", payload, startedAt);
  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  if (!parsed) return { error: "Claude did not return valid workbook JSON. No Excel file was generated.", status: 502, details: raw.slice(0, 2000) };
  const normalized = normalizeEstimatedCompleteResult(parsed, payload, { plPeriod, plMonths, annFactor });
  normalized.workbook = buildEstimatedCompleteWorkbook(normalized, payload);
  try {
    const xlsxBuffer = buildSimpleXlsx(normalized.workbook);
    normalized.filename = buildEstimatedCompleteWorkbookFileName(normalized);
    normalized.mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    normalized.contentBase64 = xlsxBuffer.toString("base64");
  } catch (error) {
    normalized.workbookBuildWarning = error.message || "Workbook file could not be generated server-side.";
  }
  normalized.aiWorkbookStatus = "AI generated the workpaper from the uploaded template, current-year P&L, and supporting files.";
  normalized.email = { subject: normalized.emailSubject || "", body: normalized.emailBody || "" };
  normalized.paymentSummary = estimatedCompletePaymentSummary(normalized);
  return normalized;
}

function buildEstimatedTaxesCompletePrompt(payload, fileContext, periodInfo = {}) {
  const federal = payload.federalPayments || {};
  const statePayments = Array.isArray(payload.statePayments) ? payload.statePayments : [];
  const templateContext = periodInfo.templateContext || { source: "", text: "" };
  return [
    "TASK: Fill an estimated tax Excel workpaper using the selected entity template and uploaded source files.",
    "",
    "CLIENT AND PERIOD:",
    `Client: ${payload.clientName || "Client"}`,
    `Entity type: ${estimatedEntityDisplayName(payload.entityType || payload.returnType || "1040")}`,
    `Tax year: ${payload.taxYear || ""}`,
    `Selected period: ${payload.period || payload.quarter || ""}`,
    `P&L detected period: ${periodInfo.plPeriod?.label || "not detected"}`,
    `P&L months override / final months: ${periodInfo.plMonths || "not provided"}`,
    `Annualization factor: ${periodInfo.annFactor || "not available"}`,
    "",
    "PRIOR PAYMENTS:",
    `Federal: ${safeJsonForPrompt(federal, 2000)}`,
    `State: ${safeJsonForPrompt(statePayments, 3000)}`,
    "",
    "USER NOTES:",
    payload.notes || "(none)",
    "",
    "STRICT RULES:",
    "0. First read the template structure below. Use it to decide the sections, labels, and workpaper flow that must be completed.",
    "1. Zone 2 current-year P&L is authoritative for current-year income and expenses.",
    "2. Never copy prior-year/template/P&L-old amounts into current-year calculations.",
    "3. If charitable contributions, meals, or another expense is not on the current-year P&L, do not invent it. Use zero or flag as missing/suggestion.",
    "4. Standard/itemized deduction amounts must come from Schedule A of the prior-year return when relevant.",
    "5. Other taxes must come from Schedule 2 of the prior-year return when relevant.",
    "6. Book-to-tax adjustments must be reconciled first; then annualize the adjusted taxable income.",
    "7. Projected income equals taxable income plus book-to-tax adjustments, not net operating income.",
    "8. Every numeric value must include a source label in the JSON.",
    "9. If an uploaded current-year P&L has a line missing, the current-year amount is zero/missing. Do not use the prior-year amount as current-year support.",
    "10. If multiple P&L files exist, use the file marked current_year_pl / Zone 2 as the only current-year P&L source.",
    "",
    "RETURN JSON SCHEMA. Return ONLY this JSON inside ```json``` fences:",
    `{
  "clientName": "string",
  "period": "Q1|Q2|Q3|Q4|ANNUAL",
  "taxYear": "string",
  "fileReadingLog": {
    "pl": {"fileName":"string","periodFound":"string","months":number,"status":"read|limited","notes":"string"},
    "balanceSheet": {"fileName":"string","status":"read|limited|not_uploaded","notes":"string"},
    "returns": [{"fileName":"string","status":"read|limited|not_used","formsFound":["string"],"notes":"string"}]
  },
  "annualizedPL": [{"account":"string","ytdAmount":number,"annFactor":number,"annualizedAmount":number,"source":"file/sheet/line"}],
  "plTotals": {"annualizedRevenue":number,"annualizedExpenses":number,"annualizedNetIncome":number},
  "bookToTaxAdjustments": [{"name":"string","bookAmount":number,"taxAmount":number,"adjustment":number,"direction":"addback|deduction|none","explanation":"string","ircCite":"string","runningTotal":number,"found":true}],
  "taxableIncome": number,
  "federalTax": {"bracketDetail":[{"base":number,"rate":number,"tax":number,"explanation":"string"}],"grossTax":number,"credits":[{"name":"string","amount":number,"source":"string"}],"totalCredits":number,"additionalTaxes":[{"name":"string","amount":number,"source":"string"}],"netAnnualTax":number},
  "stateTax": {"state":"string","stateModifications":[{"name":"string","amount":number,"source":"string"}],"stateTI":number,"stateRate":number,"stateGrossTax":number,"stateCredits":[{"name":"string","amount":number,"source":"string"}],"statePTE":number,"netStateTax":number},
  "safeHarbor": {"option1Annual":number,"option2Annual":number,"option2Source":"string","recommended":"string","recommendedAnnual":number,"recommendedQuarterly":number},
  "payments": {"periodPercentage":number,"federalRequiredThrough":number,"federalPaid":number,"federalDue":number,"statePaid":number,"stateRequiredThrough":number,"stateDue":number,"totalDue":number,"federalDueDate":"string","stateDueDate":"string","federalPayUrl":"string","statePayUrl":"string"},
  "flags": [{"severity":"HIGH|MEDIUM|LOW","message":"string"}],
  "emailSubject": "string",
  "emailBody": "string"
}`,
    "",
    "TEMPLATE STRUCTURE TO FILL:",
    `Template source: ${templateContext.source || "standard template"}`,
    templateContext.text || "(Template text could not be extracted; use the standard estimated tax sections.)",
    "",
    "UPLOADED FILES:",
    fileContext.documentBlocks || "(No extracted document text)",
  ].join("\n");
}

function normalizeEstimatedCompleteResult(result = {}, payload = {}, periodInfo = {}) {
  const payments = result.payments || {};
  const federalDue = num(payments.federalDue ?? result.summary?.federalDue ?? result.federalReconciliation?.paymentDue);
  const stateDue = num(payments.stateDue ?? result.summary?.stateDue ?? (Array.isArray(result.stateReconciliations) ? result.stateReconciliations.reduce((sum, row) => sum + num(row.paymentDue), 0) : 0));
  const totalDue = num(payments.totalDue ?? result.summary?.totalDue ?? federalDue + stateDue);
  const plTotals = result.plTotals || {};
  const normalizedAnnualizedPl = Array.isArray(result.annualizedPL)
    ? result.annualizedPL.map((row) => ({
      ...row,
      line: row.line || row.account || row.name || "",
      sourceAmount: num(row.sourceAmount ?? row.ytdAmount ?? row.amount),
      annualizationFactor: num(row.annualizationFactor ?? row.annFactor ?? row.factor ?? periodInfo.annFactor),
      annualizedAmount: num(row.annualizedAmount ?? row.annualized),
    }))
    : [];
  const normalizedAdjustments = Array.isArray(result.bookToTaxAdjustments)
    ? result.bookToTaxAdjustments.map((row) => ({
      ...row,
      adjustmentAmount: num(row.adjustmentAmount ?? row.adjustment ?? row.difference),
      notes: row.notes || row.explanation || row.ircCite || "",
      source: row.source || row.ircCite || "",
    }))
    : [];
  const fileReadingConfirmation = normalizeEstimatedFileReadingLog(result.fileReadingLog || result.fileReadingConfirmation, payload);
  const annualizedNetIncome = num(result.annualizedNetIncome ?? plTotals.annualizedNetIncome);
  const taxableIncome = num(result.taxableIncomeBeforeSpecial ?? result.taxableIncome);
  const stateRows = Array.isArray(result.stateReconciliations) && result.stateReconciliations.length
    ? result.stateReconciliations
    : result.stateTax ? [{
      state: result.stateTax.state || payload.state || "",
      requiredAnnualPayment: num(result.stateTax.netStateTax),
      paymentsMade: num(payments.statePaid),
      overpaymentApplied: num((payload.statePayments || [])[0]?.priorYearOverpayment),
      paymentDue: stateDue,
      source: "AI state tax calculation",
    }] : [];
  const federalReconciliation = result.federalReconciliation || {
    requiredAnnualPayment: num(result.safeHarbor?.recommendedAnnual ?? result.federalTax?.netAnnualTax),
    paymentsMade: num(payments.federalPaid),
    overpaymentApplied: num(payload.federalPayments?.priorYearOverpayment),
    paymentDue: federalDue,
  };
  const safeHarbor = {
    ...(result.safeHarbor || {}),
    priorYearTax: num(result.safeHarbor?.option2Annual ?? result.safeHarbor?.priorYearTax),
    currentYearRequiredAnnual: num(result.safeHarbor?.option1Annual ?? result.safeHarbor?.currentYearRequiredAnnual),
    selectedBasis: result.safeHarbor?.recommended || result.safeHarbor?.selectedBasis || "",
    requiredAnnualPayment: num(result.safeHarbor?.recommendedAnnual ?? result.safeHarbor?.requiredAnnualPayment),
  };
  const federalTax = {
    ...(result.federalTax || {}),
    taxableIncome,
    taxBeforeCredits: num(result.federalTax?.grossTax ?? result.federalTax?.taxBeforeCredits),
    credits: num(result.federalTax?.totalCredits ?? result.federalTax?.credits),
    totalTax: num(result.federalTax?.netAnnualTax ?? result.federalTax?.totalTax),
  };
  return {
    ...result,
    clientName: result.clientName || payload.clientName || "Client",
    clientEmail: payload.clientEmail || result.clientEmail || "",
    period: result.period || payload.period || payload.quarter || "Q1",
    quarter: result.period || payload.period || payload.quarter || "Q1",
    taxYear: result.taxYear || payload.taxYear || "",
    state: payload.state || payload.statePayments?.[0]?.state || result.stateReconciliations?.[0]?.state || "",
    plPeriodMonths: num(result.plPeriodMonths || periodInfo.plMonths),
    annFactor: num(result.annFactor || periodInfo.annFactor),
    plPeriodLabel: result.plPeriodLabel || periodInfo.plPeriod?.label || "",
    fileReadingConfirmation,
    annualizedPL: normalizedAnnualizedPl,
    annualizedNetIncome,
    bookToTaxAdjustments: normalizedAdjustments,
    taxableIncome,
    taxableIncomeBeforeSpecial: taxableIncome,
    federalTax,
    safeHarbor,
    federalReconciliation,
    stateReconciliations: stateRows,
    summary: {
      ...(result.summary || {}),
      federalDue,
      stateDue,
      totalDue,
      federalDueDate: payments.federalDueDate || result.summary?.federalDueDate || "",
      stateDueDate: payments.stateDueDate || result.summary?.stateDueDate || "",
    },
    federalDue,
    stateDue,
    totalDue,
    dueDate: payments.federalDueDate || result.summary?.federalDueDate || result.summary?.stateDueDate || "",
  };
}

function normalizeEstimatedFileReadingLog(log, payload = {}) {
  if (Array.isArray(log)) return log;
  const rows = [];
  if (log?.pl) rows.push({
    fileName: log.pl.fileName || payload.plFile?.name || "Current-year P&L",
    purpose: "Current-year P&L",
    status: log.pl.status || "read",
    notes: [log.pl.periodFound, log.pl.months ? `${log.pl.months} months` : "", log.pl.notes].filter(Boolean).join(" - "),
  });
  if (log?.balanceSheet) rows.push({
    fileName: log.balanceSheet.fileName || payload.balanceSheetFile?.name || "Balance Sheet",
    purpose: "Balance Sheet",
    status: log.balanceSheet.status || "not_uploaded",
    notes: log.balanceSheet.notes || "",
  });
  if (Array.isArray(log?.returns)) {
    log.returns.forEach((item) => rows.push({
      fileName: item.fileName || "Tax return",
      purpose: "Tax return / safe harbor support",
      status: item.status || "read",
      notes: [Array.isArray(item.formsFound) ? item.formsFound.join(", ") : "", item.notes].filter(Boolean).join(" - "),
    }));
  }
  if (!rows.length) {
    if (payload.templateFile) rows.push({ fileName: payload.templateFile.name || "Custom template", purpose: "Template", status: "read", notes: "Custom template uploaded." });
    else rows.push({ fileName: path.basename(estimatedTemplatePathForEntity(payload.entityType) || "standard template"), purpose: "Template", status: "read", notes: "Standard template selected by entity type." });
    if (payload.plFile) rows.push({ fileName: payload.plFile.name || "Current-year P&L", purpose: "Current-year P&L", status: "read", notes: "" });
  }
  return rows;
}

function buildEstimatedCompleteWorkbook(result = {}, payload = {}) {
  const stateRows = Array.isArray(result.stateReconciliations) ? result.stateReconciliations : [];
  const flags = Array.isArray(result.flags) ? result.flags : [];
  return {
    sheets: [
      {
        name: "Summary",
        rows: [
          ["Estimated Tax Workpaper"],
          ["Client", result.clientName],
          ["Tax Year", result.taxYear],
          ["Period", result.period],
          ["P&L Period", result.plPeriodLabel],
          ["P&L Months", result.plPeriodMonths],
          ["Annualization Factor", result.annFactor],
          [],
          ["Payment Summary"],
          ["Federal Due", result.federalDue],
          ["State Due", result.stateDue],
          ["Total Due", result.totalDue],
          ["Federal Due Date", result.summary?.federalDueDate || ""],
          ["State Due Date", result.summary?.stateDueDate || ""],
          [],
          ["Flags"],
          ...flags.map((flag) => [flag.severity || "Note", flag.message || "", flag.source || ""]),
        ],
        cols: [{ wch: 28 }, { wch: 24 }, { wch: 60 }],
        styles: [{ r: 0, c: 0, bold: true, fill: "DBEAFE" }, { r: 8, c: 0, bold: true, fill: "BFDBFE" }],
      },
      {
        name: "Annualized PL and B2T",
        rows: [
          ["Annualized P&L"],
          ["Line", "Source Amount", "Annualization Factor", "Annualized Amount", "Source"],
          ...(Array.isArray(result.annualizedPL) ? result.annualizedPL.map((row) => [
            row.line || row.name || "",
            num(row.sourceAmount ?? row.amount),
            num(row.annualizationFactor ?? row.factor ?? result.annFactor),
            num(row.annualizedAmount ?? row.annualized),
            row.source || "",
          ]) : []),
          [],
          ["Book-to-Tax Adjustments"],
          ["Name", "Book Amount", "Tax Amount", "Adjustment", "Source", "Notes"],
          ...(Array.isArray(result.bookToTaxAdjustments) ? result.bookToTaxAdjustments.map((row) => [
            row.name || row.adjustment || "",
            num(row.bookAmount ?? row.book),
            num(row.taxAmount ?? row.tax),
            num(row.adjustmentAmount ?? row.adjustment ?? row.difference),
            row.source || row.authority || "",
            row.notes || "",
          ]) : []),
          [],
          ["Taxable Income Before Special Deductions", num(result.taxableIncomeBeforeSpecial)],
          ["Annualized Net Income", num(result.annualizedNetIncome)],
        ],
        cols: [{ wch: 34 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 60 }, { wch: 50 }],
        styles: [{ r: 0, c: 0, bold: true, fill: "DBEAFE" }],
      },
      {
        name: "Federal Tax",
        rows: [
          ["Federal Tax"],
          ["Taxable Income", num(result.federalTax?.taxableIncome ?? result.taxableIncomeBeforeSpecial)],
          ["Tax Before Credits", num(result.federalTax?.taxBeforeCredits)],
          ["Credits", num(result.federalTax?.credits)],
          ["Total Tax", num(result.federalTax?.totalTax)],
          ["Source", result.federalTax?.source || ""],
          [],
          ["Safe Harbor"],
          ["Prior Year Tax", num(result.safeHarbor?.priorYearTax)],
          ["Current Year Required Annual", num(result.safeHarbor?.currentYearRequiredAnnual)],
          ["Selected Basis", result.safeHarbor?.selectedBasis || ""],
          ["Required Annual Payment", num(result.safeHarbor?.requiredAnnualPayment)],
          ["Source", result.safeHarbor?.source || ""],
          [],
          ["Federal Reconciliation"],
          ["Required Annual Payment", num(result.federalReconciliation?.requiredAnnualPayment)],
          ["Payments Made", num(result.federalReconciliation?.paymentsMade)],
          ["Overpayment Applied", num(result.federalReconciliation?.overpaymentApplied)],
          ["Payment Due", num(result.federalReconciliation?.paymentDue)],
        ],
        cols: [{ wch: 30 }, { wch: 22 }, { wch: 70 }],
        styles: [{ r: 0, c: 0, bold: true, fill: "DBEAFE" }, { r: 7, c: 0, bold: true, fill: "BFDBFE" }, { r: 14, c: 0, bold: true, fill: "BFDBFE" }],
      },
      {
        name: "State Tax",
        rows: [
          ["State", "Required Annual Payment", "Payments Made", "Overpayment Applied", "Payment Due", "Source"],
          ...stateRows.map((row) => [
            row.state || payload.state || "",
            num(row.requiredAnnualPayment),
            num(row.paymentsMade),
            num(row.overpaymentApplied),
            num(row.paymentDue),
            row.source || "",
          ]),
        ],
        cols: [{ wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 70 }],
        styles: [{ r: 0, c: 0, bold: true, fill: "DBEAFE" }],
      },
      {
        name: "File Reading Log",
        rows: [
          ["File", "Purpose", "Status", "Notes"],
          ...(Array.isArray(result.fileReadingConfirmation) ? result.fileReadingConfirmation.map((row) => [
            row.fileName || row.name || "",
            row.purpose || "",
            row.status || "",
            row.notes || "",
          ]) : []),
          [],
          ["User Notes", payload.notes || ""],
        ],
        cols: [{ wch: 34 }, { wch: 28 }, { wch: 16 }, { wch: 80 }],
        styles: [{ r: 0, c: 0, bold: true, fill: "DBEAFE" }],
      },
    ],
    aiNotes: flags.map((flag) => `${flag.severity || "Note"}: ${flag.message || ""}`),
  };
}

function buildEstimatedCompleteWorkbookFileName(result = {}) {
  const parts = [
    "estimated_tax_workpaper",
    result.clientName || "client",
    result.taxYear || "",
    result.period || result.quarter || "",
  ].filter(Boolean);
  return `${safeFileName(parts.join("_"))}.xlsx`;
}

function estimatedCompletePaymentSummary(result = {}) {
  const money = (value) => `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return [
    `${result.clientName || "Client"} estimated tax workpaper`,
    `Tax year: ${result.taxYear || ""}`,
    `Period: ${result.period || ""}`,
    `Federal due: ${money(result.federalDue)}`,
    `State due: ${money(result.stateDue)}`,
    `Total due: ${money(result.totalDue)}`,
  ].join("\n");
}

async function buildEstimatedTaxWorkbookWithClaude(req, payload, deterministicResult) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) return { error: "Claude API key is not configured. The workbook was generated without AI calculations.", status: 400 };
  const fileContext = await buildEstimatedTaxFileContext(payload.files || []);
  if (!fileContext.hasText && !fileContext.images.length && !fileContext.documents.length) return { error: "No readable text could be extracted from the uploaded files. Upload readable XLSX/PDF/CSV files.", status: 400 };
  const content = [
    ...fileContext.documents.slice(0, 8).map((doc) => ({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: doc.content },
      title: doc.name,
      context: doc.role || "estimated tax source file",
    })),
    ...fileContext.images.slice(0, 6).map((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.type || "image/png", data: image.content },
    })),
    { type: "text", text: buildEstimatedTaxWorkbookPrompt(payload, deterministicResult, fileContext) },
  ];
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 16000,
    webSearch: false,
    models: [...MODEL_FALLBACKS, "claude-sonnet-4-5-20250929"],
    thinking: { type: "enabled", budget_tokens: 10000 },
    system: [{
      type: "text",
      text: withDatabaseContext([
        "You are a senior CPA estimated-tax workpaper preparer.",
        "Return only valid JSON inside ```json``` fences using the compact estimate update-plan schema requested by the user.",
        "Do not return a full workbook. The application already has the Excel template and will apply your row/column updates.",
        "Read every uploaded source carefully, identify what the template needs, compute the estimate, and provide exact template row/column updates with source notes.",
        "Do not invent missing current-year amounts. Do not copy prior-year/template amounts into current-year calculations unless the prompt explicitly identifies them as prior-year payments, carryforwards, Schedule A, or Schedule 2 prior-year data.",
        "For current-year tax adjustments, use only the current-year financial reports, then reconcile book-to-tax adjustments and annualize the reconciled result when instructed.",
        "Projected income must be calculated from taxable income plus book-to-tax adjustments. Do not calculate projected income from net operating income.",
      ].join("\n"), payload, "estimated_taxes"),
    }],
  });
  if (!result.ok) return { error: `Claude could not complete the estimate calculation: ${result.error}`, status: result.status || 502 };
  logClaudeCost(req, result, "estimated_taxes", "estimated_taxes", payload, startedAt);
  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  if (!parsed) return { error: "Claude did not return valid calculation JSON. The workbook was generated with extracted template/files and AI Notes.", status: 502, details: raw.slice(0, 2000) };
  try {
    const summary = normalizeEstimatedTaxAiSummary(parsed.summary || parsed.estimatedTaxSummary || {}, deterministicResult);
    const plan = {
      summary,
      updates: Array.isArray(parsed.updates) ? parsed.updates : Array.isArray(parsed.cellUpdates) ? parsed.cellUpdates : [],
      aiNotes: Array.isArray(parsed.aiNotes) ? parsed.aiNotes : Array.isArray(parsed.notes) ? parsed.notes : [],
      sourceMapping: Array.isArray(parsed.sourceMapping) ? parsed.sourceMapping : [],
    };
    const validation = validateEstimatedAiPlan(payload, deterministicResult, plan, fileContext);
    if (!validation.ok) {
      return { error: validation.error, status: 502, details: validation.details || raw.slice(0, 2000) };
    }
    return {
      workbook: buildEstimatedTaxWorkbookFromPlan(payload, { ...deterministicResult, ...summary }, plan),
      summary,
      statusMessage: parsed.statusMessage || "AI completed the template workpaper from uploaded files.",
      raw,
    };
  } catch (error) {
    return { error: error.message || "Claude workbook JSON was not usable. No Excel file was generated.", status: 502, details: raw.slice(0, 2000) };
  }
}

function normalizeEstimatedTaxAiSummary(summary = {}) {
  const pickMoney = (...keys) => {
    for (const key of keys) {
      if (summary[key] !== undefined && summary[key] !== null && summary[key] !== "") return roundMoney(num(summary[key]));
    }
    return undefined;
  };
  const output = {};
  const mapped = {
    bookNetIncomeYtd: pickMoney("bookNetIncomeYtd", "bookNetIncomeYTD", "ytdBookIncome"),
    bookNetIncomeAnnual: pickMoney("bookNetIncomeAnnual", "annualizedBookIncome", "annualizedIncome"),
    taxableIncome: pickMoney("taxableIncome", "estimatedTaxableIncome"),
    annualFederalTax: pickMoney("annualFederalTax", "federalTax"),
    annualStateTax: pickMoney("annualStateTax", "stateTax"),
    federalDue: pickMoney("federalDue", "federalPaymentDue", "federalEstimatedPayment"),
    stateDue: pickMoney("stateDue", "statePaymentDue", "stateEstimatedPayment"),
    totalDue: pickMoney("totalDue", "totalPaymentDue", "totalEstimatedPayment"),
  };
  for (const [key, value] of Object.entries(mapped)) {
    if (value !== undefined) output[key] = value;
  }
  if (output.totalDue === undefined && (output.federalDue !== undefined || output.stateDue !== undefined)) {
    output.totalDue = roundMoney(num(output.federalDue) + num(output.stateDue));
  }
  if (summary.dueDate) output.dueDate = String(summary.dueDate);
  if (summary.quarter) output.quarter = String(summary.quarter);
  if (summary.safeHarborBasis) output.safeHarborBasis = String(summary.safeHarborBasis);
  if (summary.effectiveRate !== undefined) output.effectiveRate = roundMoney(num(summary.effectiveRate));
  else if (output.taxableIncome) output.effectiveRate = roundMoney(((num(output.annualFederalTax) + num(output.annualStateTax)) / output.taxableIncome) * 100);
  if (Array.isArray(summary.adjustments) && summary.adjustments.length) output.adjustments = summary.adjustments;
  if (Array.isArray(summary.sources) && summary.sources.length) output.sources = summary.sources;
  if (Array.isArray(summary.caveats) && summary.caveats.length) output.caveats = summary.caveats;
  return output;
}

function validateEstimatedAiPlan(payload, deterministicResult, plan = {}, fileContext = {}) {
  const updates = Array.isArray(plan.updates) ? plan.updates : [];
  const financialUpdates = updates.filter((update) => estimatedUpdateLooksFinancial(update));
  const nullFinancial = financialUpdates.filter((update) => update.value === null || update.value === undefined || String(update.value).toUpperCase().includes("NOT FOUND"));
  if (financialUpdates.length >= 5 && nullFinancial.length / financialUpdates.length > 0.3) {
    return {
      ok: false,
      error: "Insufficient data - most financial amounts could not be determined from the provided documents. Please verify the P&L file was uploaded correctly.",
    };
  }

  const copied = findPossibleTemplateAmountCopies(payload, updates);
  if (copied.length) {
    return {
      ok: false,
      error: `Possible template amount not updated: ${copied[0].rowLabel || copied[0].label || "unknown row"} = ${copied[0].value}. Please verify this is the correct current year amount.`,
      details: JSON.stringify(copied.slice(0, 10)),
    };
  }

  const currentPl = fileContext.plSummary?.currentYearFileName ? (fileContext.files || []).find((file) => file.name === fileContext.plSummary.currentYearFileName) : null;
  const period = currentPl?.estimatedPeriod || null;
  const ytdNetIncome = findEstimatedSourceAmount(currentPl, /(net income|net ordinary income|net profit|net earnings)/i);
  const annualBook = Number(plan.summary?.bookNetIncomeAnnual ?? deterministicResult.bookNetIncomeAnnual);
  if (period?.months && period.months < 12 && ytdNetIncome && Math.abs(roundMoney(ytdNetIncome) - roundMoney(annualBook)) < 1) {
    return {
      ok: false,
      error: "Net income appears not to have been annualized. Please verify the current-year P&L period and rerun.",
    };
  }
  return { ok: true };
}

function estimatedUpdateLooksFinancial(update = {}) {
  const text = `${update.rowLabel || ""} ${update.columnLabel || ""} ${update.note || ""}`.toLowerCase();
  return /(income|revenue|sales|expense|meals|charitable|wages|salary|depreciation|interest|tax|payment|deduction|adjustment|profit|loss|gross|net)/.test(text);
}

function findPossibleTemplateAmountCopies(payload = {}, updates = []) {
  const template = estimatedTemplateWorkbookFromPayload(payload);
  if (!template?.sheets?.length) return [];
  const templateAmounts = new Map();
  for (const sheet of template.sheets) {
    const rows = normalizeRows(sheet.rows);
    rows.forEach((row, r) => row.forEach((cell, c) => {
      const amount = normalizeComparableMoney(cell);
      if (amount === null || Math.abs(amount) < 1) return;
      const label = String(row.find((candidate) => /[A-Za-z]/.test(String(candidate || ""))) || "").trim();
      const key = `${sheet.name || ""}|${r + 1}|${c + 1}|${amount}`;
      templateAmounts.set(key, { sheetName: sheet.name || "", rowIndex: r + 1, columnIndex: c + 1, amount, label });
    }));
  }
  return updates.filter((update) => {
    if (!estimatedUpdateLooksFinancial(update)) return false;
    const amount = normalizeComparableMoney(update.value);
    if (amount === null || Math.abs(amount) < 1) return false;
    const source = String(update.valueSource || update.note || "").toLowerCase();
    if (/(1040|line 24|safe harbor|prior year tax|schedule a|schedule 2|carryforward|overpayment|withholding)/.test(source)) return false;
    const sheetName = String(update.sheetName || "");
    const rowIndex = Number(update.rowIndex || 0);
    const columnIndex = Number(update.columnIndex || 0);
    for (const item of templateAmounts.values()) {
      if (Math.abs(item.amount - amount) >= 1) continue;
      const sameLocation = (!sheetName || item.sheetName === sheetName) && (!rowIndex || item.rowIndex === rowIndex) && (!columnIndex || item.columnIndex === columnIndex);
      const sameLabel = update.rowLabel && item.label && String(item.label).toLowerCase().includes(String(update.rowLabel).toLowerCase().slice(0, 20));
      if (sameLocation || sameLabel) return true;
    }
    return false;
  });
}

function normalizeComparableMoney(value) {
  if (typeof value === "number" && Number.isFinite(value)) return roundMoney(value);
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!/^-?\(?\$?\d/.test(text)) return null;
  const negative = /^\(/.test(text) || /^-/.test(text);
  const parsed = Number(text.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return roundMoney(negative ? -parsed : parsed);
}

function findEstimatedSourceAmount(file = {}, labelRegex) {
  const text = String(file?.text || "");
  if (!text) return 0;
  const lines = text.split(/\n+/);
  for (const line of lines) {
    if (!labelRegex.test(line)) continue;
    const matches = line.match(/-?\(?\$?\d[\d,]*(?:\.\d{1,2})?\)?/g);
    if (matches?.length) return normalizeComparableMoney(matches[matches.length - 1]) || 0;
  }
  return 0;
}

function buildEstimatedTaxWorkbookFromPlan(payload, result, plan = {}) {
  const templateWorkbook = estimatedTemplateWorkbookFromPayload(payload);
  const workbook = templateWorkbook?.sheets?.length
    ? JSON.parse(JSON.stringify(templateWorkbook))
    : buildEstimatedTaxWorkbook(result, payload);
  workbook.sheets = Array.isArray(workbook.sheets) ? workbook.sheets : [];
  workbook.sheets = workbook.sheets.map((sheet) => ({
    ...sheet,
    rows: normalizeRows(sheet.rows),
  }));

  const updates = Array.isArray(plan.updates) ? plan.updates : [];
  const unapplied = [];
  const applied = [];
  for (const update of updates) {
    if (applyEstimatedWorkbookUpdate(workbook, update)) applied.push(update);
    else unapplied.push(update);
  }
  addEstimatedSourceColumns(workbook, applied);
  addEstimatedSourcesSheet(workbook, applied, plan.sourceMapping);

  const summaryRows = estimatedTaxSummaryRows(result, plan);
  workbook.sheets.unshift({
    name: "AI Estimate Summary",
    rows: summaryRows,
    cols: [{ wch: 28 }, { wch: 18 }, { wch: 50 }],
    styles: [
      { r: 0, c: 0, bold: true, fill: "DBEAFE" },
      { r: 0, c: 1, bold: true, fill: "DBEAFE" },
      { r: 0, c: 2, bold: true, fill: "DBEAFE" },
    ],
  });

  if (unapplied.length) {
    workbook.sheets.push({
      name: "Unapplied AI Updates",
      rows: [["Sheet", "Row Label", "Column Label", "Value", "Note"], ...unapplied.map((item) => [
        item.sheetName || "",
        item.rowLabel || "",
        item.columnLabel || "",
        item.value ?? "",
        item.note || "",
      ])],
    });
  }

  const aiNotes = [
    ...(Array.isArray(workbook.aiNotes) ? workbook.aiNotes : []),
    ...(Array.isArray(plan.aiNotes) ? plan.aiNotes.map((note) => String(note || "")) : []),
    templateWorkbook?.sheets?.length
      ? "Template workbook was used as the base. AI updates were applied by matching sheet names, row labels, and column labels."
      : "No prior-year template workbook was available; generated a standard estimated-tax workpaper.",
  ].filter(Boolean);
  workbook.aiNotes = aiNotes;
  workbook.sheets.push({
    name: "AI Notes",
      rows: [["AI Notes"], ...aiNotes.map((note) => [note]), [], ["Source Mapping"], ["Value", "Source File", "Source Location"], ...(Array.isArray(plan.sourceMapping) ? plan.sourceMapping.map((item) => [item.value || "", item.sourceFile || "", item.sourceLocation || ""]) : [])],
  });
  return workbook;
}

function addEstimatedSourcesSheet(workbook, applied = [], sourceMapping = []) {
  const rows = [["Sheet", "Cell", "Row Label", "Value", "Source"]];
  for (const update of applied) {
    const cell = Number.isFinite(Number(update.rowIndex)) && Number.isFinite(Number(update.columnIndex))
      ? `${columnNameFromIndex(Number(update.columnIndex))}${Number(update.rowIndex)}`
      : "";
    rows.push([
      update.sheetName || "",
      cell,
      update.rowLabel || update.label || "",
      update.value ?? "[MISSING - not in documents]",
      update.valueSource || update.note || "Source not specified",
    ]);
  }
  if (Array.isArray(sourceMapping) && sourceMapping.length) {
    rows.push([], ["Value", "Source File", "Source Location", ""]);
    sourceMapping.forEach((item) => rows.push([item.value || "", item.sourceFile || "", item.sourceLocation || "", ""]));
  }
  workbook.sheets.push({
    name: "Sources",
    rows,
    cols: [{ wch: 26 }, { wch: 12 }, { wch: 32 }, { wch: 18 }, { wch: 70 }],
  });
}

function columnNameFromIndex(index) {
  let n = Math.max(1, Number(index) || 1);
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function estimatedTemplateWorkbookFromPayload(payload = {}) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const templateFile = files.find((file) => ["prior_year_template", "custom_template"].includes(String(file.role || "")) && (file?.workbookTemplate?.sheets?.length || file?.workbookTemplates?.some((template) => template?.sheets?.length)))
    || files.find((file) => file?.workbookTemplate?.sheets?.length || file?.workbookTemplates?.some((template) => template?.sheets?.length));
  if (!templateFile) return null;
  return templateFile.workbookTemplate?.sheets?.length
    ? templateFile.workbookTemplate
    : templateFile.workbookTemplates.find((candidate) => candidate?.sheets?.length);
}

function estimatedTaxSummaryRows(result, plan = {}) {
  return [
    ["Metric", "Amount", "Notes"],
    ["Client", result.clientName || "", ""],
    ["Return Type", result.returnType || "", ""],
    ["Tax Year", result.taxYear || "", ""],
    ["Quarter", result.quarter || "", ""],
    ["Due Date", result.dueDate || "", ""],
    ["Book Net Income YTD", num(result.bookNetIncomeYtd), "From uploaded financial data / AI calculation"],
    ["Annualized Book Income", num(result.bookNetIncomeAnnual), "Annualized per selected quarter and notes"],
    ["Taxable Income", num(result.taxableIncome), ""],
    ["Annual Federal Tax", num(result.annualFederalTax), ""],
    ["Annual State Tax", num(result.annualStateTax), ""],
    ["Federal Payment Due", num(result.federalDue), ""],
    ["State Payment Due", num(result.stateDue), ""],
    ["Total Payment Due", num(result.totalDue), ""],
    ["Effective Tax Rate", result.effectiveRate !== undefined ? `${result.effectiveRate}%` : "", ""],
    ["Safe Harbor Basis", result.safeHarborBasis || "", ""],
    [],
    ["AI Update Count", Array.isArray(plan.updates) ? plan.updates.length : 0, "Updates applied to the template where labels matched"],
  ];
}

function applyEstimatedWorkbookUpdate(workbook, update = {}) {
  const isMissing = update.value == null;
  const value = update.value == null
    ? "[MISSING - see flags]"
    : update.value;
  if (Number.isFinite(Number(update.rowIndex)) && Number.isFinite(Number(update.columnIndex))) {
    const sheet = findEstimatedSheet(workbook, update.sheetName) || workbook.sheets?.[0];
    if (sheet) {
      sheet.rows = normalizeRows(sheet.rows);
      const r = Math.max(0, Number(update.rowIndex) - 1);
      const c = Math.max(0, Number(update.columnIndex) - 1);
      while (sheet.rows.length <= r) sheet.rows.push([]);
      while (sheet.rows[r].length <= c) sheet.rows[r].push("");
      sheet.rows[r][c] = value;
      if (isMissing) markEstimatedMissingCell(sheet, r, c);
      return true;
    }
  }
  const rowsText = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const sheetHint = rowsText(update.sheetName || "");
  const rowLabel = rowsText(update.rowLabel || update.label || "");
  if (!rowLabel) return false;
  const sheets = workbook.sheets || [];
  const candidateSheets = sheetHint
    ? [...sheets.filter((sheet) => rowsText(sheet.name).includes(sheetHint) || sheetHint.includes(rowsText(sheet.name))), ...sheets]
    : sheets;
  for (const sheet of candidateSheets) {
    const rows = normalizeRows(sheet.rows);
    sheet.rows = rows;
    const rowIndex = rows.findIndex((row) => row.some((cell) => rowsText(cell).includes(rowLabel) || rowLabel.includes(rowsText(cell))));
    if (rowIndex < 0) continue;
    const row = rows[rowIndex];
    let colIndex = findEstimatedUpdateColumn(rows, rowIndex, update.columnLabel);
    if (colIndex < 0) colIndex = Math.max(1, row.findIndex((cell) => rowsText(cell).includes(rowLabel)) + 1);
    while (row.length <= colIndex) row.push("");
    row[colIndex] = value;
    if (isMissing) markEstimatedMissingCell(sheet, rowIndex, colIndex);
    return true;
  }
  return false;
}

function markEstimatedMissingCell(sheet, rowIndex, colIndex) {
  sheet.styles = Array.isArray(sheet.styles) ? sheet.styles : [];
  sheet.styles.push({
    r: rowIndex,
    c: colIndex,
    fill: "FEF2F2",
    fontColor: "DC2626",
    bold: true,
  });
}

function addEstimatedSourceColumns(workbook, appliedUpdates = []) {
  if (!Array.isArray(appliedUpdates) || !appliedUpdates.length) return;
  const updatesBySheet = new Map();
  for (const update of appliedUpdates) {
    const sheetName = String(update.sheetName || "");
    const key = sheetName || "__first__";
    if (!updatesBySheet.has(key)) updatesBySheet.set(key, []);
    updatesBySheet.get(key).push(update);
  }
  for (const [sheetKey, updates] of updatesBySheet) {
    const sheet = sheetKey === "__first__" ? workbook.sheets?.[0] : findEstimatedSheet(workbook, sheetKey);
    if (!sheet) continue;
    sheet.rows = normalizeRows(sheet.rows);
    const sourceCol = Math.max(0, ...sheet.rows.map((row) => row.length)) + 1;
    if (!sheet.rows.length) sheet.rows.push([]);
    while (sheet.rows[0].length <= sourceCol) sheet.rows[0].push("");
    sheet.rows[0][sourceCol] = "AI Source";
    for (const update of updates) {
      const rowIndex = Number.isFinite(Number(update.rowIndex))
        ? Math.max(0, Number(update.rowIndex) - 1)
        : findEstimatedUpdateRow(sheet.rows, update.rowLabel || update.label || "");
      if (rowIndex < 0) continue;
      while (sheet.rows.length <= rowIndex) sheet.rows.push([]);
      while (sheet.rows[rowIndex].length <= sourceCol) sheet.rows[rowIndex].push("");
      sheet.rows[rowIndex][sourceCol] = update.valueSource || update.note || "AI update - source not specified";
    }
    sheet.cols = Array.isArray(sheet.cols) ? sheet.cols : [];
    while (sheet.cols.length <= sourceCol) sheet.cols.push({});
    sheet.cols[sourceCol] = { ...(sheet.cols[sourceCol] || {}), wch: 42 };
  }
}

function findEstimatedUpdateRow(rows, rowLabel) {
  const label = String(rowLabel || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!label) return -1;
  return rows.findIndex((row) => row.some((cell) => {
    const text = String(cell ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    return text && (text.includes(label) || label.includes(text));
  }));
}

function findEstimatedSheet(workbook, sheetName) {
  const hint = String(sheetName || "").toLowerCase().replace(/\s+/g, " ").trim();
  const sheets = workbook.sheets || [];
  if (!hint) return sheets[0] || null;
  return sheets.find((sheet) => {
    const name = String(sheet.name || "").toLowerCase().replace(/\s+/g, " ").trim();
    return name === hint || name.includes(hint) || hint.includes(name);
  }) || null;
}

function findEstimatedUpdateColumn(rows, rowIndex, columnLabel) {
  const label = String(columnLabel || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!label) return -1;
  for (let r = Math.max(0, rowIndex - 8); r <= rowIndex; r += 1) {
    const row = rows[r] || [];
    const col = row.findIndex((cell) => {
      const text = String(cell ?? "").toLowerCase().replace(/\s+/g, " ").trim();
      return text && (text.includes(label) || label.includes(text));
    });
    if (col >= 0) return col;
  }
  return -1;
}

async function buildEstimatedTaxFileContext(files = []) {
  const normalizedFiles = Array.isArray(files) ? files.map((file) => ({
    ...file,
    estimatedRole: classifyEstimatedTaxFile(file),
    estimatedPeriod: detectEstimatedTaxPeriod(file),
    detectedDocType: detectEstimatedDocumentType(file),
  })) : [];
  const plFiles = normalizedFiles.filter((file) => file.detectedDocType === "PL_STATEMENT");
  const currentYearPl = chooseEstimatedCurrentYearPl(plFiles);
  const [financialReports, priorYearTemplates, supporting] = await Promise.all([
    buildUploadedFileContext(normalizedFiles.filter((file) => isEstimatedCurrentYearFinancialRole(file.estimatedRole))),
    buildUploadedFileContext(normalizedFiles.filter((file) => isEstimatedTemplateOrPriorReturnRole(file.estimatedRole))),
    buildUploadedFileContext(normalizedFiles.filter((file) => !isEstimatedCurrentYearFinancialRole(file.estimatedRole) && !isEstimatedTemplateOrPriorReturnRole(file.estimatedRole))),
  ]);
  const grouped = { financialReports, priorYearTemplates, supporting,
  };
  const documents = [];
  for (const file of normalizedFiles) {
    const name = String(file.name || "Uploaded file");
    const type = String(file.type || mimeFromName(name) || "").toLowerCase();
    const content = String(file.content || file.contentBase64 || "");
    if (content && (type.includes("pdf") || /\.pdf$/i.test(name))) {
      // COST: a PDF sent as a document block is processed as page images (~1500-3000 tokens
      // per page). The same PDF's extracted text is ALREADY included in the prompt via
      // buildEstimatedDocumentBlocks, so attaching the image block too just doubles the input
      // cost. Only attach it when the text could not be extracted (scanned / image-only PDF),
      // where the model genuinely needs to read the pages visually.
      const extractedText = String(file.text || "").trim();
      const textIsWeak = extractedText.length < 300;
      if (textIsWeak) {
        documents.push({ name, content, role: file.estimatedRole || String(file.role || "financial_report") });
      }
    }
  }
  return {
    ...grouped,
    files: normalizedFiles,
    documentBlocks: buildEstimatedDocumentBlocks(normalizedFiles),
    documents,
    images: [...grouped.financialReports.images, ...grouped.priorYearTemplates.images, ...grouped.supporting.images],
    hasText: Boolean(grouped.financialReports.text || grouped.priorYearTemplates.text || grouped.supporting.text),
    plSummary: {
      count: plFiles.length,
      currentYearFileName: currentYearPl?.name || "",
      files: plFiles.map((file, index) => ({
        label: `P&L File ${index + 1}`,
        name: file.name,
        estimatedRole: file.estimatedRole,
        detectedDocType: file.detectedDocType,
        period: file.estimatedPeriod,
      })),
    },
  };
}

function detectEstimatedDocumentType(file = {}) {
  const name = String(file.name || "").toLowerCase();
  const text = String(file.text || "").slice(0, 120000).toLowerCase();
  const haystack = `${name}\n${text}`;
  if (/form\s*1040|u\.?s\.?\s+individual income tax return/.test(haystack)) return "1040_RETURN";
  if (/form\s*1120-?s|u\.?s\.?\s+income tax return for an s corporation|s corporation/.test(haystack)) return "1120S_RETURN";
  if (/\bw-?2\b|wage and tax statement|box\s*1|box\s*2|box\s*16|box\s*17/.test(haystack)) return "W2_DOCUMENT";
  if (/(estimated tax|estimate).*(template|workpaper|prior)|prior.*(estimated tax|estimate|template)|\bq[1-4]\b.*(estimate|template|workpaper)/.test(haystack)) return "PRIOR_YEAR_TEMPLATE";
  if (/(profit\s+(and|&)\s+loss|p\s*&\s*l|income statement|statement of operations)/.test(haystack) && /(ytd|year to date|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q[1-4]|20\d{2})/.test(haystack)) return "PL_STATEMENT";
  return "OTHER";
}

function chooseEstimatedCurrentYearPl(plFiles = []) {
  return plFiles.find((file) => isEstimatedCurrentYearFinancialRole(file.estimatedRole) && file.estimatedRole !== "prior_year_template")
    || plFiles.find((file) => String(file.role || "").toLowerCase() === "financial_report")
    || plFiles[0]
    || null;
}

function classifyEstimatedTaxFile(file = {}) {
  const explicit = String(file.role || "").toLowerCase().replace(/\s+/g, "_");
  const name = String(file.name || "").toLowerCase();
  const text = String(file.text || "").slice(0, 5000).toLowerCase();
  const haystack = `${name}\n${text}`;
  if (explicit === "prior_year_template" || /\b(estimated tax|estimate|workpaper|template|q[1-4])\b/.test(haystack) && /\b(2024|2025|prior|template)\b/.test(haystack)) return "prior_year_template";
  if (/form\s*1040|u\.?s\.?\s+individual income tax return|schedule\s+a|schedule\s+2/i.test(haystack)) return "prior_year_return_1040";
  if (/form\s*1120-?s|s corporation|schedule\s+k-?1/i.test(haystack)) return "prior_year_return_1120s";
  if (/\bw-?2\b|wage and tax statement|box\s*1|box\s*2|box\s*16|box\s*17/i.test(haystack)) return "current_year_w2";
  if (/p\s*&\s*l|profit\s+(and|&)\s+loss|income statement|statement of operations|ytd|year to date|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(haystack)) return "current_year_pl";
  if (explicit === "financial_report") return "current_year_financial_report";
  if (explicit === "supporting_document") return "supporting_document";
  return explicit || "current_year_financial_report";
}

function isEstimatedCurrentYearFinancialRole(role) {
  return ["current_year_pl", "current_year_w2", "current_year_financial_report", "financial_report"].includes(String(role || ""));
}

function isEstimatedTemplateOrPriorReturnRole(role) {
  return ["prior_year_template", "prior_year_return_1040", "prior_year_return_1120s"].includes(String(role || ""));
}

function estimatedRolePurpose(role, file = {}) {
  const period = file.estimatedPeriod;
  const periodText = period?.months
    ? ` Detected period: ${period.label}. Annualization factor: 12 / ${period.months} = ${period.factor}. Apply this factor line-by-line when this is current-year partial-year data.`
    : "";
  switch (role) {
    case "prior_year_template":
      return "This file is a PRIOR YEAR WORKPAPER TEMPLATE. Use it only for structure, sheet names, row labels, section names, and formatting. Do not use any numbers from this file as current-year data.";
    case "prior_year_return_1040":
      return "This is a prior-year Form 1040/source return. Extract prior-year AGI, taxable income, total tax, credits, filing status, prior payments/withholding, Schedule A standard/itemized deduction support, Schedule 2 other taxes, carryforwards, and safe-harbor facts. Label every value by form/schedule/line.";
    case "prior_year_return_1120s":
      return "This is a prior-year Form 1120-S/source return. Extract ordinary income, Schedule K/K-1 items, officer compensation, depreciation, other deductions, Schedule L facts, and M-1/M-3 book-to-tax adjustments. Use as prior-year context only unless a value is explicitly a prior-year tax/safe-harbor/carryforward fact.";
    case "current_year_pl":
      return `This is the CURRENT YEAR P&L/financial statement and primary source for current-year income, expenses, meals, charitable contributions, depreciation, and book net income. Do not combine it with old P&L/template amounts. Annualize every line item, not only net income.${periodText}`;
    case "current_year_w2":
      return `This is CURRENT YEAR W-2/wage/withholding information. Extract wages and withholding; annualize only if it is partial-year data. Use it for wage/withholding lines and explain if it overrides P&L wage amounts.${periodText}`;
    case "current_year_financial_report":
    case "financial_report":
      return `This is a current-year financial source unless its text clearly says prior year. Extract all relevant financial data with labels, dates, and sources. Use it for current-year calculations only when the document period matches the target year.${periodText}`;
    case "supporting_document":
      return "This is a supporting document. Review for relevant facts and note explicitly if no relevant estimate data was found.";
    default:
      return "Review this file according to its user-selected role. Extract any relevant estimate facts with source labels, and do not use unsupported numbers.";
  }
}

function buildEstimatedDocumentBlocks(files = []) {
  return files.map((file, index) => {
    const name = String(file.name || `Document ${index + 1}`);
    const role = file.estimatedRole || classifyEstimatedTaxFile(file);
    const detectedDocType = file.detectedDocType || detectEstimatedDocumentType(file);
    const text = String(file.text || "").trim();
    const templates = [file.workbookTemplate, ...(Array.isArray(file.workbookTemplates) ? file.workbookTemplates : [])].filter((template) => template?.sheets?.length);
    const templateText = templates.length ? `\nSTRUCTURED WORKBOOK DATA:\n${safeJsonForPrompt(templates.slice(0, 2), role === "prior_year_template" ? 140000 : 50000)}` : "";
    const content = text || "(No extracted text available. If this is a native PDF/image block, inspect the attached document content directly.)";
    const maxChars = role === "current_year_pl" ? 120000 : role === "prior_year_template" ? 90000 : 70000;
    const period = file.estimatedPeriod || detectEstimatedTaxPeriod(file);
    return [
      `DOCUMENT ${index + 1}: ${name}`,
      `DETECTED TYPE: ${detectedDocType}`,
      `ROLE: ${role}`,
      `USER SELECTED ROLE: ${file.role || ""}`,
      `PURPOSE INSTRUCTIONS: ${estimatedRolePurpose(role, file)}`,
      `STRICT EXTRACTION CHECKLIST: ${estimatedDocumentExtractionChecklist(detectedDocType, period)}`,
      "DOCUMENT CONTENT:",
      content.slice(0, maxChars),
      templateText,
    ].join("\n");
  }).join("\n\n" + "=".repeat(72) + "\n\n");
}

function estimatedDocumentExtractionChecklist(detectedDocType, period) {
  switch (detectedDocType) {
    case "1040_RETURN":
      return "Extract Form 1040 line 11 AGI, line 24 total tax for safe harbor, lines 25a/25b withholding, line 26 estimates, line 37 refund or line 38 amount owed, filing status, tax year, Schedule A deduction data, and Schedule 2 other taxes. These are prior-year facts only unless expressly safe harbor/prior payment data.";
    case "1120S_RETURN":
      return "Extract Form 1120-S line 21 ordinary income/loss, line 7 officer compensation, line 8 salaries/wages, line 14 tax depreciation, line 19 other deductions, Schedule M-1/M-3 book-to-tax items, Schedule K income items. Use categories as structure/reference only, not current-year amounts.";
    case "PL_STATEMENT":
      return period?.months
        ? `Extract every P&L line item. Period detected: ${period.label}; annualization factor ${period.factor}. Use this document only if it is current-year financial data. Annualize each line item individually.`
        : "Extract every P&L line item. WARNING: P&L period was not detected; do not annualize until the period is confirmed from the document content, and flag this for the preparer.";
    case "PRIOR_YEAR_TEMPLATE":
      return "Use for workbook structure only: sheet names, row labels, section names, adjustment categories, and formatting. Do not use dollar amounts as current-year data.";
    case "W2_DOCUMENT":
      return "Extract employer, Box 1 wages, Box 2 federal withholding, Box 16 state wages, Box 17 state withholding, tax year, and period if partial-year.";
    default:
      return "Extract all relevant facts and state explicitly if no estimate data was found.";
  }
}

function detectEstimatedTaxPeriod(file = {}) {
  const text = `${file.name || ""}\n${file.text || ""}`.toLowerCase();
  const monthNames = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
    may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  };
  const qMatch = text.match(/\bq([1-4])\b/);
  if (qMatch) {
    const months = Number(qMatch[1]) * 3;
    return { months, factor: +(12 / months).toFixed(4), label: `Q${qMatch[1]} (${months} months)` };
  }
  const monthPattern = Object.keys(monthNames).join("|");
  const range = text.match(new RegExp(`\\b(${monthPattern})\\b\\s*(?:\\d{1,2},?\\s*)?(?:20\\d{2})?\\s*(?:-|to|through|thru|/|â€“|â€”)\\s*\\b(${monthPattern})\\b`, "i"));
  if (range) {
    const start = monthNames[range[1].toLowerCase()];
    const end = monthNames[range[2].toLowerCase()];
    const months = end >= start ? end - start + 1 : end;
    if (months > 0 && months <= 12) return { months, factor: +(12 / months).toFixed(4), label: `${range[1]} through ${range[2]} (${months} months)` };
  }
  const through = text.match(new RegExp(`(?:jan(?:uary)?\\s*(?:through|to|-|â€“|â€”)\\s*)?(${monthPattern})\\s+20\\d{2}`, "i"));
  if (through) {
    const months = monthNames[through[1].toLowerCase()];
    if (months > 0 && months <= 12) return { months, factor: +(12 / months).toFixed(4), label: `January through ${through[1]} (${months} months)` };
  }
  return null;
}

function buildEstimatedTaxWorkbookPrompt(payload, result, fileContext) {
  const cf = payload.carryforward || {};
  const prior = payload.priorPayments || {};
  const templateWorkbook = estimatedTemplateWorkbookFromPayload(payload);
  const templateFieldMap = buildEstimatedTemplateFieldMap(templateWorkbook);
  const sourceFacts = buildEstimatedSourceFactMap(payload.files || []);
  const plPeriod = fileContext.plSummary?.files?.find((file) => file.name === fileContext.plSummary?.currentYearFileName)?.period
    || fileContext.plSummary?.files?.[0]?.period
    || null;
  const priorPaymentRows = {
    federal: {
      q1: prior.q1Federal || 0,
      q2: prior.q2Federal || 0,
      q3: prior.q3Federal || 0,
      priorYearOverpaymentApplied: prior.priorYearOverpaymentApplied || 0,
    },
    state: {
      q1: prior.q1State || 0,
      q2: prior.q2State || 0,
      q3: prior.q3State || 0,
      priorYearOverpaymentAppliedState: prior.priorYearOverpaymentAppliedState || 0,
    },
  };
  return [
    "[SECTION 1] ROLE AND ABSOLUTE RULES",
    `You are a senior CPA performing a ${payload.quarter || result.quarter} ${payload.taxYear || result.taxYear} estimated tax calculation for ${payload.clientName || result.clientName} (${payload.returnType || result.returnType}).`,
    `You have received ${(payload.files || []).length} documents. Your job is to read each one carefully, extract the relevant numbers, and produce an estimated tax workpaper.`,
    "",
    "ABSOLUTE RULES - VIOLATING ANY OF THESE IS AN ERROR:",
    "RULE 1 - NO INVENTED NUMBERS: Every number in your output must come from one provided document or manual preparer field. If a number is not in any document, write NOT FOUND and flag it. Never estimate, guess, or fill in a number that is not explicitly stated.",
    "RULE 2 - NO PRIOR YEAR NUMBERS AS CURRENT YEAR DATA: Prior-year templates and prior-year returns are used only for safe harbor, carryforward amounts, Schedule A/Schedule 2 prior-year facts, M-1 categories, and structure. Never use prior-year income/expense/template amounts as current-year amounts.",
    "RULE 3 - NO P&L MIXING: If multiple P&L files exist, identify the year/period of each. Use only the current-year P&L for current-year income and expense calculations. Never average, combine, or borrow from prior-year P&L/template data.",
    "RULE 4 - SHOW EVERY CALCULATION: In aiNotes/sourceMapping, show every material calculation as Source -> Amount and YTD amount x annualization factor = annualized amount.",
    "RULE 5 - EXPLAIN EVERY ADJUSTMENT: Every book-to-tax adjustment needs one sentence explaining what it is, why it is made, authority/IRC cite, and how the amount was calculated.",
    "RULE 6 - CONFIRM WHAT YOU READ FROM EACH FILE: Before calculations, include a document inventory in aiNotes. Do not silently skip any file.",
    "",
    "OUTPUT FORMAT:",
    '{"summary":{"bookNetIncomeYtd":number,"bookNetIncomeAnnual":number,"taxableIncome":number,"annualFederalTax":number,"annualStateTax":number,"federalDue":number,"stateDue":number,"totalDue":number,"effectiveRate":number,"dueDate":"string","safeHarborBasis":"string","adjustments":[{"name":"string","bookAmount":number,"taxAmount":number,"adjustment":number,"authority":"string","url":"string","valueSource":"string"}],"caveats":[{"severity":"HIGH|MEDIUM|LOW","text":"string"}],"sources":[{"title":"string","url":"string","relevance":"string"}]},"updates":[{"sheetName":"string","rowIndex":number,"columnIndex":number,"rowLabel":"exact row label from template","columnLabel":"exact column/header label","value":"string or number or null","note":"source/explanation","valueSource":"source file and location"}],"aiNotes":["Missing information or assumptions"],"sourceMapping":[{"value":"string","sourceFile":"string","sourceLocation":"string"}],"statusMessage":"string"}',
    "",
    "[SECTION 2] CLIENT AND QUARTER INFORMATION",
    "Manual preparer fields are authoritative. Do not override them with uploaded documents.",
    safeJsonForPrompt({
      clientName: payload.clientName,
      returnType: payload.returnType,
      taxYear: payload.taxYear,
      state: payload.state,
      filingStatus: payload.filingStatus || "N/A for entity",
      quarter: payload.quarter,
      quarterEndDate: payload.quarterEndDate,
      annualizationQuarter: payload.quarter,
      plPeriodMonths: plPeriod?.months || null,
      plPeriodLabel: plPeriod?.label || "NOT DETECTED",
      annualizationFactor: plPeriod?.factor || null,
      periodWarning: plPeriod?.months ? "" : "P&L period could not be determined from the document. Preparer must confirm the period covered. Do not silently annualize.",
    }, 12000),
    "",
    "[SECTION 3] PRIOR PAYMENTS FROM MANUAL FIELDS",
    "Use only these manual fields for prior payment reconciliation. Do not look for these in uploaded documents unless manual fields are blank and you flag that clearly.",
    safeJsonForPrompt(priorPaymentRows, 12000),
    "",
    "[SECTION 4] CARRYFORWARDS FROM MANUAL FIELDS",
    "Use these as-is when nonzero. Do not invent carryforwards.",
    safeJsonForPrompt(cf, 12000),
    "",
    "[SECTION 5] DOCUMENTS PROVIDED",
    `You received ${(payload.files || []).length} documents. Read every document in this section before calculating anything.`,
    fileContext.plSummary?.count > 1
      ? `CRITICAL: There are ${fileContext.plSummary.count} P&L documents. They are labeled below. Use ONLY the current-year P&L for financial calculations. Prior-year P&L/template files are for structure/reference only.\n${safeJsonForPrompt(fileContext.plSummary, 20000)}`
      : `P&L document summary:\n${safeJsonForPrompt(fileContext.plSummary || {}, 12000)}`,
    "",
    fileContext.documentBlocks || "No uploaded document text extracted.",
    "",
    "[SECTION 6] ADDITIONAL PREPARER NOTES",
    String(payload.notes || "").trim()
      ? `The preparer added these instructions. Follow them exactly unless they conflict with source documents; if there is a conflict, flag it.\n${payload.notes}`
      : "No additional preparer notes entered.",
    "",
    "[SECTION 7] CALCULATION SEQUENCE - FOLLOW IN ORDER",
    "STEP 1 - CONFIRM WHAT YOU READ: In aiNotes, write DOCUMENTS READ with each filename, detected type, and key extracted facts. If a required document cannot be read or key data is missing, return HIGH caveat and missing markers.",
    "STEP 2 - BUILD THE ANNUALIZED P&L: Start from the current-year P&L only. Annualize each line item individually. Do not include any prior-year amounts. Cross-check revenue minus expenses equals book net income.",
    "STEP 3 - BOOK-TO-TAX RECONCILIATION: Start with annualized current-year book net income. Apply template adjustment categories with current-year source amounts only. If current-year amount is missing, write MISSING - prior year had this item, current-year amount not found.",
    "STEP 4 - MANDATORY ADJUSTMENTS: Meals 50% disallowance under IRC 274(n)(1), depreciation timing if supported, interest expense 163(j) check if interest exists. If data is not determinable, flag it; do not invent.",
    "STEP 5 - SPECIAL DEDUCTIONS: Apply manual NOL/carryforwards and QBI if applicable. Show the calculation in aiNotes/sourceMapping.",
    "STEP 6 - FEDERAL TAX COMPUTATION: Apply correct rates for return type/tax year and show bracket/rate calculation in aiNotes/sourceMapping.",
    "STEP 7 - SAFE HARBOR: Option 1 is 90% of current-year tax. Option 2 uses prior-year Form 1040 Line 24 only, or prior-year tax manual field if no 1040 line is available; flag when 1040 is missing.",
    "STEP 8 - PRIOR PAYMENT RECONCILIATION: Use Section 3 manual fields, calculate required through quarter, subtract prior payments.",
    "STEP 9 - WORKPAPER OUTPUT: Use Claude JSON update plan against TEMPLATE FIELD MAP. Every material update needs valueSource. If replacing a prior-year value, note Prior year -> Current year and source.",
    "",
    "[SECTION 8] OUTPUT VALIDATION BEFORE RESPONDING",
    "Before final JSON, verify: every annualized P&L number came from the current-year P&L; net income is annualized when partial year; every adjustment has explanation/cite; safe harbor Option 2 came from 1040 Line 24/manual prior tax; prior payments are manual fields; no template amounts appear as current-year data; missing data is flagged, not filled with zero/prior-year value.",
    "",
    "CRITICAL WORKPAPER RULES:",
    "- Produce a new current-year workpaper, not a narrative memo.",
    "- Calculate the estimate from the uploaded current-year financial files and the user's notes. The UI summary and workbook must agree.",
    "- If the user's notes instruct annualization, annualize the current-year data according to the selected quarter before calculating the estimate.",
    "- If both prior returns and current-year financial files are supplied, use prior returns to understand prior-year complete information and payments, but use current-year files for 2026/target-year values.",
    "- Treat files with role financial_report as the only source for current-year P&L, balance sheet, W-2, withholding, and operating activity. Do not combine old P&L/template amounts with the current-year P&L.",
    "- Treat files with role prior_year_template only as structure, formatting, prior-year return references, and prior-year payment/carryforward context. Never use prior-year template amounts as current-year amounts.",
    "- If a current-year amount is not present in the current-year financial report, do not invent it and do not copy the prior-year amount. Leave the current-year amount blank/zero as appropriate and add an aiNotes item or caveat requesting confirmation.",
    "- Charitable contributions are a strict example: if charitable contributions are not found in the current-year P&L/current-year financial files, do not include a charitable contribution amount in taxable income. Mention it only as a suggested follow-up, not as a booked current-year value.",
    "- Meals and entertainment must come from the current-year P&L/current-year financial files only. Do not use prior-year meals amounts when calculating tax adjustments.",
    "- Standard deduction / itemized deduction amounts for the prior year must come from Schedule A of the uploaded 2025 return, not from the P&L or template assumptions.",
    "- Other taxes for the prior year must come from Schedule 2 of the uploaded 2025 return, not from the P&L or template assumptions.",
    "- For tax adjustments, first reconcile current-year book income from the current-year P&L, then apply addbacks and deductions supported by current-year source data, then annualize the reconciled tax income if annualization is requested.",
    "- Projected income must be calculated using taxable income plus book-to-tax adjustments. Never use net operating income as the base for projected income.",
    "- Return only the compact JSON calculation/update plan above. Do not return the full workbook JSON.",
    "- Use primitive cell values only: strings, numbers, dates.",
    "- Before calculating, read TEMPLATE FIELD MAP and identify every row/cell that needs current-year data.",
    "- For each value you can support from the uploaded files, create an update using exact rowIndex and columnIndex from TEMPLATE FIELD MAP. rowIndex and columnIndex are 1-based Excel-style positions.",
    "- For updates, use exact row labels and column labels from the template whenever possible. The app will apply your update plan to the template.",
    "- Use SOURCE FACTS as a quick index, then verify against FINANCIAL DATA / native PDFs before finalizing.",
    "- Use current-year financial data as the source for values. Never copy prior-year template numbers.",
    "- If current-year financial data is missing for a template line, add an aiNotes item explaining what is missing.",
    "- Every material update must cite a sourceFile/sourceLocation in sourceMapping. If the only support is a prior-year/template file, do not treat it as a current-year update.",
    "- If required data is missing, set the update value to null, set valueSource/note to NOT FOUND IN PROVIDED DOCUMENTS, and add a HIGH caveat. Continue calculating the lines that are supported.",
    "- Before calculating, list in aiNotes what was extracted from each uploaded document. If a document could not be read or was irrelevant, say that explicitly.",
    "- Show annualization explicitly in aiNotes/sourceMapping: YTD amount x factor = annualized amount.",
    "",
    "UPLOADED FILE ROLES:",
    safeJsonForPrompt((payload.files || []).map((file) => {
      const estimatedRole = classifyEstimatedTaxFile(file);
      const enriched = { ...file, estimatedRole, estimatedPeriod: detectEstimatedTaxPeriod(file), detectedDocType: detectEstimatedDocumentType(file) };
      return {
        name: file.name,
        userSelectedRole: file.role || "financial_report",
        estimatedRole,
        detectedDocType: enriched.detectedDocType,
        type: file.type || "",
        period: enriched.estimatedPeriod,
        instruction: estimatedRolePurpose(estimatedRole, enriched),
      };
    }), 30000),
    "",
    "TEMPLATE FIELD MAP (use rowIndex and columnIndex from here when returning updates):",
    safeJsonForPrompt(templateFieldMap, 90000),
    "",
    "SOURCE FACTS INDEX (candidate facts extracted from uploaded files; verify before using):",
    safeJsonForPrompt(sourceFacts, 60000),
    "",
    "CALCULATION STEPS TO FOLLOW:",
    [
      "STEP 1 - Read and reconcile every uploaded document. Extract facts per document and note the source.",
      "STEP 2 - Annualize current-year P&L/income/expense lines individually. Do not annualize only net income.",
      "STEP 3 - Start book-to-tax reconciliation from annualized current-year book net income.",
      "STEP 4 - Apply addbacks/deductions supported by current-year files, required law, template labels, or preparer notes.",
      "STEP 5 - Compute taxable income after supported adjustments and manual carryforwards. Then compute projected income from taxable income plus book-to-tax adjustments, not from net operating income.",
      "STEP 6 - Compute federal/state tax, safe harbor, and prior payment reconciliation using manual fields first.",
      "STEP 7 - Build update plan against TEMPLATE FIELD MAP. Replace prior-year template values with supported current-year values or missing markers.",
    ].join("\n"),
    "",
    "DETERMINISTIC CALCULATION BASELINE:",
    safeJsonForPrompt({
      bookNetIncomeYtd: result.bookNetIncomeYtd,
      bookNetIncomeAnnual: result.bookNetIncomeAnnual,
      taxableIncome: result.taxableIncome,
      annualFederalTax: result.annualFederalTax,
      annualStateTax: result.annualStateTax,
      federalDue: result.federalDue,
      stateDue: result.stateDue,
      totalDue: result.totalDue,
      dueDate: result.dueDate,
      adjustments: result.adjustments,
    }, 40000),
    "",
    "FINANCIAL DATA (use these numbers):",
    fileContext.financialReports.text || "No readable financial report text extracted.",
    "",
    "WORKPAPER FORMAT (follow template structure):",
    fileContext.priorYearTemplates.text || "No prior-year template provided. Create a clean CPA workpaper format.",
    "",
    "ADDITIONAL CONTEXT:",
    [String(payload.notes || "No additional notes."), fileContext.supporting.text || ""].filter(Boolean).join("\n\n"),
  ].join("\n");
}

function buildEstimatedTemplateFieldMap(templateWorkbook) {
  if (!templateWorkbook?.sheets?.length) return [];
  const fields = [];
  for (const sheet of templateWorkbook.sheets.slice(0, 12)) {
    const rows = normalizeRows(sheet.rows).slice(0, 250);
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const nonEmpty = row.map((cell, c) => ({ c, text: String(cell ?? "").trim() })).filter((item) => item.text);
      if (!nonEmpty.length) continue;
      const labelCell = nonEmpty.find((item) => /[A-Za-z]/.test(item.text)) || nonEmpty[0];
      const currentValueCell = nonEmpty.find((item) => item.c > labelCell.c && /[$(]?\d/.test(item.text));
      const nearbyHeader = findNearbyTemplateHeader(rows, r);
      fields.push({
        sheetName: sheet.name,
        rowIndex: r + 1,
        labelColumnIndex: labelCell.c + 1,
        suggestedValueColumnIndex: currentValueCell ? currentValueCell.c + 1 : Math.min(labelCell.c + 2, 20),
        rowLabel: labelCell.text,
        nearbyHeader,
        currentValue: currentValueCell?.text || "",
        rowPreview: row.slice(0, 18),
      });
      if (fields.length >= 900) return fields;
    }
  }
  return fields;
}

function findNearbyTemplateHeader(rows, rowIndex) {
  for (let r = rowIndex - 1; r >= Math.max(0, rowIndex - 6); r -= 1) {
    const text = (rows[r] || []).map((cell) => String(cell || "").trim()).filter(Boolean).join(" | ");
    if (text && /[A-Za-z]/.test(text)) return text.slice(0, 240);
  }
  return "";
}

function buildEstimatedSourceFactMap(files = []) {
  const facts = [];
  for (const file of files) {
    const name = String(file.name || "Uploaded file");
    const role = classifyEstimatedTaxFile(file);
    const period = detectEstimatedTaxPeriod(file);
    const text = String(file.text || "").replace(/\r/g, "\n");
    if (!text.trim()) continue;
    const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    for (const line of lines) {
      if (!/[-$()0-9,]{2,}/.test(line)) continue;
      if (!/(w-?2|wages?|withholding|federal|state|profit|loss|revenue|income|expense|tax|payment|estimate|q[1-4]|balance|payroll|p&l|net|charitable|meals?|deduction|schedule|line)/i.test(line)) continue;
      facts.push({ sourceFile: name, role, period, text: line.slice(0, 500) });
      if (facts.length >= 600) return facts;
    }
  }
  return facts;
}

function addEstimatedTaxFileNotes(workbook, payload, result, note) {
  const fileSummary = summarizeEstimatedTaxFiles(payload.files || []);
  const next = workbook && Array.isArray(workbook.sheets) ? JSON.parse(JSON.stringify(workbook)) : buildEstimatedTaxWorkbook(result, payload);
  next.sheets.push({
    name: "Uploaded Files",
    rows: [
      ["Uploaded File", "Role", "Type", "Size"],
      ...Object.entries({
        "Financial Report": fileSummary.financialReports,
        "Prior Year Template": fileSummary.priorYearTemplates,
        "Supporting Document": fileSummary.supportingDocuments,
        Other: fileSummary.other,
      }).flatMap(([role, list]) => list.map((file) => [file.name, role, file.type, file.size])),
      [],
      ["Workbook note", note],
    ],
  });
  next.aiNotes = [...(next.aiNotes || []), note];
  return next;
}

function calculateEstimatedTaxes(payload = {}) {
  const year = Number(payload.taxYear || new Date().getFullYear());
  const quarter = String(payload.quarter || "Q1").toUpperCase();
  const returnType = String(payload.returnType || "1040");
  const factor = ({ Q1: 4, Q2: 2, Q3: 4 / 3, Q4: 1 })[quarter] || 4;
  const quarterNumber = ({ Q1: 1, Q2: 2, Q3: 3, Q4: 4 })[quarter] || 1;
  const fd = payload.financialData || {};
  const op = fd.operatingExpenses || {};
  const oi = fd.otherIncome || {};
  const cf = payload.carryforward || {};
  const prior = payload.priorPayments || {};
  const ytdRevenue = num(fd.grossRevenue) || num(fd.grossProfit) + num(fd.costOfGoodsSold);
  const ytdCogs = num(fd.costOfGoodsSold);
  const ytdExpenses = sumNumbers(op.salariesWages, op.rentLease, op.utilities, op.mealsEntertainment, op.travel, op.advertising, op.insurance, op.depreciation, op.amortization, op.interest, op.otherDeductions);
  const ytdOtherIncome = sumNumbers(oi.interestIncome, oi.dividendIncome, oi.capitalGains, oi.otherIncome);
  const bookNetIncomeYtd = ytdRevenue - ytdCogs - ytdExpenses + ytdOtherIncome;
  const bookNetIncomeAnnual = roundMoney(bookNetIncomeYtd * factor);
  const mealsAddback = roundMoney(num(op.mealsEntertainment) * factor * 0.5);
  const interestLimit = fd.adjustedTaxableIncome ? Math.max(0, num(op.interest) * factor - Math.max(0, num(fd.businessInterestIncome) + num(fd.adjustedTaxableIncome) * 0.3)) : 0;
  const preliminaryTaxable = Math.max(0, bookNetIncomeAnnual + mealsAddback + interestLimit);
  const nolApplied = Math.min(num(cf.netOperatingLoss), preliminaryTaxable * 0.8);
  const qbiDeduction = ["1040", "1065", "1120-S"].includes(returnType) ? Math.max(0, (preliminaryTaxable - nolApplied) * 0.2) : 0;
  const taxableIncome = roundMoney(Math.max(0, preliminaryTaxable - nolApplied - qbiDeduction));
  const federalTaxBeforeCredits = roundMoney(estimateFederalTax(returnType, taxableIncome, payload.filingStatus || "single"));
  const credits = Math.min(federalTaxBeforeCredits, sumNumbers(cf.generalBusinessCredit, cf.foreignTaxCredit, cf.minimumTaxCredit));
  const annualFederalTax = roundMoney(Math.max(0, federalTaxBeforeCredits - credits));
  const stateRule = stateRuleFor(payload.state);
  const annualStateTax = roundMoney(Math.max(0, taxableIncome * stateRule.rate));
  const federalPaid = priorPaymentsThroughQuarter(prior, "Federal", quarterNumber) + num(prior.priorYearOverpaymentApplied);
  const statePaid = priorPaymentsThroughQuarter(prior, "State", quarterNumber) + num(prior.priorYearOverpaymentAppliedState);
  const currentFederalRequired = annualFederalTax * 0.9 * quarterNumber / 4;
  const currentStateRequired = annualStateTax * 0.9 * quarterNumber / 4;
  const priorFederalSafeHarbor = (num(payload.priorYearFederalTax) || annualFederalTax) * quarterNumber / 4;
  const priorStateSafeHarbor = (num(payload.priorYearStateTax) || annualStateTax) * quarterNumber / 4;
  const safeFederalRequired = Math.min(currentFederalRequired, priorFederalSafeHarbor || currentFederalRequired);
  const safeStateRequired = Math.min(currentStateRequired, priorStateSafeHarbor || currentStateRequired);
  const federalDue = roundMoney(Math.max(0, Math.max(currentFederalRequired, safeFederalRequired) - federalPaid));
  const stateDue = roundMoney(Math.max(0, Math.max(currentStateRequired, safeStateRequired) - statePaid));
  const dueDate = estimateDueDate(year, quarter, returnType);
  const result = {
    clientName: payload.clientName || "Client",
    clientEmail: payload.clientEmail || "",
    returnType,
    taxYear: String(year),
    state: String(payload.state || "").toUpperCase(),
    quarter,
    quarterEndDate: payload.quarterEndDate || quarterEndDate(year, quarter),
    dueDate,
    annualizationFactor: factor,
    bookNetIncomeYtd: roundMoney(bookNetIncomeYtd),
    bookNetIncomeAnnual,
    taxableIncome,
    annualFederalTax,
    annualStateTax,
    federalDue,
    stateDue,
    totalDue: roundMoney(federalDue + stateDue),
    effectiveRate: taxableIncome ? roundMoney(((annualFederalTax + annualStateTax) / taxableIncome) * 100) : 0,
    safeHarborBasis: "Payment recommended uses the larger of current-year annualized tax required through the quarter and safe harbor required through the quarter, reduced by prior payments.",
    caveats: [
      { severity: "MEDIUM", text: "State estimates use built-in default rates and should be verified against the state revenue department for the selected tax year." },
      { severity: "LOW", text: "Uploaded file extraction can support the calculation, but manually entered amounts are treated as controlling." },
    ],
    adjustments: [
      { name: "Meals and entertainment", bookAmount: roundMoney(num(op.mealsEntertainment) * factor), taxAmount: roundMoney(num(op.mealsEntertainment) * factor * 0.5), adjustment: mealsAddback, authority: "IRC 274(n)", url: "https://www.irs.gov/publications/p463" },
      { name: "Business interest expense", bookAmount: roundMoney(num(op.interest) * factor), taxAmount: roundMoney(num(op.interest) * factor - interestLimit), adjustment: interestLimit, authority: "IRC 163(j)", url: "https://www.irs.gov/newsroom/final-regulations-on-the-limitation-on-deduction-for-business-interest-expense" },
      { name: "NOL carryforward", bookAmount: 0, taxAmount: -roundMoney(nolApplied), adjustment: -roundMoney(nolApplied), authority: "IRC 172", url: "https://www.irs.gov/publications/p536" },
      { name: "Section 199A QBI deduction", bookAmount: 0, taxAmount: -roundMoney(qbiDeduction), adjustment: -roundMoney(qbiDeduction), authority: "IRC 199A", url: "https://www.irs.gov/newsroom/tax-cuts-and-jobs-act-provision-11011-section-199a" },
    ],
    sources: [
      { title: "IRS Publication 505", url: "https://www.irs.gov/pub/irs-pdf/p505.pdf", relevance: "Individual estimated tax and safe harbor rules." },
      { title: "IRS Form 2220", url: "https://www.irs.gov/pub/irs-pdf/f2220.pdf", relevance: "Corporate underpayment and annualized income method." },
      { title: "State estimated tax information", url: stateRule.url || "https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes", relevance: "State estimated payment requirements." },
    ],
  };
  result.workbook = buildEstimatedTaxWorkbook(result, payload);
  result.email = buildEstimatedTaxEmail(result);
  result.paymentSummary = estimatedPaymentSummary(result);
  return result;
}

function calculateExtension(payload = {}) {
  const year = Number(payload.taxYear || new Date().getFullYear());
  const returnType = String(payload.returnType || "1040");
  const fed = federalExtensionDates(returnType, year, payload.dateOfDeath);
  const stateCode = String(payload.state || "").toUpperCase();
  const state = STATE_EXTENSION_RULES[stateCode] || { autoWithFederal: true, requiresSeparateForm: false, minimumPayment: "Generally 90% of current year tax", url: "", notes: "Verify specific state extension requirements with the state revenue department." };
  const est = payload.estimatedTaxLiability || {};
  const paid = payload.paymentsAlreadyMade || {};
  const fedPaid = sumNumbers(paid.federalWithholding, paid.federalEstimatedPayments, paid.priorYearOverpaymentApplied);
  const statePaid = sumNumbers(paid.stateWithholding, paid.stateEstimatedPayments, paid.priorYearStateOverpaymentApplied);
  const federalMethod1 = Math.max(0, num(est.federalTaxEstimate) - fedPaid);
  const federalMethod2 = Math.max(0, num(est.priorYearFederalTax) - fedPaid);
  const stateMethod1 = Math.max(0, num(est.stateTaxEstimate) - statePaid);
  const stateMethod2 = Math.max(0, num(est.priorYearStateTax) - statePaid);
  const federalPayment = roundMoney(Math.max(federalMethod1, federalMethod2));
  const statePayment = roundMoney(state.noStateIncomeTax ? 0 : Math.max(stateMethod1, stateMethod2));
  const result = {
    clientName: payload.clientName || "Client",
    clientEmail: payload.clientEmail || "",
    ein: payload.ein || "",
    returnType,
    taxYear: String(year),
    state: stateCode,
    federal: fed,
    stateRule: state,
    federalPayment,
    statePayment,
    totalPayment: roundMoney(federalPayment + statePayment),
    federalMethod1: roundMoney(federalMethod1),
    federalMethod2: roundMoney(federalMethod2),
    stateMethod1: roundMoney(stateMethod1),
    stateMethod2: roundMoney(stateMethod2),
    warning: `Extension extends time to file, not time to pay. Tax must be paid by ${fed.payDeadline} to avoid failure-to-pay penalties under IRC 6651 and interest under IRC 6601.`,
    filingInstructions: extensionInstructions(returnType, fed, stateCode, state),
    penaltyAnalysis: extensionPenaltyRows(federalPayment + statePayment),
  };
  result.workbook = buildExtensionWorkbook(result, payload);
  result.email = buildExtensionEmail(result);
  result.paymentSummary = extensionPaymentSummary(result);
  return result;
}

function estimateFederalTax(returnType, taxableIncome, filingStatus) {
  if (returnType === "1120") return taxableIncome * 0.21;
  if (["1065", "1120-S", "990"].includes(returnType)) return 0;
  if (returnType === "990-T") return taxableIncome * 0.21;
  return individualTax2025(taxableIncome, filingStatus);
}

function individualTax2025(income, filingStatus = "single") {
  const mfj = String(filingStatus).toLowerCase() === "mfj";
  const brackets = mfj
    ? [[23850, .10], [96950, .12], [206700, .22], [394600, .24], [501050, .32], [751600, .35], [Infinity, .37]]
    : [[11925, .10], [48475, .12], [103350, .22], [197300, .24], [250525, .32], [626350, .35], [Infinity, .37]];
  let tax = 0;
  let last = 0;
  for (const [limit, rate] of brackets) {
    const taxableAtRate = Math.max(0, Math.min(income, limit) - last);
    tax += taxableAtRate * rate;
    if (income <= limit) break;
    last = limit;
  }
  return tax;
}

function buildEstimatedTaxWorkbook(result, payload) {
  return {
    sheets: [
      {
        name: "Estimated Tax Summary",
        rows: [
          ["ESTIMATED TAX WORKPAPER"],
          ["Client", result.clientName, "Return Type", result.returnType],
          ["Tax Year", result.taxYear, "Quarter", result.quarter],
          ["State", result.state, "Date Prepared", new Date().toISOString().slice(0, 10)],
          [],
          ["PAYMENT SUMMARY"],
          ["Federal Payment Due", result.federalDue, "Due Date", result.dueDate],
          [`${result.state || "State"} Payment Due`, result.stateDue, "Due Date", result.dueDate],
          ["TOTAL DUE", result.totalDue],
          ["Safe harbor basis", result.safeHarborBasis],
          ["Effective rate", `${result.effectiveRate}%`],
        ],
        styles: [{ r: 0, c: 0, bold: true, fill: "DBEAFE" }, { r: 8, c: 0, bold: true, fill: "BFDBFE" }],
      },
      {
        name: "Annualization",
        rows: [
          ["Line", "YTD Amount", "Annualization Factor", "Annualized Amount"],
          ["Book net income", result.bookNetIncomeYtd, result.annualizationFactor, result.bookNetIncomeAnnual],
          ["Taxable income after adjustments", "", "", result.taxableIncome],
          ["Annual federal tax", "", "", result.annualFederalTax],
          ["Annual state tax", "", "", result.annualStateTax],
        ],
      },
      {
        name: "Book-to-Tax",
        rows: [["Adjustment", "Book Amount", "Tax Amount", "Adjustment", "Authority", "Source"], ...result.adjustments.map((a) => [a.name, a.bookAmount, a.taxAmount, a.adjustment, a.authority, a.url])],
      },
      {
        name: "Carryforwards",
        rows: [
          ["Carryforward", "Amount", "Description"],
          ["NOL Carryforward (Federal)", num(payload.carryforward?.netOperatingLoss), ""],
          ["Capital Loss Carryforward", num(payload.carryforward?.capitalLossCarryover), ""],
          ["Charitable Contribution Carryforward", num(payload.carryforward?.charitableContributionCarryforward), ""],
          ["General Business Credit Carryforward", num(payload.carryforward?.generalBusinessCredit), ""],
          ["Foreign Tax Credit Carryforward", num(payload.carryforward?.foreignTaxCredit), ""],
          ["State NOL Carryforward", num(payload.carryforward?.stateNetOperatingLoss), ""],
          ["Other Carryforward", num(payload.carryforward?.otherCarryforward), payload.carryforward?.otherCarryforwardDescription || ""],
        ],
      },
      {
        name: "Sources",
        rows: [["Source", "URL", "Relevance"], ...result.sources.map((s) => [s.title, s.url, s.relevance]), ["Additional notes", payload.notes || "", ""]],
      },
    ],
    aiNotes: result.caveats.map((item) => `${item.severity}: ${item.text}`),
  };
}

function buildExtensionWorkbook(result) {
  const stateFormNeeded = result.stateRule.requiresSeparateForm ? "Yes" : "No";
  return {
    sheets: [
      {
        name: "Extension Summary",
        rows: [
          ["EXTENSION WORKPAPER"],
          ["Client", result.clientName, "Return Type", result.returnType],
          ["Tax Year", result.taxYear, "State", result.state],
          ["Date Prepared", new Date().toISOString().slice(0, 10)],
          [],
          ["DEADLINES"],
          ["Federal Original Due Date", result.federal.originalDue],
          ["Federal Extended Due Date", result.federal.extendedDue],
          ["Federal Extension Form", `Form ${result.federal.form} - ${result.federal.formName}`],
          ["FEDERAL PAY BY DATE", result.federal.payDeadline],
          [],
          ["State Original Due Date", result.federal.originalDue],
          ["State Extended Due Date", stateExtendedDue(result)],
          ["State Extension Form Needed?", stateFormNeeded],
          ["State Form Number", result.stateRule.stateForm || "N/A"],
          ["STATE PAY BY DATE", result.federal.payDeadline],
          [],
          ["PAYMENT SUMMARY"],
          ["Federal Payment Recommended", result.federalPayment],
          ["State Payment Recommended", result.statePayment],
          [`TOTAL TO PAY BY ${result.federal.payDeadline}`, result.totalPayment],
          ["Federal Pay At", result.federal.onlinePayUrl],
          ["State Pay At", result.stateRule.url || "Verify state revenue department"],
          [],
          ["IMPORTANT NOTE", result.warning],
        ],
        styles: [{ r: 0, c: 0, bold: true, fill: "FFEDD5" }, { r: 20, c: 0, bold: true, fill: "FED7AA" }, { r: 24, c: 0, bold: true, fill: "FEE2E2", fontColor: "991B1B" }],
      },
      {
        name: "Payment Calculation",
        rows: [
          ["Extension Balance Due Calculation"],
          [],
          ["FEDERAL"],
          ["Estimated Full Year Federal Tax less payments", result.federalMethod1],
          ["Prior Year Federal Tax less payments", result.federalMethod2],
          ["RECOMMENDED FEDERAL PAYMENT", result.federalPayment],
          ["Basis", "Recommended payment is the larger of current-year balance and safe harbor balance."],
          [],
          ["STATE"],
          ["Estimated Full Year State Tax less payments", result.stateMethod1],
          ["Prior Year State Tax less payments", result.stateMethod2],
          ["RECOMMENDED STATE PAYMENT", result.statePayment],
          ["Basis", result.stateRule.noStateIncomeTax ? "No state income tax." : "Recommended payment is the larger of current-year balance and safe harbor balance."],
        ],
        styles: [{ r: 0, c: 0, bold: true, fill: "FFEDD5" }, { r: 5, c: 0, bold: true, fill: "DCFCE7" }, { r: 11, c: 0, bold: true, fill: "DCFCE7" }],
      },
      {
        name: "Penalty Analysis",
        rows: [["Scenario", "Penalty Rate", "Monthly Cost", "Annual Cost"], ...result.penaltyAnalysis.map((row) => [row.scenario, row.rate, row.monthlyCost, row.annualCost]), [], ["Based on estimated balance of", result.totalPayment], ["Interest note", "IRS interest may also apply under IRC 6601. Verify current federal and state rates."]],
      },
    ],
    aiNotes: [result.warning],
  };
}

function buildEstimatedTaxEmail(result) {
  return {
    subject: `${result.quarter} ${result.taxYear} estimated tax payment - ${result.clientName}`,
    body: [
      `Dear ${result.clientName},`,
      "",
      `Based on the year-to-date information provided, the recommended ${result.quarter} estimated tax payments for tax year ${result.taxYear} are:`,
      "",
      `Federal (IRS): ${money(result.federalDue)} due ${result.dueDate}`,
      `${result.state || "State"}: ${money(result.stateDue)} due ${result.dueDate}`,
      `Total: ${money(result.totalDue)}`,
      "",
      result.safeHarborBasis,
      "",
      "Please confirm before making payment if your income or withholding differs from the information provided.",
    ].join("\n"),
  };
}

function buildExtensionEmail(result) {
  const noPayment = result.totalPayment <= 0;
  return {
    subject: `${result.returnType} Extension - ${result.clientName} - Tax Year ${result.taxYear}`,
    body: [
      `Dear ${result.clientName},`,
      "",
      `We are filing an extension for your ${result.returnType} for tax year ${result.taxYear}.`,
      "",
      `EXTENSION FILED: Form ${result.federal.form} - extends filing deadline to ${result.federal.extendedDue}.`,
      "",
      `PAYMENT REQUIRED BY ${result.federal.payDeadline}:`,
      noPayment ? "Based on payments already made, no additional payment appears required with this extension." : `Federal (IRS): ${money(result.federalPayment)}\n  Pay at: ${result.federal.onlinePayUrl}\n${result.state}: ${money(result.statePayment)}\n  Pay at: ${result.stateRule.url || "state revenue department website"}`,
      "",
      result.warning,
      "",
      `Your extended filing deadline is ${result.federal.extendedDue}.`,
      "",
      "Disclaimer: The payment amount above is an estimate based on information available. Final tax liability will be determined when the return is prepared.",
    ].join("\n"),
  };
}

function estimatedPaymentSummary(result) {
  return `Federal: ${money(result.federalDue)} due ${result.dueDate} - pay at https://directpay.irs.gov\nState (${result.state}): ${money(result.stateDue)} due ${result.dueDate}`;
}

function extensionPaymentSummary(result) {
  return `Federal extension payment: ${money(result.federalPayment)} due ${result.federal.payDeadline}\nState (${result.state}) extension payment: ${money(result.statePayment)} due ${result.federal.payDeadline}\nTotal to pay: ${money(result.totalPayment)}\nExtended filing deadline: ${result.federal.extendedDue}`;
}

function federalExtensionDates(returnType, year, dateOfDeath) {
  const rule = EXTENSION_DEADLINES[returnType] || EXTENSION_DEADLINES["1040"];
  if (returnType === "706" && dateOfDeath) {
    const original = addMonths(new Date(`${dateOfDeath}T00:00:00`), 9);
    const extended = addMonths(new Date(`${dateOfDeath}T00:00:00`), 15);
    return { ...rule, originalDue: formatDate(original), extendedDue: formatDate(extended), payDeadline: formatDate(original) };
  }
  const original = new Date(year + 1, rule.originalMonth - 1, rule.originalDay);
  const extended = new Date(year + 1, rule.extendedMonth - 1, rule.extendedDay);
  return { ...rule, originalDue: formatDate(original), extendedDue: formatDate(extended), payDeadline: formatDate(original) };
}

function extensionInstructions(returnType, fed, stateCode, state) {
  const instructions = [`File federal Form ${fed.form} by ${fed.originalDue}.`, `Pay estimated federal tax by ${fed.payDeadline}.`];
  if (state.noStateIncomeTax) instructions.push(`${stateCode} has no state income tax.`);
  else if (state.requiresSeparateForm) instructions.push(`File ${stateCode} extension form ${state.stateForm || ""} by ${fed.originalDue}.`);
  else instructions.push(`${stateCode || "State"} extension is generally automatic with federal extension, subject to payment rules.`);
  return instructions;
}

function extensionPenaltyRows(balance) {
  const monthly = roundMoney(Math.max(0, balance) * 0.005);
  const filingMonthly = roundMoney(Math.max(0, balance) * 0.05);
  return [
    { scenario: "Extension filed + full payment", rate: "0%", monthlyCost: 0, annualCost: 0 },
    { scenario: "Extension filed + no payment", rate: "0.5%/mo", monthlyCost: monthly, annualCost: roundMoney(monthly * 12) },
    { scenario: "No extension + no payment (filing)", rate: "5%/mo", monthlyCost: filingMonthly, annualCost: roundMoney(filingMonthly * 12) },
    { scenario: "No extension + no payment (both)", rate: "5.5%/mo", monthlyCost: roundMoney(monthly + filingMonthly), annualCost: roundMoney((monthly + filingMonthly) * 12) },
  ];
}

function stateExtendedDue(result) {
  if (result.stateRule.noStateIncomeTax) return "N/A";
  return result.federal.extendedDue;
}

function estimateDueDate(year, quarter, returnType) {
  const dueYear = quarter === "Q4" ? year + 1 : year;
  const dates = returnType === "1120" ? { Q1: [4, 15], Q2: [6, 15], Q3: [9, 15], Q4: [12, 15] } : { Q1: [4, 15], Q2: [6, 15], Q3: [9, 15], Q4: [1, 15] };
  const [month, day] = dates[quarter] || dates.Q1;
  return formatDate(new Date(dueYear, month - 1, day));
}

function quarterEndDate(year, quarter) {
  const dates = { Q1: `${year}-03-31`, Q2: `${year}-06-30`, Q3: `${year}-09-30`, Q4: `${year}-12-31` };
  return dates[quarter] || dates.Q1;
}

function priorPaymentsThroughQuarter(prior, label, quarterNumber) {
  const q1 = num(prior[`q1${label}`]);
  const q2 = quarterNumber >= 3 ? num(prior[`q2${label}`]) : 0;
  const q3 = quarterNumber >= 4 ? num(prior[`q3${label}`]) : 0;
  return q1 + q2 + q3;
}

function stateRuleFor(state) {
  return EST_STATE_RULES[String(state || "").toUpperCase()] || { rate: 0.05, url: "", name: state || "State" };
}

function sumNumbers(...values) {
  return values.reduce((sum, value) => sum + num(value), 0);
}

function num(value) {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function addMonths(date, months) {
  const copy = new Date(date.getTime());
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
async function handleLoginPage(_req, res) {
  sendHtml(res, 200, buildLoginPage());
}

async function handleLandingPage(_req, res) {
  try {
    sendHtml(res, 200, fsSync.readFileSync(path.join(ROOT, "landing.html"), "utf8"));
  } catch (_) {
    redirect(res, "/login"); // landing missing → previous behavior
  }
}

async function handleAccessRequestPage(_req, res) {
  sendHtml(res, 200, buildAccessRequestPage());
}

async function handleLogin(req, res) {
  const payload = await readJsonBody(req);
  const username = String(payload.username || "").trim();
  const password = String(payload.password || "");
  if (isRateLimited(req, `login:${username || "blank"}`, LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW_MS)) {
    appendAuditLog(req, "auth.rate_limited", { username });
    sendJson(res, 429, { error: "Too many login attempts. Please wait and try again." });
    return;
  }
  const user = getAuthUsers().find((candidate) => candidate.username === username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    appendAuditLog(req, "auth.login_failed", { username });
    sendJson(res, 401, { error: "Invalid username or password." });
    return;
  }

  if (ADMIN_2FA_ENABLED && user.role === "admin") {
    const challengeId = String(payload.twoFactorChallengeId || "").trim();
    const code = String(payload.twoFactorCode || "").trim();
    if (challengeId || code) {
      const verification = verifyAdminTwoFactorChallenge(req, user, challengeId, code);
      if (!verification.ok) {
        sendJson(res, 401, { error: verification.error });
        return;
      }
    } else {
      const challenge = await startAdminTwoFactorChallenge(req, user).catch((error) => ({ ok: false, error: error.message || "Could not send verification code." }));
      if (!challenge.ok) {
        sendJson(res, 503, { error: challenge.error || "Could not send admin verification code." });
        return;
      }
      sendJson(res, 202, { requiresTwoFactor: true, challengeId: challenge.challengeId, message: "Verification code sent." });
      return;
    }
  }

  const sessionUser = authUserForSession(user);
  const token = signSession({ ...sessionUser, user: sessionUser, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS });
  res.setHeader("set-cookie", buildSessionCookie(token));
  appendAuditLog(req, "auth.login_success", { username: sessionUser.username, role: sessionUser.role });
  sendJson(res, 200, { ok: true, user: sessionUser, ...sessionUser });
}

async function handleAccessRequest(req, res) {
  const payload = await readJsonBody(req);
  const email = String(payload.email || "").trim().toLowerCase();
  const contactName = String(payload.contactName || payload.name || "").trim();
  const annualReturns = Number(String(payload.annualReturns || "").replace(/[^0-9.]/g, ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    sendJson(res, 400, { error: "Please enter a valid email address." });
    return;
  }
  if (contactName.length < 2) {
    sendJson(res, 400, { error: "Please enter your firm, company, or personal name." });
    return;
  }
  if (!Number.isFinite(annualReturns) || annualReturns <= 0) {
    sendJson(res, 400, { error: "Please enter the estimated annual filed returns." });
    return;
  }
  if (annualReturns > 1000000) {
    sendJson(res, 400, { error: "Please enter a realistic annual return estimate." });
    return;
  }

  const request = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    email,
    contactName,
    annualReturns: Math.round(annualReturns),
    ip: clientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 240),
    mailStatus: "pending",
  };
  saveAccessRequest(request);
  await flushDatabaseSyncQueue();
  const mailResult = await notifyAccessRequest(request).catch((error) => ({ ok: false, error: error.message || "Mail notification failed." }));
  updateAccessRequestMailStatus(request.id, mailResult);
  await flushDatabaseSyncQueue();
  appendAuditLog(req, "access_request.created", {
    email,
    contactName,
    annualReturns: request.annualReturns,
    mailOk: Boolean(mailResult.ok),
  });
  sendJson(res, 200, {
    ok: true,
    message: "Thanks. We received your request and will contact you shortly with a proposal based on your estimated filed returns.",
  });
}

async function handleLogout(req, res) {
  appendAuditLog(req, "auth.logout", {});
  res.setHeader("set-cookie", clearSessionCookie());
  sendJson(res, 200, { ok: true });
}

async function handleAuthStatus(req, res) {
  const session = getSession(req);
  sendJson(res, 200, {
    authenticated: Boolean(session),
    username: session?.username || "",
    role: session?.role || "",
    displayName: session?.displayName || session?.username || "",
    authRequired: AUTH_REQUIRED,
  });
}

async function handleChangePassword(req, res) {
  const session = getSession(req);
  if (!session?.username) { sendJson(res, 401, { error: "Authentication required." }); return; }
  const payload = await readJsonBody(req);
  const currentPassword = String(payload.currentPassword || "");
  const newPassword = String(payload.newPassword || "");
  if (newPassword.length < 12) { sendJson(res, 400, { error: "New password must be at least 12 characters." }); return; }
  // Serialize per-user to prevent two simultaneous password-change requests
  // from both reading the store before either writes.
  await withUserStoreLock(session.username, () => {
    const store = readUserStore();
    const user = store.users.find((item) => item.username === session.username);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
      appendAuditLog(req, "auth.password_change_failed", { username: session.username });
      sendJson(res, 401, { error: "Current password is incorrect." });
      return;
    }
    user.passwordHash = createPasswordHash(newPassword);
    user.updatedAt = new Date().toISOString();
    user.lastPasswordChangeAt = user.updatedAt;
    writeUserStore(store);
    appendAuditLog(req, "auth.password_changed", { username: session.username });
    sendJson(res, 200, { ok: true });
  });
}

async function handleAdminUsersApi(req, res, requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const manager = req.user || getSession(req);
  const isGlobalAdmin = manager?.role === "admin";
  const managerTenant = userTenantId(manager?.username);
  // A firm_admin can only touch non-admin users of their OWN firm.
  const canManageUser = (user) => isGlobalAdmin
    || (user && user.role !== "admin" && String(user.tenantId || DEFAULT_TENANT_ID) === managerTenant);

  // GET is read-only — no lock needed.
  if (parts.length === 3 && req.method === "GET") {
    const store = readUserStore();
    const costEntries = readCostLog().entries || [];
    const preloaded = { store, costEntries };
    const visible = isGlobalAdmin ? store.users
      : store.users.filter((u) => String(u.tenantId || DEFAULT_TENANT_ID) === managerTenant);
    sendJson(res, 200, { users: visible.map((u) => publicUser(u, preloaded)) });
    return;
  }

  // All write operations serialised under a global user-store lock.
  // Key "__userstore__" is a fixed sentinel for the shared users.json file.
  await withUserStoreLock("__userstore__", async () => {
    const store = readUserStore(); // fresh read inside the lock
    if (parts.length === 3 && req.method === "POST") {
      const payload = await readJsonBody(req);
      const username = String(payload.username || "").trim();
      const password = String(payload.password || "");
      if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) { sendJson(res, 400, { error: "Username must be 3-64 letters, numbers, dots, hyphens, or underscores." }); return; }
      if (password.length < 12) { sendJson(res, 400, { error: "Password must be at least 12 characters." }); return; }
      if (store.users.some((user) => user.username === username)) { sendJson(res, 409, { error: "Username already exists." }); return; }
      const now = new Date().toISOString();
      const bgId = payload.budgetGroupId || null;
      const groupExists = bgId && (store.budgetGroups || []).some((g) => g.id === bgId);
      const user = {
        username,
        passwordHash: createPasswordHash(password),
        // firm_admin: new users are forced into the manager's own firm, as plain users,
        // with no global budget-group assignment. Only the global admin chooses these.
        tenantId: isGlobalAdmin ? String(payload.tenantId || DEFAULT_TENANT_ID).trim().toLowerCase() || DEFAULT_TENANT_ID : managerTenant,
        role: isGlobalAdmin ? (payload.role === "admin" ? "admin" : payload.role === "firm_admin" ? "firm_admin" : "user") : "user",
        displayName: String(payload.displayName || username).trim(),
        spendLimitUsd: sanitizeSpendLimit(payload.spendLimitUsd),
        budgetGroupId: isGlobalAdmin && groupExists ? bgId : null,
        active: payload.active !== false,
        createdAt: now,
        updatedAt: now,
        lastPasswordChangeAt: now,
      };
      store.users.push(user);
      writeUserStore(store);
      await flushDatabaseSyncQueue();
      appendAuditLog(req, "admin.user_created", { username, role: user.role });
      sendJson(res, 200, { user: publicUser(user) });
      return;
    }
    if (parts.length === 4 && req.method === "PUT") {
      const username = decodeURIComponent(parts[3]);
      const payload = await readJsonBody(req);
      const user = store.users.find((item) => item.username === username);
      if (!user) { sendJson(res, 404, { error: "User not found." }); return; }
      if (!canManageUser(user)) { sendJson(res, 403, { error: "You can only manage users of your own firm." }); return; }
      // Role changes are a global-admin decision only.
      if (payload.role !== undefined && isGlobalAdmin) user.role = payload.role === "admin" ? "admin" : payload.role === "firm_admin" ? "firm_admin" : "user";
      if (payload.displayName !== undefined) user.displayName = String(payload.displayName || username).trim();
      if (payload.active !== undefined) user.active = Boolean(payload.active);
      if (payload.spendLimitUsd !== undefined) user.spendLimitUsd = sanitizeSpendLimit(payload.spendLimitUsd);
      if (payload.budgetGroupId !== undefined && isGlobalAdmin) {
        const bgId = payload.budgetGroupId || null;
        const groupExists = bgId && (store.budgetGroups || []).some((g) => g.id === bgId);
        user.budgetGroupId = groupExists ? bgId : null;
      }
      user.updatedAt = new Date().toISOString();
      writeUserStore(store);
      await flushDatabaseSyncQueue();
      appendAuditLog(req, "admin.user_updated", { username, role: user.role, active: user.active !== false, spendLimitUsd: user.spendLimitUsd, budgetGroupId: user.budgetGroupId || null });
      sendJson(res, 200, { user: publicUser(user) });
      return;
    }
    if (parts.length === 4 && req.method === "DELETE") {
      const username = decodeURIComponent(parts[3]);
      const index = store.users.findIndex((item) => item.username === username);
      if (index < 0) { sendJson(res, 404, { error: "User not found." }); return; }
      const user = store.users[index];
      if (user.username === req.user?.username) { sendJson(res, 400, { error: "You cannot delete your own admin account." }); return; }
      if (!canManageUser(user)) { sendJson(res, 403, { error: "You can only manage users of your own firm." }); return; }
      store.users.splice(index, 1);
      writeUserStore(store);
      await flushDatabaseSyncQueue();
      appendAuditLog(req, "admin.user_deleted", { username, role: user.role });
      sendJson(res, 200, { ok: true });
      return;
    }
    if (parts.length === 5 && parts[4] === "password" && req.method === "PUT") {
      const username = decodeURIComponent(parts[3]);
      const payload = await readJsonBody(req);
      const password = String(payload.password || "");
      const user = store.users.find((item) => item.username === username);
      if (!user) { sendJson(res, 404, { error: "User not found." }); return; }
      if (!canManageUser(user)) { sendJson(res, 403, { error: "You can only manage users of your own firm." }); return; }
      if (password.length < 12) { sendJson(res, 400, { error: "Password must be at least 12 characters." }); return; }
      user.passwordHash = createPasswordHash(password);
      user.updatedAt = new Date().toISOString();
      user.lastPasswordChangeAt = user.updatedAt;
      writeUserStore(store);
      await flushDatabaseSyncQueue();
      appendAuditLog(req, "admin.user_password_reset", { username });
      sendJson(res, 200, { ok: true, user: publicUser(user) });
      return;
    }
    sendJson(res, 404, { error: "User admin route not found." });
  });
}

async function handleAdminBudgetGroupsApi(req, res, requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  // parts: ["api","admin","budget-groups"] or ["api","admin","budget-groups",":id"]

  if (parts.length === 3 && req.method === "GET") {
    const store = readUserStore();
    const costEntries = readCostLog().entries || [];
    const groups = (store.budgetGroups || []).map((g) => {
      const members = store.users.filter((u) => u.budgetGroupId === g.id);
      const memberUsernames = members.map((u) => u.username);
      const usedUsd = roundMoney(costEntries
        .filter((e) => memberUsernames.includes(e.username))
        .reduce((sum, e) => sum + entryTotalCost(e), 0));
      const limitUsd = sanitizeSpendLimit(g.limitUsd);
      const remainingUsd = limitUsd !== null ? roundMoney(Math.max(0, limitUsd - usedUsd)) : null;
      return { id: g.id, name: g.name, limitUsd, usedUsd, remainingUsd, memberCount: members.length, memberUsernames, createdAt: g.createdAt || "" };
    });
    sendJson(res, 200, { budgetGroups: groups });
    return;
  }

  await withUserStoreLock("__userstore__", async () => {
    const store = readUserStore();
    if (!store.budgetGroups) store.budgetGroups = [];

    if (parts.length === 3 && req.method === "POST") {
      const payload = await readJsonBody(req);
      const name = String(payload.name || "").trim();
      if (!name) { sendJson(res, 400, { error: "Group name is required." }); return; }
      const group = { id: crypto.randomUUID(), name, limitUsd: sanitizeSpendLimit(payload.limitUsd), createdAt: new Date().toISOString() };
      store.budgetGroups.push(group);
      writeUserStore(store);
      appendAuditLog(req, "admin.budget_group_created", { id: group.id, name });
      sendJson(res, 200, { group });
      return;
    }

    if (parts.length === 4 && req.method === "PUT") {
      const id = decodeURIComponent(parts[3]);
      const payload = await readJsonBody(req);
      const group = store.budgetGroups.find((g) => g.id === id);
      if (!group) { sendJson(res, 404, { error: "Budget group not found." }); return; }
      if (payload.name !== undefined) group.name = String(payload.name || "").trim();
      if (payload.limitUsd !== undefined) group.limitUsd = sanitizeSpendLimit(payload.limitUsd);
      writeUserStore(store);
      appendAuditLog(req, "admin.budget_group_updated", { id, name: group.name, limitUsd: group.limitUsd });
      sendJson(res, 200, { group });
      return;
    }

    if (parts.length === 4 && req.method === "DELETE") {
      const id = decodeURIComponent(parts[3]);
      const members = store.users.filter((u) => u.budgetGroupId === id);
      if (members.length > 0) {
        sendJson(res, 400, { error: `Cannot delete a group that has ${members.length} assigned user(s). Remove all members first.` });
        return;
      }
      const idx = store.budgetGroups.findIndex((g) => g.id === id);
      if (idx < 0) { sendJson(res, 404, { error: "Budget group not found." }); return; }
      store.budgetGroups.splice(idx, 1);
      writeUserStore(store);
      appendAuditLog(req, "admin.budget_group_deleted", { id });
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "Budget group route not found." });
  });
}

async function handleGoogleAuth(req, res) {
  if (!isGoogleDriveEnabled()) {
    sendHtml(res, 503, "<p>Google Drive is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</p>");
    return;
  }
  const session = getSession(req);
  if (!session?.username) {
    redirect(res, "/login");
    return;
  }
  const statePayload = Buffer.from(JSON.stringify({ username: session.username, sig: hmac(`google:${session.username}`) })).toString("base64url");
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: statePayload,
  });
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

async function handleGoogleCallback(_req, res, requestUrl) {
  if (!isGoogleDriveEnabled()) {
    sendHtml(res, 503, "<p>Google Drive is not configured.</p>");
    return;
  }
  const code = requestUrl.searchParams.get("code");
  if (!code) {
    sendHtml(res, 400, "<p>Missing Google OAuth code.</p>");
    return;
  }
  let state = {};
  try { state = JSON.parse(Buffer.from(requestUrl.searchParams.get("state") || "", "base64url").toString("utf8")); } catch (_) {}
  const username = String(state.username || "");
  if (!username || !safeEqual(String(state.sig || ""), hmac(`google:${username}`))) {
    sendHtml(res, 400, "<p>Google OAuth state is invalid. Start the connection again from the app.</p>");
    return;
  }
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    sendHtml(res, 400, `<p>Google OAuth failed: ${escapeHtml(String(tokenData.error_description || tokenData.error || "Unknown error"))}</p>`);
    return;
  }
  writeGoogleTokens(username, normalizeGoogleTokens(tokenData, username));
  appendAuditLog({ user: { username } }, "google.connected", { scopes: tokenData.scope || GOOGLE_OAUTH_SCOPE });
  sendHtml(res, 200, `<!doctype html><html><body><script>if (window.opener) window.opener.postMessage({type:"google_connected"},"*"); window.close();</script><p>Google connected. You can close this tab.</p></body></html>`);
}

async function handleQboAuth(req, res) {
  if (!isQboEnabled()) {
    sendHtml(res, 503, "<p>QuickBooks Online is not configured. Set QBO_CLIENT_ID and QBO_CLIENT_SECRET.</p>");
    return;
  }
  const session = getSession(req);
  if (!session?.username) {
    redirect(res, "/login");
    return;
  }
  const params = new URLSearchParams({
    client_id: QBO_CLIENT_ID,
    response_type: "code",
    scope: QBO_SCOPES,
    redirect_uri: QBO_REDIRECT_URI,
    state: session.username,
  });
  redirect(res, `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`);
}

async function handleQboCallback(_req, res, requestUrl) {
  if (!isQboEnabled()) {
    sendHtml(res, 503, "<p>QuickBooks Online is not configured.</p>");
    return;
  }
  const code = requestUrl.searchParams.get("code") || "";
  const realmId = requestUrl.searchParams.get("realmId") || "";
  const username = requestUrl.searchParams.get("state") || "augusto";
  if (!code || !realmId) {
    sendHtml(res, 400, "<p>QuickBooks authorization did not return a code and company id.</p>");
    return;
  }
  const tokenRes = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString("base64")}`,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: QBO_REDIRECT_URI }),
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    sendHtml(res, 400, `<p>QuickBooks connection failed: ${escapeHtml(tokens.error_description || tokens.error || "Token exchange failed.")}</p>`);
    return;
  }
  writeQboTokenRecord(username, realmId, normalizeQboTokens(tokens, realmId));
  let companyName = realmId;
  try {
    const companyRes = await qboRequest(username, realmId, `/companyinfo/${realmId}`);
    companyName = companyRes.CompanyInfo?.CompanyName || companyName;
  } catch (_) {}
  updateQboCompany(username, realmId, { companyName, realmId, lastSync: new Date().toISOString() });
  sendHtml(res, 200, `<!doctype html><html><body><script>if (window.opener) window.opener.postMessage({type:"qbo_connected",company:${JSON.stringify(companyName)}},"*"); window.close();</script><p>QuickBooks Online connected. You can close this tab.</p></body></html>`);
}

function requireAuthenticated(req, res) {
  if (!AUTH_REQUIRED) return true;
  if (!isAuthConfigured()) {
    if (isApiRequest(req)) sendJson(res, 503, { error: "Authentication is not configured." });
    else sendHtml(res, 503, buildLoginPage("Authentication is not configured for this deployment."));
    return false;
  }

  const session = getSession(req);
  if (session) {
    req.user = session;
    return true;
  }

  if (isApiRequest(req)) sendJson(res, 401, { error: "Authentication required." });
  else redirect(res, "/login");
  return false;
}

function isAuthConfigured() {
  return !AUTH_REQUIRED || (AUTH_SECRET.length >= 32 && getAuthUsers().length > 0);
}

function getAuthUsers() {
  const store = readUserStore();
  const users = store.users;
  return users
    .filter((user) => user && typeof user.username === "string" && typeof user.passwordHash === "string" && user.active !== false)
    .map((user) => ({
      ...user,
      tenantId: String(user.tenantId || user.tenant_id || DEFAULT_TENANT_ID),
      role: normalizeUserRole(user.role, user.username),
      displayName: String(user.displayName || user.username),
      spendLimitUsd: user.spendLimitUsd === undefined ? null : sanitizeSpendLimit(user.spendLimitUsd),
    }));
}

function normalizeUserRole(role, username) {
  if (role === "admin" || (!role && username === "augusto")) return "admin";
  if (role === "firm_admin") return "firm_admin";
  return "user";
}

function readUserStore() {
  try {
    if (fsSync.existsSync(USERS_PATH)) {
      const parsed = JSON.parse(fsSync.readFileSync(USERS_PATH, "utf8"));
      return {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        budgetGroups: Array.isArray(parsed.budgetGroups) ? parsed.budgetGroups : [],
      };
    }
  } catch (_) {}
  const users = parseAuthUsersJson();
  if (users.length) writeUserStore({ users, budgetGroups: [] });
  return { users, budgetGroups: [] };
}

function writeUserStore(store) {
  writeJsonFile(USERS_PATH, {
    users: Array.isArray(store.users) ? store.users : [],
    budgetGroups: Array.isArray(store.budgetGroups) ? store.budgetGroups : [],
  });
}

function parseAuthUsersJson() {
  try {
    const users = JSON.parse(AUTH_USERS_JSON);
    if (!Array.isArray(users)) return [];
    return users
      .filter((user) => user && typeof user.username === "string" && typeof user.passwordHash === "string")
      .map((user) => ({
        ...user,
        tenantId: String(user.tenantId || user.tenant_id || DEFAULT_TENANT_ID),
        role: normalizeUserRole(user.role, user.username),
        displayName: String(user.displayName || user.username),
        spendLimitUsd: user.spendLimitUsd === undefined ? null : sanitizeSpendLimit(user.spendLimitUsd),
        active: user.active !== false,
        createdAt: user.createdAt || new Date().toISOString(),
      }));
  } catch (_) {
    return [];
  }
}

function publicUser(user, preloaded = {}) {
  const budget = userSpendBudget(user.username, preloaded);
  return {
    username: user.username,
    role: normalizeUserRole(user.role, user.username),
    displayName: user.displayName || user.username,
    tenantId: String(user.tenantId || DEFAULT_TENANT_ID),
    active: user.active !== false,
    spendLimitUsd: user.spendLimitUsd === undefined ? null : sanitizeSpendLimit(user.spendLimitUsd),
    spendUsedUsd: budget.usedUsd,
    spendRemainingUsd: budget.remainingUsd,
    spendHasLimit: budget.hasLimit,
    budgetGroupId: user.budgetGroupId || null,
    budgetGroupName: budget.budgetGroupName || null,
    budgetGroupLimitUsd: budget.budgetGroupId ? budget.limitUsd : null,
    createdAt: user.createdAt || "",
    updatedAt: user.updatedAt || "",
    lastPasswordChangeAt: user.lastPasswordChangeAt || "",
  };
}

function sanitizeSpendLimit(value) {
  if (value === null || value === "" || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return roundMoney(number);
}

function normalizedCostEntry(entry = {}) {
  const usage = {
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    cache_creation_input_tokens: entry.cacheCreationTokens,
    cache_read_input_tokens: entry.cacheReadTokens,
  };
  const hasTokenUsage = Object.values(usage).some((value) => Number(value || 0) > 0);
  if (!hasTokenUsage) return { ...entry, totalCost: roundMoney(Number(entry.totalCost || 0)) };
  const cost = calculateCost(usage, entry.model || MODEL_FALLBACKS[0] || "claude-sonnet-4-6");
  const storedTotal = roundMoney(Number(entry.totalCost || 0));
  // Prefer the totalCost stored at billing time — it reflects the rates in effect when the
  // call was made. Only fall back to the recalculated value for legacy entries that have
  // token counts but no stored totalCost (storedTotal === 0).
  return {
    ...entry,
    ...cost,
    totalCost: storedTotal > 0 ? storedTotal : cost.totalCost,
  };
}

function entryTotalCost(entry = {}) {
  return normalizedCostEntry(entry).totalCost;
}

// preloaded = { store, costEntries } — pass when computing budgets for multiple users in
// one request so the caller can read both files once instead of once per user.
function userSpendBudget(username, preloaded = {}) {
  const store = preloaded.store || readUserStore();
  const costEntries = preloaded.costEntries || readCostLog().entries || [];
  const user = store.users.find((item) => item.username === username);

  // If the user belongs to a budget group, aggregate spending across all members.
  if (user?.budgetGroupId) {
    const group = (store.budgetGroups || []).find((g) => g.id === user.budgetGroupId);
    if (group) {
      const memberUsernames = store.users
        .filter((u) => u.budgetGroupId === group.id)
        .map((u) => u.username);
      const usedUsd = roundMoney(costEntries
        .filter((entry) => memberUsernames.includes(entry.username))
        .reduce((sum, entry) => sum + entryTotalCost(entry), 0));
      const limitUsd = sanitizeSpendLimit(group.limitUsd);
      const hasLimit = limitUsd !== null;
      const remainingUsd = hasLimit ? roundMoney(Math.max(0, Number(limitUsd || 0) - usedUsd)) : null;
      return { hasLimit, limitUsd, usedUsd, remainingUsd, budgetGroupId: group.id, budgetGroupName: group.name };
    }
  }

  // Individual budget — original behavior.
  const limitUsd = user?.spendLimitUsd === undefined ? null : sanitizeSpendLimit(user.spendLimitUsd);
  const usedUsd = roundMoney(costEntries
    .filter((entry) => entry.username === username)
    .reduce((sum, entry) => sum + entryTotalCost(entry), 0));
  const hasLimit = limitUsd !== null;
  const remainingUsd = hasLimit ? roundMoney(Math.max(0, Number(limitUsd || 0) - usedUsd)) : null;
  return { hasLimit, limitUsd, usedUsd, remainingUsd };
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, 210000, 32, "sha256").toString("base64url");
  return `pbkdf2$210000$${salt}$${hash}`;
}

function authUserForSession(user) {
  return {
    username: String(user?.username || ""),
    tenantId: String(user?.tenantId || user?.tenant_id || DEFAULT_TENANT_ID),
    role: normalizeUserRole(user?.role, user?.username),
    displayName: String(user?.displayName || user?.username || ""),
  };
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!iterations || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return safeEqual(actual, expected);
}

function signSession(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmac(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function getSession(req) {
  if (!AUTH_REQUIRED) {
    return { username: "anonymous", role: "admin", displayName: "Dev Admin", user: { username: "anonymous", role: "admin", displayName: "Dev Admin" } };
  }
  const token = parseCookies(req.headers.cookie || "")[SESSION_COOKIE_NAME];
  if (!token) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature || !safeEqual(hmac(encodedPayload), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload.username || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    const configuredUser = getAuthUsers().find((user) => user.username === payload.username);
    const sessionUser = authUserForSession({ ...configuredUser, ...payload });
    return { ...payload, ...sessionUser, user: sessionUser };
  } catch (_) {
    return null;
  }
}

function requireAdmin(req, res) {
  const session = req.user || getSession(req);
  if (session?.role !== "admin") {
    sendJson(res, 403, { error: "Admin access required." });
    return false;
  }
  return true;
}

// Global admin OR firm administrator. A firm_admin manages users ONLY inside their own
// firm (tenantId) and sees data like any regular member of that firm — every global
// surface (health, budget groups, audit, usage) stays requireAdmin.
function requireUserManager(req, res) {
  const session = req.user || getSession(req);
  if (session?.role !== "admin" && session?.role !== "firm_admin") {
    sendJson(res, 403, { error: "Admin access required." });
    return false;
  }
  return true;
}

// Firm-based access: users who share a tenantId (same firm) see each other's records;
// users from a different firm are fully isolated. Rules:
//   • admin → everything (application administrator).
//   • record without owner → admin only (legacy records are assigned an owner by the
//     startup migration, so this only guards records created through unexpected paths —
//     the old behavior of "ownerless = visible to everyone" was a cross-firm leak).
//   • otherwise → visible when the record owner's firm matches the requester's firm.
let tenantLookupCache = null;
function userTenantId(username) {
  if (!username) return "";
  const now = Date.now();
  if (!tenantLookupCache || now - tenantLookupCache.at > 30000) {
    const map = {};
    try {
      for (const user of readUserStore().users) map[String(user.username)] = String(user.tenantId || DEFAULT_TENANT_ID);
    } catch (_) {}
    tenantLookupCache = { at: now, map };
  }
  // Unknown owner (user deleted): fall back to the default tenant so the firm that has
  // always operated the app keeps seeing its historical records.
  return tenantLookupCache.map[String(username)] || DEFAULT_TENANT_ID;
}

function canAccessOwner(req, ownerUsername) {
  const session = req.user || getSession(req);
  if (!session?.username) return false;
  if (session.role === "admin") return true;
  if (!ownerUsername) return false;
  if (ownerUsername === session.username) return true;
  return userTenantId(ownerUsername) === userTenantId(session.username);
}

function requireOwnerAccess(req, res, ownerUsername) {
  if (canAccessOwner(req, ownerUsername)) return true;
  sendJson(res, 403, { error: "Access denied." });
  return false;
}

function clientOwner(client) {
  return String(client?.ownerUsername || client?.createdBy || "");
}

function sessionOwner(session, db) {
  return String(session?.ownerUsername || session?.createdBy || clientOwner(db?.clients?.[session?.clientId]) || "");
}

function hmac(value) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(value).digest("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function ensureDatabase() {
  ensurePrivateDirectory(DATA_DIR);
  ensurePrivateDirectory(CLIENT_FILES_DIR);
  if (!fsSync.existsSync(DB_PATH)) writeDb({ clients: {}, sessions: {} });
  if (!fsSync.existsSync(CLIENTS_PATH)) writeJsonFile(CLIENTS_PATH, { clients: {} });
  if (!fsSync.existsSync(FIRM_LIBRARY_PATH)) writeJsonFile(FIRM_LIBRARY_PATH, { documents: [], globalInstructions: "" });
  if (!fsSync.existsSync(DEADLINES_PATH)) writeJsonFile(DEADLINES_PATH, { lastRebuilt: "", upcoming: [] });
  if (!fsSync.existsSync(AI_LEARNING_PATH)) writeJsonFile(AI_LEARNING_PATH, { globalCorrections: [], clientCorrections: {}, returnTypePatterns: {} });
  if (!fsSync.existsSync(FEEDBACK_PATH)) writeJsonFile(FEEDBACK_PATH, { entries: [] });
  if (!fsSync.existsSync(COST_LOG_PATH)) writeJsonFile(COST_LOG_PATH, { entries: [] });
  if (!fsSync.existsSync(AUDIT_LOG_PATH)) writeJsonFile(AUDIT_LOG_PATH, { entries: [] });
  if (!fsSync.existsSync(ACCESS_REQUESTS_PATH)) writeJsonFile(ACCESS_REQUESTS_PATH, { entries: [] });
  if (!fsSync.existsSync(INCIDENTS_PATH)) writeJsonFile(INCIDENTS_PATH, { entries: [] });
  migrateOwnerlessRecords();
}

// ---------------------------------------------------------------------------
// Health & incident tracking (zero-config): every boot and every crash-grade
// error is recorded to data/incidents.json and surfaced in the Admin panel.
// If ALERT_WEBHOOK_URL is ever set (Slack/Discord-compatible), alerts also POST
// there — optional capability, nothing to configure today.
// ---------------------------------------------------------------------------
const BOOTED_AT = Date.now();
function recordIncident(type, message, { alert = false } = {}) {
  try {
    const store = readJsonFile(INCIDENTS_PATH, { entries: [] });
    const entries = Array.isArray(store.entries) ? store.entries : [];
    entries.push({ id: crypto.randomUUID(), at: new Date().toISOString(), type: String(type), message: String(message || "").slice(0, 600) });
    writeJsonFile(INCIDENTS_PATH, { entries: entries.slice(-200) });
    if (alert && ALERT_WEBHOOK_URL) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      fetch(ALERT_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `[RAG Tax AI] ${type}: ${String(message || "").slice(0, 400)}` }),
        signal: controller.signal,
      }).catch(() => {}).finally(() => clearTimeout(timer));
    }
  } catch (_) { /* incident logging must never take the app down */ }
}

// Same exit behavior Node has by default (pm2 restarts us), but the crash is RECORDED first.
process.on("uncaughtException", (error) => {
  console.error("[FATAL] uncaughtException:", error);
  recordIncident("uncaughtException", error?.stack || error?.message || String(error), { alert: true });
  process.exit(1);
});
// Unlike Node's default (crash), an unhandled rejection is logged and the server stays up —
// visible in the Admin health card instead of taking production down.
process.on("unhandledRejection", (reason) => {
  console.warn("[WARN] unhandledRejection:", reason);
  recordIncident("unhandledRejection", reason?.stack || reason?.message || String(reason), { alert: true });
});

// Newest backup file age (backups live outside the repo; null when none found, e.g. local dev).
function newestBackupInfo() {
  try {
    const dir = String(process.env.RAGTAX_BACKUP_DIR || "/var/backups/ragtax");
    const files = fsSync.readdirSync(dir).filter((f) => /^ragtax-.*\.tar\.gz$/.test(f));
    if (!files.length) return null;
    let newest = null;
    for (const f of files) {
      const stat = fsSync.statSync(path.join(dir, f));
      if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { file: f, mtimeMs: stat.mtimeMs };
    }
    return { file: newest.file, ageHours: Math.round((Date.now() - newest.mtimeMs) / 36e5 * 10) / 10 };
  } catch (_) {
    return null;
  }
}

// One-time, idempotent ownership migration. Under firm-based access an ownerless record
// is admin-only, so every legacy record (created before ownership existed) is assigned to
// the primary admin. Their firm-mates keep seeing them (same tenant); other firms never
// see them. Runs once per process; writes only when something actually changed.
// The entry guard also breaks the cycle ensureDatabase → migrate → readDb → ensureDatabase.
// (A function property is used instead of a module-level let: ensureDatabase runs at module
// load, before top-level let declarations further down the file are initialized.)
function migrateOwnerlessRecords() {
  if (migrateOwnerlessRecords.done) return;
  migrateOwnerlessRecords.done = true;
  try {
    const users = readUserStore().users || [];
    const primaryAdmin = users.find((user) => user.role === "admin" && user.active !== false)?.username
      || users.find((user) => user.username === "augusto")?.username
      || "augusto";
    let dbChanges = 0;
    const db = readDb();
    for (const client of Object.values(db.clients || {})) {
      if (!client.ownerUsername && !client.createdBy) { client.ownerUsername = primaryAdmin; client.createdBy = primaryAdmin; dbChanges += 1; }
      if (!client.tenantId) { client.tenantId = DEFAULT_TENANT_ID; dbChanges += 1; }
    }
    for (const session of Object.values(db.sessions || {})) {
      if (!session.ownerUsername && !session.createdBy) { session.ownerUsername = primaryAdmin; session.createdBy = primaryAdmin; dbChanges += 1; }
      if (!session.tenantId) { session.tenantId = DEFAULT_TENANT_ID; dbChanges += 1; }
    }
    if (dbChanges) writeDb(db);
    let trackerChanges = 0;
    const tracker = readJsonFile(TRACKER_PATH, null);
    if (tracker && tracker.tasks) {
      for (const task of Object.values(tracker.tasks)) {
        if (!task.createdBy) { task.createdBy = primaryAdmin; trackerChanges += 1; }
      }
      if (trackerChanges) writeJsonFile(TRACKER_PATH, tracker);
    }
    if (dbChanges || trackerChanges) {
      console.log(`[migration] assigned ${dbChanges} db + ${trackerChanges} tracker ownerless records to '${primaryAdmin}'.`);
    }
  } catch (error) {
    console.warn("[migration] ownerless-record migration failed:", error?.message || error);
  }
}

function ensurePrivateDirectory(dirPath) {
  fsSync.mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE });
  try { fsSync.chmodSync(dirPath, PRIVATE_DIR_MODE); } catch (_) {}
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, "utf8"));
  } catch (_) {
    return structuredCloneSafe(fallback);
  }
}

function writeJsonFile(filePath, value) {
  ensurePrivateDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fsSync.writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  try { fsSync.chmodSync(tempPath, PRIVATE_FILE_MODE); } catch (_) {}
  fsSync.renameSync(tempPath, filePath);
  try { fsSync.chmodSync(filePath, PRIVATE_FILE_MODE); } catch (_) {}
  queueDatabaseSync(filePath, value);
}

function dataSnapshotKey(filePath) {
  const relative = path.relative(DATA_DIR, filePath).replace(/\\/g, "/");
  if (relative.startsWith("..") || path.isAbsolute(relative) || !relative.endsWith(".json")) return "";
  return relative;
}

function isDataJsonPath(filePath) {
  return Boolean(dataSnapshotKey(filePath));
}

function jsonParam(value) {
  return JSON.stringify(value ?? {});
}

function sqlTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sqlNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function initializeDatabasePersistence() {
  if (!DATABASE_PERSISTENCE_ENABLED) return;
  databasePool = createPool();
  try {
    await databasePool.query("select 1");
    databaseReady = true;
    await hydrateLocalDataFromDatabase();
    console.log("[Database] Supabase persistence enabled.");
  } catch (error) {
    databaseReady = false;
    console.warn("[Database] Supabase persistence disabled for this boot:", error.message);
  }
}

async function hydrateLocalDataFromDatabase() {
  if (!databaseReady || !databasePool) return;
  databaseHydrating = true;
  try {
    const snapshots = await databasePool.query("select snapshot_key, payload from rag_private.app_json_snapshots");
    for (const row of snapshots.rows || []) {
      const filePath = path.join(DATA_DIR, String(row.snapshot_key || ""));
      if (!isDataJsonPath(filePath)) continue;
      writeJsonFile(filePath, row.payload || {});
    }
    await hydrateUsersFromDatabase();
    await hydrateCostLogFromDatabase();
    await hydrateAuditLogFromDatabase();
    await hydrateAccessRequestsFromDatabase();
  } finally {
    databaseHydrating = false;
  }
}

async function hydrateUsersFromDatabase() {
  const result = await databasePool.query(
    `select username, password_hash, tenant_id, role, display_name, active, spend_limit_usd,
            created_at, updated_at, last_password_change_at
       from rag_private.app_users
      order by created_at nulls last, username`,
  );
  if (!result.rows.length) return;
  writeJsonFile(USERS_PATH, {
    users: result.rows.map((row) => ({
      username: row.username,
      passwordHash: row.password_hash,
      tenantId: row.tenant_id || DEFAULT_TENANT_ID,
      role: normalizeUserRole(row.role, row.username),
      displayName: row.display_name || row.username,
      active: row.active !== false,
      spendLimitUsd: row.spend_limit_usd === null ? null : Number(row.spend_limit_usd),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : "",
      lastPasswordChangeAt: row.last_password_change_at ? new Date(row.last_password_change_at).toISOString() : "",
    })),
  });
}

async function hydrateCostLogFromDatabase() {
  const result = await databasePool.query("select payload from rag_private.cost_log_entries order by source_index, id");
  if (!result.rows.length) return;
  writeJsonFile(COST_LOG_PATH, { entries: result.rows.map((row) => row.payload || {}) });
}

async function hydrateAuditLogFromDatabase() {
  const result = await databasePool.query("select payload from rag_private.audit_log_entries order by source_index, id");
  if (!result.rows.length) return;
  writeJsonFile(AUDIT_LOG_PATH, { entries: result.rows.map((row) => row.payload || {}) });
}

async function hydrateAccessRequestsFromDatabase() {
  const result = await databasePool.query("select payload from rag_private.access_requests order by source_index, created_at nulls last, imported_at");
  if (!result.rows.length) return;
  writeJsonFile(ACCESS_REQUESTS_PATH, { entries: result.rows.map((row) => row.payload || {}) });
}

function queueDatabaseSync(filePath, value) {
  if (!databaseReady || databaseHydrating || !databasePool || !isDataJsonPath(filePath)) return;
  const snapshotKey = dataSnapshotKey(filePath);
  const payload = structuredCloneSafe(value);
  databaseSyncQueue = databaseSyncQueue
    .then(() => syncJsonToDatabase(filePath, snapshotKey, payload))
    .catch((error) => {
      databaseSyncLastError = error.message || String(error);
      console.warn(`[Database] Sync failed for ${snapshotKey}:`, error.message);
    });
}

async function flushDatabaseSyncQueue(timeoutMs = 5000) {
  if (!databaseReady || !databasePool) return;
  let timeout;
  try {
    await Promise.race([
      databaseSyncQueue,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Database sync timeout.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function syncJsonToDatabase(filePath, snapshotKey, payload) {
  await databasePool.query(
    `insert into rag_private.app_json_snapshots (snapshot_key, payload, imported_at)
     values ($1, $2::jsonb, now())
     on conflict (snapshot_key) do update set payload = excluded.payload, imported_at = now()`,
    [snapshotKey, jsonParam(payload)],
  );
  if (filePath === USERS_PATH) await syncUsersToDatabase(payload);
  else if (filePath === COST_LOG_PATH) await syncCostLogToDatabase(payload);
  else if (filePath === AUDIT_LOG_PATH) await syncAuditLogToDatabase(payload);
  else if (filePath === ACCESS_REQUESTS_PATH) await syncAccessRequestsToDatabase(payload);
  else if (filePath === DB_PATH) await syncClientsToDatabase(payload);
  else if (filePath === GOOGLE_TOKEN_PATH) await syncOauthTokenStoreToDatabase("google", payload);
  else if (filePath === QBO_TOKEN_PATH) await syncOauthTokenStoreToDatabase("quickbooks", payload);
  else if (filePath === ACCOUNTING_TOKEN_PATH) await syncOauthTokenStoreToDatabase("accounting", payload);
}

async function syncUsersToDatabase(store) {
  await databasePool.query(
    `insert into rag_private.firms (tenant_id, name)
     values ($1, $2)
     on conflict (tenant_id) do update set name = excluded.name`,
    [DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME],
  );
  const users = Array.isArray(store?.users) ? store.users : [];
  const usernames = [];
  for (const user of users) {
    if (!user?.username || !user?.passwordHash) continue;
    const tenantId = String(user.tenantId || user.tenant_id || DEFAULT_TENANT_ID);
    usernames.push(String(user.username));
    await databasePool.query(
      `insert into rag_private.firms (tenant_id, name)
       values ($1, $2)
       on conflict (tenant_id) do nothing`,
      [tenantId, tenantId === DEFAULT_TENANT_ID ? DEFAULT_TENANT_NAME : tenantId],
    );
    await databasePool.query(
      `insert into rag_private.app_users
        (username, password_hash, tenant_id, role, display_name, active, spend_limit_usd, created_at, updated_at, last_password_change_at)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now()), coalesce($9::timestamptz, now()), $10::timestamptz)
       on conflict (username) do update set
        password_hash = excluded.password_hash,
        tenant_id = excluded.tenant_id,
        role = excluded.role,
        display_name = excluded.display_name,
        active = excluded.active,
        spend_limit_usd = excluded.spend_limit_usd,
        updated_at = now(),
        last_password_change_at = excluded.last_password_change_at`,
      [
        String(user.username),
        String(user.passwordHash),
        tenantId,
        normalizeUserRole(user.role, user.username),
        String(user.displayName || user.username),
        user.active !== false,
        user.spendLimitUsd === undefined ? null : sqlNumber(user.spendLimitUsd),
        sqlTimestamp(user.createdAt),
        sqlTimestamp(user.updatedAt),
        sqlTimestamp(user.lastPasswordChangeAt),
      ],
    );
    await databasePool.query(
      `insert into rag_private.user_firms (username, tenant_id, firm_role)
       values ($1, $2, $3)
       on conflict (username, tenant_id) do update set firm_role = excluded.firm_role`,
      [String(user.username), tenantId, user.role === "admin" ? "admin" : "member"],
    );
  }
  if (usernames.length) {
    await databasePool.query("delete from rag_private.app_users where not (username = any($1::text[]))", [usernames]);
  }
}

async function syncCostLogToDatabase(store) {
  const entries = Array.isArray(store?.entries) ? store.entries : [];
  const tenantsByUsername = userTenantMap();
  await databasePool.query("delete from rag_private.cost_log_entries");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] || {};
    const username = entry.username || entry.user || null;
    await databasePool.query(
      `insert into rag_private.cost_log_entries
        (source_index, username, tenant_id, action, model, input_tokens, output_tokens, total_cost_usd, occurred_at, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10::jsonb)`,
      [
        index,
        username,
        username ? tenantsByUsername.get(String(username)) || DEFAULT_TENANT_ID : DEFAULT_TENANT_ID,
        entry.action || null,
        entry.model || null,
        sqlNumber(entry.inputTokens ?? entry.input_tokens),
        sqlNumber(entry.outputTokens ?? entry.output_tokens),
        sqlNumber(entry.totalCostUsd ?? entry.total_cost_usd ?? entry.costUsd),
        sqlTimestamp(entry.createdAt || entry.timestamp || entry.occurredAt || entry.at),
        jsonParam(entry),
      ],
    );
  }
}

async function syncAuditLogToDatabase(store) {
  const entries = Array.isArray(store?.entries) ? store.entries : [];
  const tenantsByUsername = userTenantMap();
  await databasePool.query("delete from rag_private.audit_log_entries");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] || {};
    const username = entry.username || entry.user?.username || null;
    await databasePool.query(
      `insert into rag_private.audit_log_entries
        (source_index, username, tenant_id, action, occurred_at, payload)
       values ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)`,
      [
        index,
        username,
        username ? tenantsByUsername.get(String(username)) || DEFAULT_TENANT_ID : DEFAULT_TENANT_ID,
        entry.action || null,
        sqlTimestamp(entry.createdAt || entry.timestamp || entry.occurredAt || entry.at),
        jsonParam(entry),
      ],
    );
  }
}

async function syncAccessRequestsToDatabase(store) {
  const entries = Array.isArray(store?.entries) ? store.entries : [];
  await databasePool.query("delete from rag_private.access_requests");
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] || {};
    await databasePool.query(
      `insert into rag_private.access_requests
        (source_index, email, name, estimated_returns, created_at, payload)
       values ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)`,
      [
        index,
        entry.email || entry.contactEmail || null,
        entry.name || entry.contactName || entry.company || entry.firm || null,
        entry.estimatedReturns || entry.estimated_returns || entry.returns || null,
        sqlTimestamp(entry.createdAt || entry.timestamp || entry.at),
        jsonParam(entry),
      ],
    );
  }
}

async function syncClientsToDatabase(store) {
  const clients = store?.clients && typeof store.clients === "object" ? store.clients : {};
  await databasePool.query("delete from rag_private.clients");
  for (const [clientId, record] of Object.entries(clients)) {
    const tenantId = record?.tenantId || record?.tenant_id || DEFAULT_TENANT_ID;
    await databasePool.query(
      `insert into rag_private.firms (tenant_id, name)
       values ($1, $2)
       on conflict (tenant_id) do nothing`,
      [tenantId, tenantId === DEFAULT_TENANT_ID ? DEFAULT_TENANT_NAME : tenantId],
    );
    await databasePool.query(
      `insert into rag_private.clients (client_id, tenant_id, owner_username, display_name, payload)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (client_id) do update set
        tenant_id = excluded.tenant_id,
        owner_username = excluded.owner_username,
        display_name = excluded.display_name,
        payload = excluded.payload,
        updated_at = now()`,
      [
        clientId,
        tenantId,
        record?.ownerUsername || record?.createdBy || null,
        record?.name || record?.clientName || clientId,
        jsonParam(record),
      ],
    );
  }
}

async function syncOauthTokenStoreToDatabase(provider, store) {
  const users = store?.users && typeof store.users === "object" ? store.users : {};
  await databasePool.query("delete from rag_private.oauth_tokens where provider = $1", [provider]);
  for (const [username, payload] of Object.entries(users)) {
    await databasePool.query(
      `insert into rag_private.oauth_tokens (provider, username, account_key, encrypted_payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (provider, username, account_key) do update set
        encrypted_payload = excluded.encrypted_payload,
        updated_at = now()`,
      [provider, String(username), "default", jsonParam(payload)],
    );
  }
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function userTenantMap() {
  const store = readUserStore();
  const map = new Map();
  (Array.isArray(store.users) ? store.users : []).forEach((user) => {
    if (user?.username) map.set(String(user.username), String(user.tenantId || user.tenant_id || DEFAULT_TENANT_ID));
  });
  return map;
}

function tokenEncryptionKeyBytes(value) {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return decoded;
  } catch (_) {}
  return crypto.createHash("sha256").update(value).digest();
}

function encryptSecretObject(value) {
  if (!TOKEN_ENCRYPTION_KEY_BYTES || !value) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", TOKEN_ENCRYPTION_KEY_BYTES, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: true,
    alg: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    data: ciphertext.toString("base64url"),
  };
}

function decryptSecretObject(value) {
  if (!value || value.encrypted !== true) return value;
  if (!TOKEN_ENCRYPTION_KEY_BYTES) throw new Error("TOKEN_ENCRYPTION_KEY is required to read encrypted tokens.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", TOKEN_ENCRYPTION_KEY_BYTES, Buffer.from(value.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(value.data, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function encryptUserMap(map = {}) {
  const output = {};
  Object.entries(map || {}).forEach(([key, value]) => { output[key] = encryptSecretObject(value); });
  return output;
}

/**
 * Decrypts each stored account on its own, so one unreadable entry costs only that account.
 *
 * This used to decrypt the whole map in a single pass, and every caller wrapped it in a catch
 * that returned an empty store. So a single entry written under a different TOKEN_ENCRYPTION_KEY
 * — or written in plaintext, since encryptSecretObject silently skips encryption when the key is
 * absent while decryptSecretObject throws when it is — made EVERY user in the file look
 * disconnected, with nothing logged anywhere. The visible symptom was Google saying "connected"
 * in the popup and the app showing disconnected a second later, forever: the write succeeded,
 * the next read hit the old entry and threw, and the catch turned that into "no tokens".
 */
function decryptUserMap(map = {}) {
  const output = {};
  Object.entries(map || {}).forEach(([key, value]) => {
    try {
      output[key] = decryptSecretObject(value);
    } catch (error) {
      console.error(`[tokens] stored credentials for "${key}" could not be decrypted (${error.message}). `
        + `That account needs to reconnect; the rest of the file is unaffected.`
        + `${TOKEN_ENCRYPTION_KEY_BYTES ? "" : " TOKEN_ENCRYPTION_KEY is not set on this server, so encrypted entries written earlier cannot be read."}`);
    }
  });
  return output;
}

function readDb() {
  ensureDatabase();
  try {
    const db = JSON.parse(fsSync.readFileSync(DB_PATH, "utf8"));
    const clients = {};
    Object.entries(db.clients || {}).forEach(([id, client]) => { clients[id] = normalizeClientRecord(client); });
    return { clients, sessions: db.sessions || {} };
  } catch (_) {
    return { clients: {}, sessions: {} };
  }
}

function writeDb(db) {
  ensurePrivateDirectory(DATA_DIR);
  const tempPath = `${DB_PATH}.${process.pid}.tmp`;
  fsSync.writeFileSync(tempPath, JSON.stringify({ clients: db.clients || {}, sessions: db.sessions || {} }, null, 2), { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  try { fsSync.chmodSync(tempPath, PRIVATE_FILE_MODE); } catch (_) {}
  fsSync.renameSync(tempPath, DB_PATH);
  try { fsSync.chmodSync(DB_PATH, PRIVATE_FILE_MODE); } catch (_) {}
  writeJsonFile(CLIENTS_PATH, { clients: db.clients || {} });
}

function appendAuditLog(reqOrUser, action, details = {}) {
  try {
    const store = readJsonFile(AUDIT_LOG_PATH, { entries: [] });
    const entries = Array.isArray(store.entries) ? store.entries : [];
    const user = reqOrUser?.user || getSession(reqOrUser || {}) || {};
    entries.push({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      action: String(action || "unknown"),
      username: String(user.username || ""),
      role: String(user.role || ""),
      ip: reqOrUser?.headers ? clientIp(reqOrUser) : "",
      details: sanitizeAuditDetails(details),
    });
    writeJsonFile(AUDIT_LOG_PATH, { entries: entries.slice(-5000) });
  } catch (error) {
    console.warn("Could not write audit log:", error.message);
  }
}

function saveAccessRequest(request) {
  const store = readJsonFile(ACCESS_REQUESTS_PATH, { entries: [] });
  const entries = Array.isArray(store.entries) ? store.entries : [];
  entries.push(request);
  writeJsonFile(ACCESS_REQUESTS_PATH, { entries: entries.slice(-2000) });
}

function updateAccessRequestMailStatus(id, mailResult) {
  const store = readJsonFile(ACCESS_REQUESTS_PATH, { entries: [] });
  const entries = Array.isArray(store.entries) ? store.entries : [];
  const entry = entries.find((item) => item.id === id);
  if (!entry) return;
  entry.mailStatus = mailResult?.ok ? "sent" : "failed";
  entry.mailError = mailResult?.ok ? "" : String(mailResult?.error || "Notification not sent.").slice(0, 500);
  entry.mailUpdatedAt = new Date().toISOString();
  writeJsonFile(ACCESS_REQUESTS_PATH, { entries });
}

async function notifyAccessRequest(request) {
  const to = String(process.env.ACCESS_REQUEST_NOTIFY_EMAIL || "ramiroflores@ragtax-ia.com").trim();
  const from = smtpFromAddress();
  const subject = `New RAG Tax AI access request - ${request.contactName}`;
  const bodyText = [
    "A new access request was submitted from the RAG Tax AI login page.",
    "",
    `Name / firm: ${request.contactName}`,
    `Email: ${request.email}`,
    `Estimated annual filed returns: ${request.annualReturns.toLocaleString("en-US")}`,
    `Submitted at: ${request.createdAt}`,
    `IP: ${request.ip || "unknown"}`,
    "",
    "Follow up with a proposal based on their estimated return volume.",
  ].join("\n");
  if (!smtpConfigured()) return { ok: false, error: "SMTP is not configured. Lead was saved locally." };
  await sendSmtpMail({ from, to, subject, bodyText });
  return { ok: true };
}

function smtpFromAddress() {
  return String(process.env.ACCESS_REQUEST_FROM_EMAIL || process.env.SMTP_FROM || process.env.ACCESS_REQUEST_SMTP_USER || "no-reply@ragtax-ia.com").trim();
}

function smtpConfigured() {
  return Boolean(String(process.env.ACCESS_REQUEST_SMTP_HOST || "").trim());
}

function adminTwoFactorTarget(user) {
  return String(user?.email || ADMIN_2FA_EMAIL || "").trim();
}

function hashTwoFactorCode(code) {
  return hmac(`admin-2fa:${code}`);
}

async function startAdminTwoFactorChallenge(req, user) {
  if (!smtpConfigured()) {
    appendAuditLog(req, "auth.admin_2fa_delivery_missing", { username: user.username, reason: "smtp_not_configured" });
    return { ok: false, error: "Admin two-factor authentication is enabled, but SMTP is not configured." };
  }
  const to = adminTwoFactorTarget(user);
  if (!to) {
    appendAuditLog(req, "auth.admin_2fa_delivery_missing", { username: user.username, reason: "email_not_configured" });
    return { ok: false, error: "Admin two-factor authentication is enabled, but no admin security email is configured." };
  }
  const challengeId = crypto.randomUUID();
  const code = String(crypto.randomInt(100000, 1000000));
  adminTwoFactorChallenges.set(challengeId, {
    username: user.username,
    codeHash: hashTwoFactorCode(code),
    expiresAt: Date.now() + ADMIN_2FA_CODE_TTL_MS,
    attempts: 0,
  });
  await sendSmtpMail({
    from: smtpFromAddress(),
    to,
    subject: "RAG Tax AI admin verification code",
    bodyText: [
      `Your RAG Tax AI admin verification code is: ${code}`,
      "",
      `This code expires in ${Math.max(1, Math.round(ADMIN_2FA_CODE_TTL_MS / 60000))} minutes.`,
      "If you did not request this login, change the admin password and review the audit log.",
    ].join("\n"),
  });
  appendAuditLog(req, "auth.admin_2fa_sent", { username: user.username, to });
  return { ok: true, challengeId };
}

function verifyAdminTwoFactorChallenge(req, user, challengeId, code) {
  const challenge = adminTwoFactorChallenges.get(challengeId);
  if (!challenge || challenge.username !== user.username) {
    appendAuditLog(req, "auth.admin_2fa_failed", { username: user.username, reason: "missing_challenge" });
    return { ok: false, error: "Verification code expired. Please sign in again." };
  }
  if (Date.now() > challenge.expiresAt) {
    adminTwoFactorChallenges.delete(challengeId);
    appendAuditLog(req, "auth.admin_2fa_failed", { username: user.username, reason: "expired" });
    return { ok: false, error: "Verification code expired. Please sign in again." };
  }
  challenge.attempts += 1;
  if (challenge.attempts > ADMIN_2FA_MAX_ATTEMPTS) {
    adminTwoFactorChallenges.delete(challengeId);
    appendAuditLog(req, "auth.admin_2fa_failed", { username: user.username, reason: "too_many_attempts" });
    return { ok: false, error: "Too many verification attempts. Please sign in again." };
  }
  if (!safeEqual(hashTwoFactorCode(String(code || "").trim()), challenge.codeHash)) {
    appendAuditLog(req, "auth.admin_2fa_failed", { username: user.username, reason: "invalid_code" });
    return { ok: false, error: "Invalid verification code." };
  }
  adminTwoFactorChallenges.delete(challengeId);
  appendAuditLog(req, "auth.admin_2fa_success", { username: user.username });
  return { ok: true };
}

async function sendSmtpMail({ from, to, subject, bodyText }) {
  const host = String(process.env.ACCESS_REQUEST_SMTP_HOST || "").trim();
  const port = Number(process.env.ACCESS_REQUEST_SMTP_PORT || 587);
  const secure = String(process.env.ACCESS_REQUEST_SMTP_SECURE || "false").toLowerCase() === "true" || port === 465;
  const user = String(process.env.ACCESS_REQUEST_SMTP_USER || "").trim();
  const pass = String(process.env.ACCESS_REQUEST_SMTP_PASS || "");
  const state = { socket: await openSmtpSocket(host, port, secure), buffer: "" };
  try {
    await smtpRead(state);
    await smtpCommand(state, `EHLO ${smtpHostname()}`, [250]);
    if (!secure && String(process.env.ACCESS_REQUEST_SMTP_STARTTLS || "true").toLowerCase() !== "false") {
      await smtpCommand(state, "STARTTLS", [220]);
      state.socket = tls.connect({ socket: state.socket, servername: host });
      state.buffer = "";
      await new Promise((resolve, reject) => {
        state.socket.once("secureConnect", resolve);
        state.socket.once("error", reject);
      });
      await smtpCommand(state, `EHLO ${smtpHostname()}`, [250]);
    }
    if (user && pass) {
      await smtpCommand(state, "AUTH LOGIN", [334]);
      await smtpCommand(state, Buffer.from(user, "utf8").toString("base64"), [334]);
      await smtpCommand(state, Buffer.from(pass, "utf8").toString("base64"), [235]);
    }
    await smtpCommand(state, `MAIL FROM:<${from}>`, [250]);
    await smtpCommand(state, `RCPT TO:<${to}>`, [250, 251]);
    await smtpCommand(state, "DATA", [354]);
    state.socket.write(`${buildSimpleEmailMessage({ from, to, subject, bodyText })}\r\n.\r\n`);
    await smtpRead(state, [250]);
    await smtpCommand(state, "QUIT", [221]).catch(() => {});
  } finally {
    state.socket.end();
  }
}

function openSmtpSocket(host, port, secure) {
  return new Promise((resolve, reject) => {
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    socket.setTimeout(Number(process.env.ACCESS_REQUEST_SMTP_TIMEOUT_MS || 15000));
    socket.once(secure ? "secureConnect" : "connect", () => resolve(socket));
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("SMTP connection timed out."));
    });
    socket.once("error", reject);
  });
}

async function smtpCommand(state, command, expectedCodes) {
  state.socket.write(`${command}\r\n`);
  return smtpRead(state, expectedCodes);
}

function smtpRead(state, expectedCodes = [220]) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      state.buffer += chunk.toString("utf8");
      const lines = state.buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      state.buffer = "";
      cleanup();
      if (!expectedCodes.includes(code)) reject(new Error(`SMTP command failed: ${last}`));
      else resolve(lines.join("\n"));
    };
    const cleanup = () => {
      state.socket.off("data", onData);
      state.socket.off("error", onError);
    };
    state.socket.on("data", onData);
    state.socket.once("error", onError);
  });
}

function buildSimpleEmailMessage({ from, to, subject, bodyText }) {
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(bodyText || "", "utf8").toString("base64")),
  ].join("\r\n");
}

function smtpHostname() {
  return String(process.env.ACCESS_REQUEST_SMTP_HELO || "ragtax-ia.com").replace(/[^a-zA-Z0-9.-]/g, "") || "ragtax-ia.com";
}

function readAuditEntries(limit = 200) {
  const store = readJsonFile(AUDIT_LOG_PATH, { entries: [] });
  return (Array.isArray(store.entries) ? store.entries : []).slice(-limit).reverse();
}

function sanitizeAuditDetails(details = {}) {
  return redactSensitiveValue(details, 0);
}

function redactSensitiveValue(value, depth = 0, key = "") {
  const redactedKeys = /token|secret|password|authorization|api[_-]?key|content|base64|ssn|ein|taxpayer|social|refresh|access/i;
  if (redactedKeys.test(String(key || ""))) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSensitiveString(value).slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 3) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactSensitiveValue(item, depth + 1));
  if (typeof value === "object") {
    const output = {};
    Object.entries(value).slice(0, 40).forEach(([childKey, childValue]) => {
      output[childKey] = redactSensitiveValue(childValue, depth + 1, childKey);
    });
    return output;
  }
  return String(value).slice(0, 200);
}

function redactSensitiveString(value) {
  return String(value || "")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
    .replace(/\b\d{2}-\d{7}\b/g, "[redacted-ein]")
    .replace(/\b\d{9}\b/g, "[redacted-id]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9._-]{12,}/g, "[redacted-key]");
}

function clientIp(req) {
  return String(req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function isRateLimited(req, bucket, maxRequests, windowMs) {
  const now = Date.now();
  const key = `${bucket}:${clientIp(req) || "unknown"}`;
  const current = rateLimitBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > maxRequests;
}

function isUserRateLimited(req, bucket, maxRequests, windowMs) {
  const session = req.user || getSession(req) || {};
  const username = session.username || "anonymous";
  return isRateLimited(req, `${bucket}:user:${username}`, maxRequests, windowMs);
}

function requireFineGrainedRateLimit(req, res, requestUrl) {
  const session = req.user || getSession(req) || {};
  const pathName = requestUrl.pathname;
  if (session.role === "admin" && pathName.startsWith("/api/admin")) {
    const isWrite = req.method !== "GET";
    const limited = isUserRateLimited(
      req,
      isWrite ? "admin-write" : "admin-read",
      isWrite ? ADMIN_WRITE_RATE_LIMIT_MAX : ADMIN_READ_RATE_LIMIT_MAX,
      isWrite ? ADMIN_WRITE_RATE_LIMIT_WINDOW_MS : ADMIN_READ_RATE_LIMIT_WINDOW_MS,
    );
    if (limited) {
      appendAuditLog(req, "admin.rate_limited", { path: pathName, method: req.method });
      sendJson(res, 429, { error: "Too many administrator actions. Please wait a moment and try again." });
      return false;
    }
  }

  if (isTokenConsumingRoute(req, requestUrl)) {
    if (isUserRateLimited(req, "ai-action", USER_AI_RATE_LIMIT_MAX, USER_AI_RATE_LIMIT_WINDOW_MS)) {
      appendAuditLog(req, "ai.rate_limited", { path: pathName, method: req.method });
      sendJson(res, 429, { error: "Too many AI actions in a short period. Please wait a few minutes and try again." });
      return false;
    }
  }

  if (isUploadRoute(req, requestUrl)) {
    if (isUserRateLimited(req, "upload", USER_UPLOAD_RATE_LIMIT_MAX, USER_UPLOAD_RATE_LIMIT_WINDOW_MS)) {
      appendAuditLog(req, "upload.rate_limited", { path: pathName, method: req.method });
      sendJson(res, 429, { error: "Too many uploads in a short period. Please wait a few minutes and try again." });
      return false;
    }
  }

  return true;
}

function isUploadRoute(req, requestUrl) {
  if (req.method !== "POST") return false;
  return requestUrl.pathname === "/api/context/upload"
    || requestUrl.pathname.includes("upload")
    || requestUrl.pathname.includes("document")
    || requestUrl.pathname.includes("drive-sync");
}

function pickClientFields(payload = {}) {
  return {
    name: String(payload.name || payload.clientName || "").trim(),
    ein: String(payload.ein || "").trim(),
    email: String(payload.email || "").trim(),
    company: String(payload.company || "").trim(),
    driveFolderId: String(payload.driveFolderId || "").trim(),
    driveFolderName: String(payload.driveFolderName || "").trim(),
    entityType: String(payload.entityType || "").trim(),
    returnType: String(payload.returnType || "").trim(),
    qboRealmId: String(payload.qboRealmId || "").trim(),
    qboCompanyName: String(payload.qboCompanyName || "").trim(),
    qboLinkedAt: String(payload.qboLinkedAt || "").trim(),
    accountingConnections: payload.accountingConnections && typeof payload.accountingConnections === "object" ? payload.accountingConnections : {},
    autoSyncDrive: Boolean(payload.autoSyncDrive),
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
    fiscalYearEnd: String(payload.fiscalYearEnd || "").trim(),
  };
}

function getOrCreateClient(db, payload = {}) {
  if (payload.clientId && db.clients[payload.clientId]) return db.clients[payload.clientId];
  const clientFields = pickClientFields(payload);
  const existing = Object.values(db.clients).find((client) => client.name.toLowerCase() === clientFields.name.toLowerCase() && clientFields.name);
  if (existing) return existing;
  const now = new Date().toISOString();
  const client = normalizeClientRecord({ id: crypto.randomUUID(), tenantId: DEFAULT_TENANT_ID, ...clientFields, name: clientFields.name || "Unnamed client", createdAt: now, updatedAt: now });
  db.clients[client.id] = client;
  return client;
}

function normalizeClientRecord(client = {}) {
  return {
    ...client,
    tenantId: String(client.tenantId || client.tenant_id || DEFAULT_TENANT_ID),
    taxSoftware: normalizeTaxSoftware(client.taxSoftware),
    permanentInstructions: Array.isArray(client.permanentInstructions) ? client.permanentInstructions : [],
    relatedParties: Array.isArray(client.relatedParties) ? client.relatedParties : [],
    auditHistory: Array.isArray(client.auditHistory) ? client.auditHistory : [],
    communicationLog: Array.isArray(client.communicationLog) ? client.communicationLog : [],
    documents: Array.isArray(client.documents) ? client.documents : [],
    reviewHistory: Array.isArray(client.reviewHistory) ? client.reviewHistory : [],
    accountingConnections: client.accountingConnections && typeof client.accountingConnections === "object" ? client.accountingConnections : {},
    deadlines: client.deadlines && typeof client.deadlines === "object" ? client.deadlines : {},
    tags: Array.isArray(client.tags) ? client.tags : [],
    templateId: client.templateId || null,
  };
}

function normalizeTaxSoftware(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    primary: String(source.primary || "").trim(),
    version: String(source.version || "").trim(),
    customNotes: String(source.customNotes || "").trim(),
  };
}

function normalizeSession(payload = {}) {
  const now = new Date().toISOString();
  const session = {
    id: String(payload.id || crypto.randomUUID()),
    tenantId: String(payload.tenantId || payload.tenant_id || DEFAULT_TENANT_ID),
    clientId: String(payload.clientId || ""),
    ownerUsername: String(payload.ownerUsername || payload.createdBy || ""),
    createdBy: String(payload.createdBy || payload.ownerUsername || ""),
    taxYear: String(payload.taxYear || ""),
    returnType: String(payload.returnType || ""),
    reviewStage: String(payload.reviewStage || "Initial review"),
    createdAt: payload.createdAt || now,
    updatedAt: payload.updatedAt || now,
    reviewResult: payload.reviewResult || null,
    preparationResult: payload.preparationResult || null,
    noticeResult: payload.noticeResult || null,
    organizerResult: payload.organizerResult || null,
    diagnosticsResult: payload.diagnosticsResult || null,
    diagnosticsRunAt: payload.diagnosticsRunAt || null,
    deliverableResult: payload.deliverableResult || null,
    status: normalizeSessionStatus(payload.status || "in_progress"),
    issues: payload.issues || { high: 0, medium: 0, low: 0, resolved: 0 },
    notes: String(payload.notes || ""),
  };
  session.issues = countSessionIssues(session);
  return session;
}

function normalizeSessionUpdate(payload = {}) {
  const update = {};
  ["taxYear", "returnType", "reviewStage", "notes"].forEach((key) => { if (key in payload) update[key] = String(payload[key] || ""); });
  ["reviewResult", "preparationResult", "noticeResult", "organizerResult", "diagnosticsResult", "diagnosticsRunAt", "deliverableResult"].forEach((key) => { if (key in payload) update[key] = payload[key] || null; });
  if ("status" in payload) update.status = normalizeSessionStatus(payload.status);
  return update;
}

function appendClientDeliverableRecord(client, session, record = {}) {
  const year = String(record.taxYear || session.taxYear || "unknown").trim() || "unknown";
  client.taxYears = client.taxYears && typeof client.taxYears === "object" ? client.taxYears : {};
  client.taxYears[year] = client.taxYears[year] && typeof client.taxYears[year] === "object" ? client.taxYears[year] : {};
  client.taxYears[year].deliverables = Array.isArray(client.taxYears[year].deliverables) ? client.taxYears[year].deliverables : [];
  client.taxYears[year].deliverables.push({
    sentAt: record.sentAt || new Date().toISOString(),
    to: String(record.to || ""),
    subject: String(record.subject || ""),
    attachmentNames: Array.isArray(record.attachmentNames) ? record.attachmentNames.map(String) : [],
    gmailMessageId: String(record.messageId || record.gmailMessageId || ""),
  });
}

function normalizeSessionStatus(status) {
  const value = String(status || "").toLowerCase();
  return ["in_progress", "review_complete", "delivered", "filed", "archived"].includes(value) ? value : "in_progress";
}

function countSessionIssues(session) {
  const issues = session.reviewResult?.structured?.issues || session.reviewResult?.issues || [];
  const issueResponses = session.reviewResult?.issueResponses || {};
  const resolvedFromResponses = Object.values(issueResponses).filter((response) => response && response.status === "resolved").length;
  const counts = { high: 0, medium: 0, low: 0, resolved: Math.max(Array.isArray(session.resolvedIssues) ? session.resolvedIssues.length : 0, resolvedFromResponses) };
  if (Array.isArray(issues)) {
    issues.forEach((issue, index) => {
      if (issueResponses[index]?.status === "resolved") return;
      const priority = String(issue.priority || issue.severity || "").toLowerCase();
      if (priority.includes("high")) counts.high += 1;
      else if (priority.includes("medium")) counts.medium += 1;
      else if (priority.includes("low")) counts.low += 1;
    });
  }
  return counts;
}

function listSessionsWithClients(db) {
  return Object.values(db.sessions).map((session) => ({ ...session, client: db.clients[session.clientId] || null })).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function parseCookies(cookieHeader) {
  const cookies = {};
  cookieHeader.split(";").forEach((part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey) return;
    cookies[rawKey] = decodeURIComponent(rawValue.join("="));
  });
  return cookies;
}

function buildSessionCookie(token) {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    COOKIE_SECURE ? "Secure" : "",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ].filter(Boolean).join("; ");
}

function clearSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    COOKIE_SECURE ? "Secure" : "",
    "Max-Age=0",
  ].filter(Boolean).join("; ");
}

function isGoogleDriveEnabled() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function googleTokenHasScope(tokens, scope) {
  const grantedScopes = String(tokens?.scope || "").split(/\s+/).filter(Boolean);
  return grantedScopes.includes(scope);
}

function normalizeGoogleTokens(tokenData = {}, username = "default") {
  const existing = readGoogleTokens(username) || {};
  return {
    access_token: tokenData.access_token || existing.access_token || "",
    refresh_token: tokenData.refresh_token || existing.refresh_token || "",
    token_type: tokenData.token_type || existing.token_type || "Bearer",
    // Whatever Google actually granted, or what was granted before on a refresh — never the
    // set we asked for. Falling back to GOOGLE_OAUTH_SCOPE meant a token that had only Drive
    // recorded itself as also holding gmail.compose, so the app believed it could create a
    // draft and only found out from a 403 at send time, with nothing pointing at the cause.
    scope: tokenData.scope || existing.scope || "",
    expiry_date: Date.now() + (Number(tokenData.expires_in || 3600) * 1000) - 60000,
  };
}

function readGoogleTokenStore() {
  try {
    if (!fsSync.existsSync(GOOGLE_TOKEN_PATH)) return { users: {} };
    const parsed = JSON.parse(fsSync.readFileSync(GOOGLE_TOKEN_PATH, "utf8"));
    if (parsed.users && typeof parsed.users === "object") return { users: decryptUserMap(parsed.users) };
    return { users: { default: parsed } };
  } catch (error) {
    // "Could not read the file" and "nobody ever connected" are the same empty object to
    // every caller, so the difference has to survive in the log or it is lost for good.
    console.error(`[tokens] ${GOOGLE_TOKEN_PATH} could not be read (${error.message}). Every Google connection will appear disconnected until this is resolved.`);
    return { users: {} };
  }
}

function readGoogleTokens(username = "default") {
  const store = readGoogleTokenStore();
  return store.users[String(username || "default")] || null;
}

function writeGoogleTokens(username, tokens) {
  const store = readGoogleTokenStore();
  store.users[String(username || "default")] = tokens;
  writeJsonFile(GOOGLE_TOKEN_PATH, { users: encryptUserMap(store.users || {}) });
}

function deleteGoogleTokens(username) {
  const store = readGoogleTokenStore();
  delete store.users[String(username || "default")];
  writeJsonFile(GOOGLE_TOKEN_PATH, { users: encryptUserMap(store.users || {}) });
}

function isQboEnabled() {
  return Boolean(QBO_CLIENT_ID && QBO_CLIENT_SECRET);
}

function readQboStore() {
  try {
    if (!fsSync.existsSync(QBO_TOKEN_PATH)) return { users: {} };
    const parsed = JSON.parse(fsSync.readFileSync(QBO_TOKEN_PATH, "utf8"));
    return { users: decryptUserMap(parsed.users || {}) };
  } catch (error) {
    // "Could not read the file" and "nobody ever connected" are the same empty object to
    // every caller, so the difference has to survive in the log or it is lost for good.
    console.error(`[tokens] ${QBO_TOKEN_PATH} could not be read (${error.message}). Every QuickBooks connection will appear disconnected until this is resolved.`);
    return { users: {} };
  }
}

function writeQboStore(store) {
  writeJsonFile(QBO_TOKEN_PATH, { users: encryptUserMap(store.users || {}) });
}

function getQboUserStore(username) {
  const store = readQboStore();
  return store.users[username] || { companies: {} };
}

function writeQboTokenRecord(username, realmId, tokens) {
  const store = readQboStore();
  const userStore = store.users[username] || { companies: {} };
  userStore.companies = userStore.companies || {};
  userStore.companies[realmId] = { ...(userStore.companies[realmId] || {}), realmId, tokens };
  store.users[username] = userStore;
  writeQboStore(store);
}

function updateQboCompany(username, realmId, info) {
  const store = readQboStore();
  const userStore = store.users[username] || { companies: {} };
  userStore.companies = userStore.companies || {};
  userStore.companies[realmId] = { ...(userStore.companies[realmId] || {}), ...info, realmId };
  store.users[username] = userStore;
  writeQboStore(store);
}

function deleteQboUser(username) {
  const store = readQboStore();
  delete store.users[username];
  writeQboStore(store);
}

function normalizeQboTokens(tokens = {}, realmId = "") {
  return {
    realmId,
    access_token: tokens.access_token || "",
    refresh_token: tokens.refresh_token || "",
    token_type: tokens.token_type || "Bearer",
    expires_at: Date.now() + (Number(tokens.expires_in || 3600) * 1000) - 60000,
    x_refresh_token_expires_in: tokens.x_refresh_token_expires_in || "",
  };
}

async function getQboTokens(username, realmId) {
  const company = getQboUserStore(username).companies?.[realmId];
  if (!company?.tokens) throw Object.assign(new Error("QuickBooks is not connected for this company."), { statusCode: 401, expose: true });
  let tokens = company.tokens;
  if (tokens.access_token && Number(tokens.expires_at || 0) > Date.now()) return tokens;
  if (!tokens.refresh_token) throw Object.assign(new Error("QuickBooks refresh token is missing. Reconnect QBO."), { statusCode: 401, expose: true });
  const refresh = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`).toString("base64")}`,
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
  });
  const data = await refresh.json().catch(() => ({}));
  if (!refresh.ok) throw Object.assign(new Error(data.error_description || data.error || "Could not refresh QuickBooks token."), { statusCode: 401, expose: true });
  tokens = normalizeQboTokens(data, realmId);
  writeQboTokenRecord(username, realmId, tokens);
  return tokens;
}

function getQboBaseUrl(realmId) {
  return QBO_ENVIRONMENT === "production"
    ? `https://quickbooks.api.intuit.com/v3/company/${realmId}`
    : `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}`;
}

async function qboRequest(username, realmId, pathName, params = {}) {
  const tokens = await getQboTokens(username, realmId);
  const query = new URLSearchParams({ minorversion: "70", ...params }).toString();
  const response = await fetch(`${getQboBaseUrl(realmId)}${pathName}?${query}`, {
    headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
  });
  if (!response.ok) {
    const text = await response.text();
    throw Object.assign(new Error(`QBO API error ${response.status}: ${text}`), { statusCode: response.status, expose: true });
  }
  return response.json();
}

function qboCompaniesForUser(username) {
  const companies = getQboUserStore(username).companies || {};
  return Object.values(companies).map((company) => ({
    realmId: company.realmId,
    companyName: company.companyName || company.realmId,
    lastSync: company.lastSync || "",
  }));
}

function availableQboReports() {
  return [
    { id: "ProfitAndLoss", name: "Profit & Loss", category: "income", supportsComparative: true, dateRange: true },
    { id: "ProfitAndLossDetail", name: "Profit & Loss Detail", category: "income", supportsComparative: false, dateRange: true },
    { id: "BalanceSheet", name: "Balance Sheet", category: "balance", supportsComparative: true, dateRange: false, asOfDate: true },
    { id: "BalanceSheetDetail", name: "Balance Sheet Detail", category: "balance", supportsComparative: false, dateRange: false, asOfDate: true },
    { id: "TrialBalance", name: "Trial Balance", category: "balance", supportsComparative: false, dateRange: true },
    { id: "GeneralLedger", name: "General Ledger", category: "detail", supportsComparative: false, dateRange: true },
    { id: "TransactionList", name: "Transaction List", category: "detail", supportsComparative: false, dateRange: true },
    { id: "CashFlow", name: "Statement of Cash Flows", category: "income", supportsComparative: false, dateRange: true },
    { id: "AccountList", name: "Chart of Accounts", category: "setup", supportsComparative: false, dateRange: false },
    { id: "VendorBalance", name: "Vendor Balance Summary", category: "balance", supportsComparative: false, dateRange: false, asOfDate: true },
    { id: "CustomerBalance", name: "Customer Balance Summary", category: "balance", supportsComparative: false, dateRange: false, asOfDate: true },
    { id: "AgedReceivables", name: "Accounts Receivable Aging", category: "balance", supportsComparative: false, dateRange: false, asOfDate: true },
    { id: "AgedPayables", name: "Accounts Payable Aging", category: "balance", supportsComparative: false, dateRange: false, asOfDate: true },
    { id: "InventoryValuationSummary", name: "Inventory Valuation Summary", category: "balance", supportsComparative: false, dateRange: false, asOfDate: true },
    { id: "PayrollSummary", name: "Payroll Summary", category: "payroll", supportsComparative: false, dateRange: true },
    { id: "EmployeeDetails", name: "Employee Details", category: "payroll", supportsComparative: false, dateRange: false },
    { id: "TaxSummary", name: "Sales Tax Liability", category: "tax", supportsComparative: false, dateRange: true },
    { id: "ExpensesByVendorSummary", name: "Expenses by Vendor Summary", category: "income", supportsComparative: false, dateRange: true },
    { id: "IncomeByCustomerSummary", name: "Income by Customer Summary", category: "income", supportsComparative: false, dateRange: true },
    { id: "ClassSummary", name: "Profit & Loss by Class", category: "income", supportsComparative: false, dateRange: true },
    { id: "DepartmentSummary", name: "Profit & Loss by Location", category: "income", supportsComparative: false, dateRange: true },
  ];
}

function parseQboReport(report) {
  const header = report.Header || {};
  const columns = report.Columns?.Column || [];
  const rows = parseQboRows(report.Rows?.Row || [], 0);
  return {
    reportName: header.ReportName || "QuickBooks Report",
    reportBasis: header.ReportBasis || "",
    startDate: header.StartPeriod || "",
    endDate: header.EndPeriod || header.Time || "",
    columns: columns.map((column) => ({ ColTitle: column.ColTitle || "", ColType: column.ColType || "" })),
    rows,
    rawJson: report,
  };
}

function parseQboRows(rows = [], indent = 0) {
  const flattened = [];
  rows.forEach((row) => {
    if (row.type === "Section") {
      const headerData = row.Header?.ColData || [];
      if (headerData.length) flattened.push(qboRowObject("Section", indent, headerData));
      flattened.push(...parseQboRows(row.Rows?.Row || [], indent + 1));
      const summaryData = row.Summary?.ColData || [];
      if (summaryData.length) flattened.push(qboRowObject("Summary", indent, summaryData));
    } else {
      const colData = row.ColData || [];
      if (colData.length) flattened.push(qboRowObject(row.type || "DataRow", indent, colData));
    }
  });
  return flattened;
}

function qboRowObject(type, indent, colData) {
  return {
    type,
    indent,
    label: colData[0]?.value || "",
    values: colData.slice(1).map((item) => item.value || ""),
  };
}

function qboReportToCsv(parsed) {
  const lines = [];
  lines.push(csvLine([`${parsed.reportName} | ${[parsed.startDate, parsed.endDate].filter(Boolean).join(" - ")}`]));
  lines.push(csvLine([`${parsed.reportBasis || "Accrual"} Basis`]));
  lines.push("");
  const headings = parsed.columns.map((column) => column.ColTitle || "");
  lines.push(csvLine(headings.length ? headings : ["Account", "Amount"]));
  parsed.rows.forEach((row) => {
    lines.push(csvLine([`${"  ".repeat(row.indent)}${row.label}`, ...row.values]));
  });
  lines.push("");
  return lines.join("\n");
}

function csvLine(values) {
  return values.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",");
}

// QBO point-in-time reports whose as-of date is the `report_date` param (not `end_date`).
// Sending `end_date` to these, or `report_date` to the Balance Sheet family, can make QBO
// return an empty report — so each family must get exactly its own param.
const QBO_REPORT_DATE_REPORTS = new Set(["AgedReceivables", "AgedPayables", "CustomerBalance", "VendorBalance"]);

async function fetchQboReport(username, realmId, reportSpec = {}) {
  const reportId = String(reportSpec.reportId || "");
  if (!reportId) throw new Error("Missing QBO report id.");
  const params = {};
  if (reportSpec.startDate) params.start_date = reportSpec.startDate;
  if (reportSpec.endDate) params.end_date = reportSpec.endDate;
  // QBO's Reports API has NO `as_of_date` parameter. Point-in-time reports use the
  // as-of date under DIFFERENT param names depending on the report family, and sending
  // the WRONG param can make QBO return an empty report (it does not always ignore it):
  //   - Balance Sheet / Inventory Valuation -> `end_date`
  //   - A/R & A/P aging, Customer/Vendor balance -> `report_date`
  if (reportSpec.asOfDate) {
    if (QBO_REPORT_DATE_REPORTS.has(reportId)) {
      params.report_date = reportSpec.asOfDate;
    } else {
      // Balance Sheet and similar point-in-time reports: QBO requires BOTH start_date and
      // end_date — without start_date it ignores end_date and defaults to the current period.
      if (!params.end_date) params.end_date = reportSpec.asOfDate;
      if (!params.start_date) params.start_date = `${reportSpec.asOfDate.slice(0, 4)}-01-01`;
    }
  }
  if (reportSpec.comparative) params.summarize_column_by = "Year";
  if (reportSpec.summarizeColumnsBy) params.summarize_column_by = reportSpec.summarizeColumnsBy;
  if (reportSpec.accountingMethod) params.accounting_method = reportSpec.accountingMethod;
  const raw = await qboRequest(username, realmId, `/reports/${reportId}`, params);
  const parsed = parseQboReport(raw);
  return {
    reportId,
    reportName: parsed.reportName,
    startDate: parsed.startDate || reportSpec.startDate || "",
    endDate: parsed.endDate || reportSpec.endDate || reportSpec.asOfDate || "",
    csvContent: qboReportToCsv(parsed),
    rowCount: parsed.rows.length,
    fetchedAt: new Date().toISOString(),
  };
}

function readAccountingStore() {
  try {
    if (!fsSync.existsSync(ACCOUNTING_TOKEN_PATH)) return { users: {} };
    const parsed = JSON.parse(fsSync.readFileSync(ACCOUNTING_TOKEN_PATH, "utf8"));
    return { users: decryptUserMap(parsed.users || {}) };
  } catch (error) {
    // "Could not read the file" and "nobody ever connected" are the same empty object to
    // every caller, so the difference has to survive in the log or it is lost for good.
    console.error(`[tokens] ${ACCOUNTING_TOKEN_PATH} could not be read (${error.message}). Every accounting-software connection will appear disconnected until this is resolved.`);
    return { users: {} };
  }
}

function writeAccountingStore(store) {
  writeJsonFile(ACCOUNTING_TOKEN_PATH, { users: encryptUserMap(store.users || {}) });
}

function accountingStoreKey(username, softwareId) {
  return `${softwareId}_${username || "default"}`;
}

function getAccountingRecord(username, softwareId) {
  const store = readAccountingStore();
  return store.users[accountingStoreKey(username, softwareId)] || { softwareId, companies: [], tokens: null };
}

function updateAccountingRecord(username, softwareId, patch = {}) {
  const store = readAccountingStore();
  const key = accountingStoreKey(username, softwareId);
  store.users[key] = { ...(store.users[key] || { softwareId }), softwareId, ...patch };
  writeAccountingStore(store);
  return store.users[key];
}

function deleteAccountingRecord(username, softwareId) {
  const store = readAccountingStore();
  delete store.users[accountingStoreKey(username, softwareId)];
  writeAccountingStore(store);
}

function accountingEnvValue(name) {
  if (name === "QBO_CLIENT_ID") return QBO_CLIENT_ID;
  if (name === "QBO_CLIENT_SECRET") return QBO_CLIENT_SECRET;
  if (name === "QBO_REDIRECT_URI") return QBO_REDIRECT_URI;
  return String(process.env[name] || "").trim();
}

function accountingConfigured(software) {
  if (!software || software.id === "manual_upload") return true;
  return (software.envVars || []).filter((name) => !name.endsWith("_REDIRECT_URI")).every((name) => Boolean(accountingEnvValue(name)));
}

function accountingPublicSoftware(software, username = "") {
  const record = getAccountingRecord(username, software.id);
  const envVarsPresent = {};
  (software.envVars || []).forEach((name) => { envVarsPresent[name] = Boolean(accountingEnvValue(name)); });
  return {
    softwareId: software.id,
    id: software.id,
    name: software.name,
    vendor: software.vendor,
    logo: software.logo,
    type: software.type,
    authType: software.authType,
    configured: accountingConfigured(software),
    envVarsPresent,
    setupUrl: software.setupUrl,
    note: software.note || "",
    supportsCash: Boolean(software.supportsCash),
    supportsMultiCompany: Boolean(software.supportsMultiCompany),
    connected: software.id === "quickbooks" ? qboCompaniesForUser(username).length > 0 : Boolean((record.companies || []).length),
  };
}

function accountingReportDefinitions(softwareId) {
  if (softwareId === "quickbooks") return availableQboReports();
  const base = {
    ProfitAndLoss: { name: "Profit & Loss", category: "income", dateRange: true, supportsComparative: true },
    ProfitAndLossDetail: { name: "Profit & Loss Detail", category: "income", dateRange: true },
    BalanceSheet: { name: "Balance Sheet", category: "balance", asOfDate: true, supportsComparative: true },
    BalanceSheetDetail: { name: "Balance Sheet Detail", category: "balance", asOfDate: true },
    TrialBalance: { name: "Trial Balance", category: "balance", dateRange: true },
    GeneralLedger: { name: "General Ledger", category: "detail", dateRange: true },
    CashFlow: { name: "Cash Flow", category: "income", dateRange: true },
    CashSummary: { name: "Cash Summary", category: "income", dateRange: true },
    ExecutiveSummary: { name: "Executive Summary", category: "income", dateRange: true },
    AgedReceivables: { name: "Accounts Receivable Aging", category: "balance", asOfDate: true },
    AgedPayables: { name: "Accounts Payable Aging", category: "balance", asOfDate: true },
    AgedReceivablesByContact: { name: "Aged Receivables by Contact", category: "balance", asOfDate: true },
    AgedPayablesByContact: { name: "Aged Payables by Contact", category: "balance", asOfDate: true },
    ExpensesByVendorSummary: { name: "Expenses by Vendor", category: "income", dateRange: true },
    IncomeByCustomerSummary: { name: "Income by Customer", category: "income", dateRange: true },
    SalesByCustomer: { name: "Sales by Customer", category: "income", dateRange: true },
    ExpensesByVendor: { name: "Expenses by Vendor", category: "income", dateRange: true },
    TaxSummary: { name: "Tax Summary", category: "tax", dateRange: true },
    ExpenseReport: { name: "Expense Report", category: "detail", dateRange: true },
    InvoiceDetails: { name: "Invoice Details", category: "detail", dateRange: true },
    PaymentReport: { name: "Payment Report", category: "detail", dateRange: true },
    AccountTransactions: { name: "Account Transactions", category: "detail", dateRange: true },
    FinancialStatements: { name: "Financial Statements", category: "balance", dateRange: true },
    IncomeStatement: { name: "Income Statement", category: "income", dateRange: true },
    StatisticalReport: { name: "Statistical Report", category: "detail", dateRange: true },
  };
  const software = ACCOUNTING_SOFTWARE[softwareId] || ACCOUNTING_SOFTWARE.manual_upload;
  return (software.reports || []).map((id) => ({ id, ...(base[id] || { name: id, category: "other", dateRange: true }), supportsCash: software.supportsCash, description: `${base[id]?.name || id} from ${software.name}` }));
}

function accountingRedirectUri(softwareId) {
  if (softwareId === "quickbooks") return QBO_REDIRECT_URI;
  const envMap = {
    xero: "XERO_REDIRECT_URI",
    freshbooks: "FRESHBOOKS_REDIRECT_URI",
    wave: "WAVE_REDIRECT_URI",
    zoho_books: "ZOHO_REDIRECT_URI",
  };
  return accountingEnvValue(envMap[softwareId]) || `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}/auth/accounting/${softwareId}/callback`;
}

function accountingOAuthConfig(softwareId) {
  const software = ACCOUNTING_SOFTWARE[softwareId];
  if (!software) return null;
  const scopes = (software.scopes || []).join(" ");
  const configs = {
    quickbooks: {
      authUrl: "https://appcenter.intuit.com/connect/oauth2",
      tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      clientId: QBO_CLIENT_ID,
      clientSecret: QBO_CLIENT_SECRET,
      redirectUri: accountingRedirectUri("quickbooks"),
      scope: QBO_SCOPES,
    },
    xero: {
      authUrl: "https://login.xero.com/identity/connect/authorize",
      tokenUrl: "https://identity.xero.com/connect/token",
      clientId: accountingEnvValue("XERO_CLIENT_ID"),
      clientSecret: accountingEnvValue("XERO_CLIENT_SECRET"),
      redirectUri: accountingRedirectUri("xero"),
      scope: scopes,
    },
    freshbooks: {
      authUrl: "https://auth.freshbooks.com/oauth/authorize",
      tokenUrl: "https://api.freshbooks.com/auth/oauth/token",
      clientId: accountingEnvValue("FRESHBOOKS_CLIENT_ID"),
      clientSecret: accountingEnvValue("FRESHBOOKS_CLIENT_SECRET"),
      redirectUri: accountingRedirectUri("freshbooks"),
      scope: scopes,
    },
    wave: {
      authUrl: "https://api.waveapps.com/oauth2/authorize/",
      tokenUrl: "https://api.waveapps.com/oauth2/token/",
      clientId: accountingEnvValue("WAVE_CLIENT_ID"),
      clientSecret: accountingEnvValue("WAVE_CLIENT_SECRET"),
      redirectUri: accountingRedirectUri("wave"),
      scope: scopes,
    },
    zoho_books: {
      authUrl: "https://accounts.zoho.com/oauth/v2/auth",
      tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
      clientId: accountingEnvValue("ZOHO_CLIENT_ID"),
      clientSecret: accountingEnvValue("ZOHO_CLIENT_SECRET"),
      redirectUri: accountingRedirectUri("zoho_books"),
      scope: scopes.join ? scopes.join(" ") : scopes,
    },
  };
  return configs[softwareId] || null;
}

function buildAccountingAuthUrl(softwareId, username) {
  const config = accountingOAuthConfig(softwareId);
  if (!config?.clientId || !config?.clientSecret) throw Object.assign(new Error(`${ACCOUNTING_SOFTWARE[softwareId]?.name || softwareId} is not configured.`), { statusCode: 503, expose: true });
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: config.scope,
    // HMAC-signed state prevents CSRF / tampering: the callback verifies sig before trusting username.
    state: Buffer.from(JSON.stringify({ username, softwareId, sig: hmac(`accounting:${softwareId}:${username}`) })).toString("base64url"),
  });
  if (softwareId === "zoho_books") {
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  }
  return `${config.authUrl}?${params.toString()}`;
}

async function exchangeAccountingToken(softwareId, code) {
  const config = accountingOAuthConfig(softwareId);
  const headers = { accept: "application/json", "content-type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri });
  if (softwareId === "quickbooks" || softwareId === "xero" || softwareId === "freshbooks" || softwareId === "wave") {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  }
  const response = await fetch(config.tokenUrl, { method: "POST", headers, body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error_description || data.error || `Could not connect ${ACCOUNTING_SOFTWARE[softwareId]?.name || softwareId}.`), { statusCode: response.status, expose: true });
  return { ...data, expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000) - 60000 };
}

// Refresh an OAuth2 accounting token. Xero ROTATES the refresh token on every use,
// so the caller must persist the returned refresh_token. invalidGrant flags a dead
// refresh token (client revoked access, or expired by inactivity) → reconnect needed.
async function refreshAccountingToken(softwareId, refreshToken) {
  const config = accountingOAuthConfig(softwareId);
  if (!config?.clientId || !config?.clientSecret) throw Object.assign(new Error(`${ACCOUNTING_SOFTWARE[softwareId]?.name || softwareId} is not configured.`), { statusCode: 503, expose: true });
  const headers = { accept: "application/json", "content-type": "application/x-www-form-urlencoded" };
  const reqBody = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (softwareId === "xero" || softwareId === "freshbooks" || softwareId === "wave") {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  } else {
    reqBody.set("client_id", config.clientId);
    reqBody.set("client_secret", config.clientSecret);
  }
  const response = await fetch(config.tokenUrl, { method: "POST", headers, body: reqBody });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const text = `${data.error || ""} ${data.error_description || ""}`;
    const error = Object.assign(new Error(data.error_description || data.error || `Could not refresh ${ACCOUNTING_SOFTWARE[softwareId]?.name || softwareId}.`), { statusCode: response.status, expose: true });
    error.invalidGrant = response.status === 400 || response.status === 401 || /invalid_grant|invalid_request|unauthorized|revoked/i.test(text);
    throw error;
  }
  return {
    ...data,
    refresh_token: data.refresh_token || refreshToken, // Xero rotates — keep the new one
    expires_at: Date.now() + (Number(data.expires_in || 1800) * 1000) - 60000,
  };
}

// Return a valid (non-expired) access token for an OAuth2 accounting provider,
// refreshing and persisting the rotated token when needed. Marks the connection
// "disconnected" when the refresh token is dead so the UI can prompt reconnection.
async function getValidAccountingTokens(username, softwareId, { force = false } = {}) {
  const record = getAccountingRecord(username, softwareId);
  const tokens = record.tokens;
  if (!tokens?.access_token && !tokens?.refresh_token) {
    throw Object.assign(new Error(`${ACCOUNTING_SOFTWARE[softwareId]?.name || softwareId} is not connected.`), { statusCode: 401, expose: true });
  }
  const expired = !tokens.access_token || Number(tokens.expires_at || 0) <= Date.now();
  if (!force && !expired) return tokens;
  if (!tokens.refresh_token) {
    updateAccountingRecord(username, softwareId, { status: "disconnected" });
    throw Object.assign(new Error(`${ACCOUNTING_SOFTWARE[softwareId]?.name || softwareId} session expired. Reconnect to continue.`), { statusCode: 401, expose: true, reconnect: true });
  }
  try {
    const refreshed = await refreshAccountingToken(softwareId, tokens.refresh_token);
    const merged = { ...tokens, ...refreshed };
    updateAccountingRecord(username, softwareId, { tokens: merged, status: "connected", lastRefreshedAt: new Date().toISOString() });
    return merged;
  } catch (error) {
    if (error.invalidGrant) {
      updateAccountingRecord(username, softwareId, { status: "disconnected" });
      throw Object.assign(new Error(`${ACCOUNTING_SOFTWARE[softwareId]?.name || softwareId} access was revoked or expired. Reconnect to continue.`), { statusCode: 401, expose: true, reconnect: true });
    }
    throw error;
  }
}

// Best-effort token revocation at the provider on disconnect. Never throws — the
// local record is always removed by the caller regardless of the provider result.
async function revokeAccountingTokens(softwareId, tokens = {}) {
  try {
    const config = accountingOAuthConfig(softwareId);
    const token = tokens.refresh_token || tokens.access_token;
    if (!config?.clientId || !token) return;
    const revokeUrls = {
      xero: "https://identity.xero.com/connect/revocation",
      quickbooks: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
    };
    const url = revokeUrls[softwareId];
    if (!url) return;
    // Hard timeout so a slow/unreachable provider revoke endpoint can never hang forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      if (softwareId === "quickbooks") {
        await fetch(url, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json", authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}` },
          body: JSON.stringify({ token }),
          signal: controller.signal,
        });
      } else {
        await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}` },
          body: new URLSearchParams({ token }),
          signal: controller.signal,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (_) {
    // Revocation is best-effort; ignore provider errors (including the abort timeout).
  }
}

async function accountingApiFetch(url, tokens, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { accept: "application/json", authorization: `Bearer ${tokens.access_token}`, ...(options.headers || {}) },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw Object.assign(new Error(data.Detail || data.Message || data.error_description || data.error || `Accounting API error ${response.status}`), { statusCode: response.status, expose: true });
  return data;
}

async function fetchAccountingCompanies(softwareId, tokens, params = {}) {
  if (softwareId === "quickbooks") return [];
  if (softwareId === "xero") {
    const connections = await accountingApiFetch("https://api.xero.com/connections", tokens);
    return (connections || []).map((item) => ({ id: item.tenantId, name: item.tenantName || item.tenantId, country: item.tenantType || "", currency: "" }));
  }
  if (softwareId === "freshbooks") {
    const data = await accountingApiFetch("https://api.freshbooks.com/auth/api/v1/users/me", tokens);
    const memberships = data.response?.business_memberships || [];
    return memberships.map((item) => ({ id: item.business?.id || item.business_id, name: item.business?.name || item.business?.id || "FreshBooks Business", currency: item.business?.currency_code || "" })).filter((item) => item.id);
  }
  if (softwareId === "wave") {
    const data = await accountingApiFetch("https://gql.waveapps.com/graphql/public", tokens, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ businesses { edges { node { id name } } } }" }),
    });
    return (data.data?.businesses?.edges || []).map((edge) => ({ id: edge.node?.id, name: edge.node?.name || edge.node?.id, currency: "" })).filter((item) => item.id);
  }
  if (softwareId === "zoho_books") {
    const data = await accountingApiFetch("https://www.zohoapis.com/books/v3/organizations", tokens);
    return (data.organizations || []).map((item) => ({ id: item.organization_id, name: item.name || item.organization_name || item.organization_id, country: item.country || "", currency: item.currency_code || "" }));
  }
  return params.companyId ? [{ id: params.companyId, name: params.companyName || params.companyId }] : [];
}

function normalizeAccountingReport(rawData, reportId, context = {}) {
  const reportName = context.reportName || rawData?.Reports?.[0]?.ReportName || rawData?.Header?.ReportName || rawData?.reportName || reportId;
  const rows = [];
  function pushRow(label, values = [], indent = 0, flags = {}) {
    if (!label && !values.length) return;
    rows.push({ name: String(label || ""), indent, isHeader: Boolean(flags.isHeader), isSummary: Boolean(flags.isSummary), columns: context.columns || ["Amount"], values: values.map((value) => String(value ?? "")) });
  }
  function flattenXero(items = [], indent = 0) {
    items.forEach((row) => {
      const cells = row.Cells || [];
      const label = cells[0]?.Value || row.Title || row.RowType || "";
      const values = cells.slice(1).map((cell) => cell.Value || "");
      pushRow(label, values, indent, { isHeader: row.RowType === "Header", isSummary: row.RowType === "SummaryRow" });
      if (row.Rows) flattenXero(row.Rows, indent + 1);
    });
  }
  if (rawData?.Reports?.[0]?.Rows) flattenXero(rawData.Reports[0].Rows);
  else if (rawData?.Rows?.Row) parseQboRows(rawData.Rows.Row).forEach((row) => pushRow(row.label, row.values, row.indent, { isSummary: row.type === "Summary" }));
  else if (rawData && typeof rawData === "object") {
    Object.entries(rawData.result || rawData).slice(0, 80).forEach(([key, value]) => {
      if (value && typeof value === "object") pushRow(key, [JSON.stringify(value).slice(0, 500)], 0);
      else pushRow(key, [value], 0);
    });
  }
  const report = {
    reportId,
    reportName,
    software: context.softwareId || "",
    companyId: context.companyId || "",
    companyName: context.companyName || "",
    startDate: context.startDate || null,
    endDate: context.endDate || context.asOfDate || null,
    currency: context.currency || "",
    basis: context.cash ? "Cash" : context.basis || "Accrual",
    sections: rows,
    totals: {},
  };
  report.csvContent = buildCSVFromUnifiedReport(report);
  return report;
}

function buildCSVFromUnifiedReport(report) {
  const lines = [
    csvLine([`${report.reportName} | ${[report.startDate, report.endDate].filter(Boolean).join(" - ")}`]),
    csvLine([`${report.companyName || report.software || ""} | ${report.basis || "N/A"} Basis`]),
    "",
  ];
  const columns = report.sections.find((row) => row.columns?.length)?.columns || ["Account", "Amount"];
  lines.push(csvLine(["Line", ...columns]));
  report.sections.forEach((row) => lines.push(csvLine([`${"  ".repeat(row.indent || 0)}${row.name}`, ...(row.values || [])])));
  lines.push("");
  return lines.join("\n");
}

async function fetchUnifiedAccountingReport(username, softwareId, companyId, spec = {}) {
  if (softwareId === "quickbooks") {
    const qboReport = await fetchQboReport(username, companyId, {
      ...spec,
      accountingMethod: spec.cash ? "Cash" : spec.accountingMethod || "Accrual",
    });
    const company = qboCompaniesForUser(username).find((item) => item.realmId === companyId);
    return { ...qboReport, software: "quickbooks", companyId, companyName: company?.companyName || companyId };
  }
  const record = getAccountingRecord(username, softwareId);
  const company = (record.companies || []).find((item) => item.id === companyId) || {};
  // Refresh-before-call: getValidAccountingTokens refreshes + persists the rotated token.
  let tokens = await getValidAccountingTokens(username, softwareId);

  // Per-provider report call, parameterized by token so we can retry after a refresh.
  async function callProvider(tok) {
    if (softwareId === "xero") {
      const map = {
        ProfitAndLoss: "ProfitAndLoss",
        BalanceSheet: "BalanceSheet",
        TrialBalance: "TrialBalance",
        CashSummary: "CashSummary",
        ExecutiveSummary: "ExecutiveSummary",
        AgedReceivablesByContact: "AgedReceivablesByContact",
        AgedPayablesByContact: "AgedPayablesByContact",
      };
      const query = new URLSearchParams();
      if (spec.startDate) query.set("fromDate", spec.startDate);
      if (spec.endDate) query.set("toDate", spec.endDate);
      // Xero point-in-time reports (BalanceSheet, agings) use `date` as the as-of date.
      if (spec.asOfDate) query.set("date", spec.asOfDate);
      query.set("reportingBasis", spec.cash ? "CASH" : "ACCRUAL");
      return accountingApiFetch(`https://api.xero.com/api.xro/2.0/Reports/${map[spec.reportId] || spec.reportId}?${query.toString()}`, tok, { headers: { "xero-tenant-id": companyId } });
    }
    if (softwareId === "zoho_books") {
      const map = { ProfitAndLoss: "profitandloss", BalanceSheet: "balancesheet", TrialBalance: "trial_balance", CashFlow: "cashflow", GeneralLedger: "generalledger", AgedReceivables: "aging/receivables", AgedPayables: "aging/payables" };
      const query = new URLSearchParams({ organization_id: companyId });
      if (spec.startDate) query.set("from_date", spec.startDate);
      if (spec.endDate || spec.asOfDate) query.set("to_date", spec.endDate || spec.asOfDate);
      if (spec.cash) query.set("cash_basis", "true");
      return accountingApiFetch(`https://www.zohoapis.com/books/v3/reports/${map[spec.reportId] || spec.reportId}?${query.toString()}`, tok);
    }
    if (softwareId === "freshbooks") {
      const map = { ProfitAndLoss: "profitloss", BalanceSheet: "balancesheet", TaxSummary: "taxsummary", ExpenseReport: "expenses_report" };
      const query = new URLSearchParams();
      if (spec.startDate) query.set("date_from", spec.startDate);
      if (spec.endDate || spec.asOfDate) query.set("date_to", spec.endDate || spec.asOfDate);
      return accountingApiFetch(`https://api.freshbooks.com/accounting/account/${companyId}/reports/${map[spec.reportId] || "profitloss"}?${query.toString()}`, tok);
    }
    if (softwareId === "wave") {
      return accountingApiFetch("https://gql.waveapps.com/graphql/public", tok, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "query($businessId: ID!) { business(id: $businessId) { id name } }", variables: { businessId: companyId } }),
      });
    }
    throw Object.assign(new Error(`${ACCOUNTING_SOFTWARE[softwareId]?.name || softwareId} report fetching requires advanced setup and is not available in this local adapter yet.`), { statusCode: 501, expose: true });
  }

  let raw = {};
  try {
    raw = await callProvider(tokens);
  } catch (error) {
    // Token expired mid-flight → refresh once and retry. getValidAccountingTokens
    // marks the connection disconnected if the refresh token itself is dead.
    if (error.statusCode === 401) {
      tokens = await getValidAccountingTokens(username, softwareId, { force: true });
      raw = await callProvider(tokens);
    } else {
      throw error;
    }
  }
  const reportDef = accountingReportDefinitions(softwareId).find((item) => item.id === spec.reportId);
  const parsed = normalizeAccountingReport(raw, spec.reportId, { ...spec, softwareId, companyId, companyName: company.name || companyId, reportName: reportDef?.name || spec.reportId, currency: company.currency || "" });
  return { ...parsed, rowCount: parsed.sections.length, fetchedAt: new Date().toISOString() };
}

async function getGoogleAccessToken(username = "default") {
  let tokens = readGoogleTokens(username);
  if (!tokens) throw Object.assign(new Error("Google Drive is not connected."), { statusCode: 401, expose: true });
  if (tokens.access_token && Number(tokens.expiry_date || 0) > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token) throw Object.assign(new Error("Google Drive refresh token is missing."), { statusCode: 401, expose: true });
  const refresh = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await refresh.json().catch(() => ({}));
  if (!refresh.ok) throw Object.assign(new Error(data.error_description || data.error || "Could not refresh Google token."), { statusCode: 401, expose: true });
  tokens = normalizeGoogleTokens({ ...data, refresh_token: tokens.refresh_token }, username);
  writeGoogleTokens(username, tokens);
  return tokens.access_token;
}

async function googleApiFetch(url, options = {}, username = "default") {
  const token = await getGoogleAccessToken(username);
  return fetch(url, { ...options, headers: { ...(options.headers || {}), authorization: `Bearer ${token}` } });
}

function parseDriveFileTypes(value) {
  return String(value || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function driveMimeFilter(fileTypes = []) {
  const mimes = new Set();
  fileTypes.forEach((type) => {
    if (type === "pdf") mimes.add("application/pdf");
    if (type === "xlsx") ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "application/vnd.google-apps.spreadsheet"].forEach((mime) => mimes.add(mime));
    if (type === "docx") ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "application/vnd.google-apps.document"].forEach((mime) => mimes.add(mime));
    if (type === "txt") mimes.add("text/plain");
    if (type === "json") mimes.add("application/json");
    if (type === "csv") mimes.add("text/csv");
    if (type === "image") ["image/png", "image/jpeg", "image/webp", "image/gif"].forEach((mime) => mimes.add(mime));
    if (type === "zip") ["application/zip", "application/x-zip-compressed", "application/octet-stream"].forEach((mime) => mimes.add(mime));
  });
  return mimes.size ? ` and (${Array.from(mimes).map((mime) => `mimeType='${mime}'`).join(" or ")})` : "";
}

function driveFields() {
  return "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink),nextPageToken";
}

async function listDriveFolders(parentId = "root", username = "default") {
  const query = parentId === "shared-with-me"
    ? "sharedWithMe=true and trashed=false and mimeType='application/vnd.google-apps.folder'"
    : `'${parentId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`;
  const q = encodeURIComponent(query);
  const res = await googleApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`, {}, username);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || "Could not list Drive folders."), { statusCode: res.status, expose: true });
  return data.files || [];
}

async function listDriveFiles(folderId = "root", fileTypes = [], pageToken = "", username = "default") {
  const query = folderId === "shared-with-me"
    ? `sharedWithMe=true and trashed=false and mimeType!='application/vnd.google-apps.folder'${driveMimeFilter(fileTypes)}`
    : `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'${driveMimeFilter(fileTypes)}`;
  const q = encodeURIComponent(query);
  const token = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
  const res = await googleApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${encodeURIComponent(driveFields())}&orderBy=modifiedTime desc&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true${token}`, {}, username);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || "Could not list Drive files."), { statusCode: res.status, expose: true });
  return { files: data.files || [], nextPageToken: data.nextPageToken || null };
}

async function searchDriveFiles(query, fileTypes = [], username = "default") {
  const safeQuery = String(query || "").replace(/'/g, "\\'");
  const q = encodeURIComponent(`name contains '${safeQuery}' and trashed=false and mimeType!='application/vnd.google-apps.folder'${driveMimeFilter(fileTypes)}`);
  const res = await googleApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${encodeURIComponent(driveFields())}&orderBy=modifiedTime desc&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`, {}, username);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || "Could not search Drive."), { statusCode: res.status, expose: true });
  return { files: data.files || [], nextPageToken: data.nextPageToken || null };
}

async function readDriveFile(fileId, fileName, mimeType, username = "default") {
  if (!fileId) throw Object.assign(new Error("Missing Drive file id."), { statusCode: 400, expose: true });
  const exportMime = googleExportMimeType(mimeType);
  const url = exportMime
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const res = await googleApiFetch(url, {}, username);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error?.message || "Could not read Drive file."), { statusCode: res.status, expose: true });
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const finalMime = exportMime || mimeType || res.headers.get("content-type") || "application/octet-stream";
  return {
    fileName: exportMime ? driveExportName(fileName, exportMime) : String(fileName || "drive-file"),
    mimeType: finalMime,
    contentBase64: buffer.toString("base64"),
    sizeBytes: buffer.length,
  };
}

async function getDriveFileMetadata(fileId, fields = "id,name,mimeType", username = "default") {
  const res = await googleApiFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`, {}, username);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || "Could not read Drive metadata."), { statusCode: res.status, expose: true });
  return data;
}

async function loadClientDataFromDriveFolder(folderId, username = "default") {
  const folderMeta = await getDriveFileMetadata(folderId, "id,name", username);
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false and (mimeType='text/plain' or mimeType='application/json' or mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document')`);
  const res = await googleApiFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType)&orderBy=name&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`, {}, username);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message || "Could not scan client folder."), { statusCode: res.status, expose: true });
  const files = data.files || [];
  const priority = ["client_info", "contact", "client", "info"];
  let clientInfoFile = null;
  for (const prefix of priority) {
    clientInfoFile = files.find((file) => String(file.name || "").toLowerCase().startsWith(prefix));
    if (clientInfoFile) break;
  }
  if (!clientInfoFile && files.length) {
    clientInfoFile = files.find((file) => ["text/plain", "application/json"].includes(file.mimeType)) || files[0];
  }
  const clientData = {
    name: "",
    email: "",
    company: "",
    folderName: folderMeta.name || "",
    folderId,
    sourceFile: null,
    confidence: "low",
  };
  if (clientInfoFile) {
    const content = await readDriveTextForClientInfo(clientInfoFile, username);
    Object.assign(clientData, parseClientInfoContent(content));
    clientData.sourceFile = clientInfoFile.name;
  }
  if (!clientData.name && !clientData.company) {
    clientData.company = folderMeta.name || "";
    clientData.name = folderMeta.name || "";
  }
  return clientData;
}

async function loadClientDataFromDriveFile(filePayload = {}, username = "default") {
  let file = filePayload;
  let content = "";
  if (filePayload.fileId) {
    const meta = await getDriveFileMetadata(filePayload.fileId, "id,name,mimeType", username);
    file = { id: meta.id, name: meta.name, mimeType: meta.mimeType };
    content = await readDriveTextForClientInfo(file, username);
  } else if (filePayload.contentBase64) {
    const buffer = Buffer.from(String(filePayload.contentBase64 || ""), "base64");
    content = clientInfoBufferToText(buffer, filePayload.mimeType || filePayload.type || "", filePayload.name || "");
  }

  const parsed = parseClientInfoContent(content);
  const sourceName = file.name || filePayload.name || "Client info file";
  if (!parsed.name && !parsed.company) {
    const fallback = String(sourceName).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    parsed.name = fallback;
    parsed.company = fallback;
    parsed.confidence = parsed.email ? "medium" : "low";
  }
  return {
    ...parsed,
    folderName: "",
    folderId: "",
    sourceFile: sourceName,
  };
}

async function readDriveTextForClientInfo(file, username = "default") {
  const exportMime = file.mimeType === "application/vnd.google-apps.document" ? "text/plain" : "";
  const url = exportMime
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;
  const res = await googleApiFetch(url, {}, username);
  if (!res.ok) return "";
  const buffer = Buffer.from(await res.arrayBuffer());
  return clientInfoBufferToText(buffer, exportMime || file.mimeType, file.name);
}

function clientInfoBufferToText(buffer, mimeType = "", fileName = "") {
  const lowerName = String(fileName || "").toLowerCase();
  const lowerMime = String(mimeType || "").toLowerCase();
  if (lowerName.endsWith(".docx") || lowerMime.includes("wordprocessingml.document")) {
    return extractDocxText(buffer);
  }
  return buffer.toString("utf8");
}

function extractDocxText(buffer) {
  try {
    const xml = readZipEntry(buffer, "word/document.xml") || "";
    return stripXmlText(xml);
  } catch (_) {
    return buffer.toString("utf8");
  }
}

function readZipEntry(buffer, wantedName) {
  let offset = 0;
  while (offset + 30 < buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.slice(nameStart, nameStart + fileNameLength).toString("utf8");
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (name === wantedName) {
      const data = buffer.slice(dataStart, dataEnd);
      return method === 8 ? zlib.inflateRawSync(data).toString("utf8") : data.toString("utf8");
    }
    if (compressedSize <= 0 && buffer.readUInt16LE(offset + 6) & 0x0008) break;
    offset = dataEnd;
  }
  return readZipEntryFromCentralDirectory(buffer, wantedName);
}

function readZipEntryFromCentralDirectory(buffer, wantedName) {
  const maxComment = Math.min(buffer.length, 66000);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= buffer.length - maxComment; i -= 1) {
    if (i >= 0 && buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return "";
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  let offset = centralOffset;
  const centralEnd = Math.min(buffer.length, centralOffset + centralSize);
  while (offset + 46 <= centralEnd) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    if (name === wantedName && buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.slice(dataStart, dataStart + compressedSize);
      return method === 8 ? zlib.inflateRawSync(data).toString("utf8") : data.toString("utf8");
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return "";
}

function listZipEntryBuffers(buffer, maxEntries = 80) {
  const entries = [];
  const maxComment = Math.min(buffer.length, 66000);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= buffer.length - maxComment; i -= 1) {
    if (i >= 0 && buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return entries;
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  let offset = centralOffset;
  const centralEnd = Math.min(buffer.length, centralOffset + centralSize);
  while (offset + 46 <= centralEnd && entries.length < maxEntries) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
    const isDirectory = name.endsWith("/");
    if (!isDirectory && !name.startsWith("__MACOSX/") && uncompressedSize <= 12 * 1024 * 1024 && buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.slice(dataStart, dataStart + compressedSize);
      try {
        const data = method === 8 ? zlib.inflateRawSync(compressed) : compressed;
        entries.push({ name, data });
      } catch (_) {}
    }
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function extractDrawingMlText(xml) {
  const texts = [];
  const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = m[1]
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    if (t) texts.push(t);
  }
  return texts.join(" ").replace(/\s+/g, " ").trim();
}

function extractPptxText(buffer) {
  try {
    const entries = listZipEntryBuffers(buffer, 300);
    const slideEntries = entries
      .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.name))
      .sort((a, b) => (parseInt(a.name.match(/\d+/)?.[0] || 0) - parseInt(b.name.match(/\d+/)?.[0] || 0)));
    const noteEntries = entries
      .filter((e) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(e.name))
      .sort((a, b) => (parseInt(a.name.match(/\d+/)?.[0] || 0) - parseInt(b.name.match(/\d+/)?.[0] || 0)));
    const parts = [];
    slideEntries.forEach((entry, i) => {
      const text = extractDrawingMlText(entry.data.toString("utf8"));
      if (text) parts.push(`[Slide ${i + 1}] ${text}`);
    });
    noteEntries.forEach((entry, i) => {
      const text = extractDrawingMlText(entry.data.toString("utf8"));
      if (text) parts.push(`[Notes ${i + 1}] ${text}`);
    });
    return parts.join("\n") || "[PPTX: no readable slide text found]";
  } catch (err) {
    return `[Could not extract PPTX content: ${err.message || "unknown error"}]`;
  }
}

// Extracts brand colors + fonts from ppt/theme/theme1.xml inside a PPTX ZIP.
function extractPptxVisualTheme(buffer) {
  try {
    const entries = listZipEntryBuffers(buffer, 300);
    const themeEntry = entries.find((e) => /^ppt\/theme\/theme1\.xml$/i.test(e.name));
    if (!themeEntry) return null;
    const xml = themeEntry.data.toString("utf8");

    // Parse named color slots from <a:clrScheme>
    const colorMap = {};
    const slots = ["dk1","lt1","dk2","lt2","accent1","accent2","accent3","accent4","accent5","accent6"];
    for (const slot of slots) {
      const blockRe = new RegExp(`<a:${slot}[\\s>][\\s\\S]*?</a:${slot}>`, "i");
      const block = xml.match(blockRe)?.[0] || "";
      const hex = block.match(/val="([0-9A-Fa-f]{6})"/)?.[1]
               || block.match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1];
      if (hex) colorMap[slot] = hex.toUpperCase();
    }

    // Parse fonts
    const majorFontM = xml.match(/<a:majorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/);
    const minorFontM = xml.match(/<a:minorFont>[\s\S]*?<a:latin\s+typeface="([^"]+)"/);

    if (!Object.keys(colorMap).length && !majorFontM) return null;
    return {
      colors: {
        dk1: colorMap.dk1 || null,   // text/foreground
        lt1: colorMap.lt1 || null,   // background
        dk2: colorMap.dk2 || null,   // primary brand color
        accent1: colorMap.accent1 || null,
        accent2: colorMap.accent2 || null,
      },
      fonts: {
        title: majorFontM?.[1] || null,
        body: minorFontM?.[1] || null,
      },
    };
  } catch (_) { return null; }
}

async function extractZipPackageTextServer(buffer, packageName = "package.zip") {
  const parts = [];
  for (const entry of listZipEntryBuffers(buffer, 80)) {
    const name = entry.name;
    if (/\.(png|jpe?g|gif|bmp|tiff?)$/i.test(name)) continue;
    let text = "";
    try {
      if (/\.docx$/i.test(name)) text = extractDocxText(entry.data);
      else if (/\.xlsx?$/i.test(name)) text = extractXlsxText(entry.data);
      else if (/\.pdf$/i.test(name)) text = await extractPdfPlainText(entry.data);
      else if (/\.(csv|txt|md|json)$/i.test(name)) text = entry.data.toString("utf8");
      else continue;
    } catch (error) {
      text = `[Could not extract ${name}: ${error.message || "unknown error"}]`;
    }
    if (text.trim()) {
      parts.push(`ZIP PACKAGE: ${packageName}\nINNER FILE: ${name}\n${text.trim().slice(0, 50000)}`);
    }
    if (parts.join("\n\n---\n\n").length > 180000) break;
  }
  return parts.join("\n\n---\n\n") || `[ZIP package ${packageName} contained no readable supported files.]`;
}

function stripXmlText(xml) {
  return String(xml || "")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseClientInfoContent(content) {
  const data = { name: "", email: "", company: "", confidence: "low" };
  try {
    const parsed = JSON.parse(content);
    data.name = parsed.name || parsed.client_name || parsed.clientName || "";
    data.email = parsed.email || parsed.client_email || parsed.clientEmail || "";
    data.company = parsed.company || parsed.firm || parsed.business || "";
    data.confidence = data.name && data.email && data.company ? "high" : data.email ? "medium" : "low";
    return data;
  } catch (_) {}
  const nameMatch = content.match(/(?:name|client|contact)\s*[:\-]\s*(.+)/i);
  const emailMatch = content.match(/(?:email|e-mail|mail)\s*[:\-]\s*([^\s@]+@[^\s]+)/i);
  const companyMatch = content.match(/(?:company|firm|business|entity|organization)\s*[:\-]\s*(.+)/i);
  const bareEmail = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  data.name = nameMatch ? nameMatch[1].trim() : "";
  data.email = emailMatch ? emailMatch[1].trim() : bareEmail ? bareEmail[0] : "";
  data.company = companyMatch ? companyMatch[1].trim() : "";
  data.confidence = data.email ? "medium" : "low";
  return data;
}

async function readDriveFolder(folderId, folderName, fileTypes = [], username = "default") {
  if (!folderId || folderId === "shared-with-me") throw Object.assign(new Error("Select a specific Drive folder first."), { statusCode: 400, expose: true });
  const files = [];
  await collectDriveFolderFiles(folderId, folderName || "Drive folder", fileTypes, files, 0, username);
  return { folderName: folderName || "Drive folder", files, truncated: files.length >= MAX_DRIVE_FOLDER_FILES, maxFiles: MAX_DRIVE_FOLDER_FILES };
}

async function collectDriveFolderFiles(folderId, folderPath, fileTypes, files, depth, username = "default") {
  if (files.length >= MAX_DRIVE_FOLDER_FILES || depth > 10) return;
  let pageToken = "";
  do {
    const page = await listDriveFiles(folderId, fileTypes, pageToken, username);
    for (const item of page.files) {
      if (files.length >= MAX_DRIVE_FOLDER_FILES) return;
      const downloaded = await readDriveFile(item.id, item.name, item.mimeType, username);
      downloaded.fileName = `${folderPath}/${downloaded.fileName}`;
      downloaded.driveFileId = item.id;
      downloaded.driveWebViewLink = item.webViewLink || "";
      files.push(downloaded);
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken && files.length < MAX_DRIVE_FOLDER_FILES);

  const folders = await listDriveFolders(folderId, username);
  for (const folder of folders) {
    if (files.length >= MAX_DRIVE_FOLDER_FILES) return;
    await collectDriveFolderFiles(folder.id, `${folderPath}/${folder.name}`, fileTypes, files, depth + 1, username);
  }
}

function googleExportMimeType(mimeType) {
  if (mimeType === "application/vnd.google-apps.document") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (mimeType === "application/vnd.google-apps.presentation") return "application/pdf";
  return "";
}

function driveExportName(fileName, mimeType) {
  const ext = mimeType.includes("spreadsheet") ? ".xlsx" : mimeType.includes("wordprocessingml") ? ".docx" : ".pdf";
  return `${String(fileName || "google-drive-file").replace(/\.[^.]+$/, "")}${ext}`;
}

function isApiRequest(req) {
  return req.url.startsWith("/api/");
}

function isTokenConsumingRoute(req, requestUrl) {
  if (req.method !== "POST") return false;
  const pathName = requestUrl.pathname;
  return [
    "/api/research/chat",
    "/api/review",
    "/api/review/respond",
    "/api/prepare-workpaper",
    "/api/preparation/data-entry-guide",
    "/api/preparation/drake-ui-load",
    "/api/estimated-taxes/calculate",
    "/api/presentations/generate",
    "/api/calculations/run",
    "/api/notices",
    "/api/diagnostics",
    "/api/organizer",
    "/api/deliverable",
    "/api/deliverable/email-draft",
    "/api/deliverable/generate-draft",
    "/api/requests/generate-email",
    "/api/planning/analyze",
    "/api/planning/generate",
    "/api/planning/scenarios",
    "/api/planning/scenario",
    "/api/planning/opportunities",
    "/api/planning/templates",
    "/api/planning/templates/regenerate-profile",
  ].includes(pathName);
}

function requireUserSpendBudget(req, res) {
  const session = req.user || getSession(req);
  if (session?.role === "admin") {
    sendJson(res, 403, {
      code: "ADMIN_APP_ACCESS_DISABLED",
      error: "Administrator accounts can only manage users. Sign in with a user account to run app actions.",
    });
    return false;
  }
  const budget = userSpendBudget(session?.username);
  if (!budget.hasLimit) return true;
  if (budget.remainingUsd > 0) return true;
  sendJson(res, 402, {
    code: "USER_SPEND_LIMIT_REACHED",
    error: "Action limit reached for this account. Ask an administrator to increase your token budget before running more AI actions.",
    spendLimitUsd: budget.limitUsd,
    spendUsedUsd: budget.usedUsd,
    remainingUsd: budget.remainingUsd,
  });
  return false;
}

// ---------------------------------------------------------------------------
// Per-user concurrency limiter (in-memory semaphore)
// Prevents the same user from firing multiple simultaneous AI calls.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Global concurrency limiter — caps simultaneous outbound Anthropic calls
// across ALL users. When the cap is reached, new requests wait in a Promise
// queue until a slot is released rather than failing immediately.
// MAX_CONCURRENT_GLOBAL should be tuned to stay below Anthropic's RPM limit.
// ---------------------------------------------------------------------------
const MAX_CONCURRENT_GLOBAL = 10;
let _globalActiveCount = 0;
const _globalWaiters = []; // queue of { resolve } for requests waiting for a slot

function acquireGlobalSlot() {
  if (_globalActiveCount < MAX_CONCURRENT_GLOBAL) {
    _globalActiveCount++;
    return Promise.resolve();
  }
  // At cap: park the caller in the queue. It will be woken up when a slot frees.
  return new Promise((resolve) => _globalWaiters.push(resolve));
}

function releaseGlobalSlot() {
  if (_globalWaiters.length > 0) {
    // Hand the slot directly to the next waiter — count stays the same.
    const next = _globalWaiters.shift();
    next();
  } else {
    _globalActiveCount = Math.max(0, _globalActiveCount - 1);
  }
}

const MAX_CONCURRENT_PER_USER = 2;
const _activeCallsPerUser = new Map(); // username → number of active AI calls

// Attempts to acquire a slot for username. Returns true and increments the counter.
// Returns false (and sends 429) if the user is already at MAX_CONCURRENT_PER_USER.
function acquireUserSlot(req, res) {
  const session = req.user || getSession(req);
  const username = session?.username || "anonymous";
  const active = _activeCallsPerUser.get(username) || 0;
  if (active >= MAX_CONCURRENT_PER_USER) {
    sendJson(res, 429, {
      code: "TOO_MANY_CONCURRENT_REQUESTS",
      error: "Ya hay una operación en curso. Por favor esperá que termine antes de iniciar otra.",
      active,
      max: MAX_CONCURRENT_PER_USER,
    });
    return false;
  }
  _activeCallsPerUser.set(username, active + 1);
  // Attach to req so releaseUserSlot can identify the user.
  req._concurrencyUsername = username;
  return true;
}

// Releases the slot for req._concurrencyUsername. Idempotent — safe to call twice.
function releaseUserSlot(req) {
  const username = req._concurrencyUsername;
  if (!username) return; // already released or never acquired
  req._concurrencyUsername = null; // prevent double-release on finish+close firing together
  const active = _activeCallsPerUser.get(username) || 0;
  if (active <= 1) {
    _activeCallsPerUser.delete(username);
  } else {
    _activeCallsPerUser.set(username, active - 1);
  }
}

// ---------------------------------------------------------------------------
// Per-feature credit system
// Completely additive — does not replace the existing spendLimitUsd system.
// If no credits are configured for a user/feature, the check passes silently.
// ---------------------------------------------------------------------------

// All valid feature identifiers.
const CREDIT_FEATURES = [
  "review", "workpaper_prep", "estimates", "presentation",
  "misc_calc", "notices", "diagnostics", "deliverable",
  "tax_research", "tax_planning",
];

// Maps API route paths to feature identifiers.
const ROUTE_TO_FEATURE = {
  "/api/review": "review",
  "/api/review/respond": "review",
  "/api/prepare-workpaper": "workpaper_prep",
  "/api/preparation/data-entry-guide": "workpaper_prep",
  "/api/preparation/drake-ui-load": "workpaper_prep",
  "/api/estimated-taxes/calculate": "estimates",
  "/api/presentations/generate": "presentation",
  "/api/calculations/run": "misc_calc",
  "/api/notices": "notices",
  "/api/diagnostics": "diagnostics",
  "/api/organizer": "deliverable",
  "/api/deliverable": "deliverable",
  "/api/deliverable/email-draft": "deliverable",
  "/api/deliverable/generate-draft": "deliverable",
  "/api/requests/generate-email": "deliverable",
  "/api/research/chat": "tax_research",
  "/api/planning/analyze": "tax_planning",
  "/api/planning/generate": "tax_planning",
  "/api/planning/scenarios": "tax_planning",
  "/api/planning/scenario": "tax_planning",
  "/api/planning/opportunities": "tax_planning",
  "/api/planning/templates": "tax_planning",
  "/api/planning/templates/regenerate-profile": "tax_planning",
};

function readUserCredits() {
  try {
    if (fsSync.existsSync(USER_CREDITS_PATH)) {
      const parsed = JSON.parse(fsSync.readFileSync(USER_CREDITS_PATH, "utf8"));
      return (parsed && typeof parsed === "object") ? parsed : {};
    }
  } catch (_) {}
  return {};
}

function writeUserCredits(data) {
  writeJsonFile(USER_CREDITS_PATH, data);
}

// ---------------------------------------------------------------------------
// General-purpose write lock (Promise-chain serialisation).
// withWriteLock(lockMap, key, fn) ensures that only one fn() runs at a time
// for a given key within a given Map. Safe for per-user and global locks.
// ---------------------------------------------------------------------------
function withWriteLock(lockMap, key, fn) {
  const prev = lockMap.get(key) || Promise.resolve();
  const next = prev.then(fn);
  lockMap.set(key, next.catch(() => {})); // tail-only: GC'd after completion
  return next;
}

// Convenience: per-user lock for user-store writes (username as key).
const _userStoreLocks = new Map();
function withUserStoreLock(username, fn) {
  return withWriteLock(_userStoreLocks, username, fn);
}

// Per-user async write lock for credit operations (Promise-chain serialisation).
// Guarantees that check+deduct is atomic even under concurrent requests.
const _creditLocks = new Map();
function withCreditLock(username, fn) {
  return withWriteLock(_creditLocks, username, fn);
}

// Atomically checks and deducts one credit for username+feature.
// Returns true  → call is allowed (no limit configured, or credit successfully deducted).
// Returns false → user exhausted their credits for this feature.
async function checkAndDeductCredit(username, feature) {
  return withCreditLock(username, () => {
    const credits = readUserCredits();
    const fc = credits?.[username]?.[feature];
    if (!fc) return true; // no limit configured for this user/feature → allow

    // Auto-reset if the resetDate has passed.
    if (fc.resetDate && new Date() > new Date(fc.resetDate)) {
      fc.used = 0;
      fc.resetDate = null;
      writeUserCredits(credits);
      return true; // treated as fresh allocation after reset
    }

    if ((fc.used || 0) >= (fc.allocated || 0)) return false; // exhausted

    fc.used = (fc.used || 0) + 1;
    writeUserCredits(credits);
    return true;
  });
}

// Allocate (or overwrite) credits for a user+feature. Admin operation.
function allocateCredits(username, feature, amount, resetDate = null) {
  const credits = readUserCredits();
  if (!credits[username]) credits[username] = {};
  const existing = credits[username][feature] || { allocated: 0, used: 0, resetDate: null };
  credits[username][feature] = {
    allocated: Math.max(0, Number(amount) || 0),
    used: existing.used || 0,
    resetDate: resetDate !== undefined ? resetDate : existing.resetDate,
  };
  writeUserCredits(credits);
  return credits[username][feature];
}

// Route middleware: returns false and sends 402 when credits exhausted.
// Admins always pass. Users with no credit record for the feature also pass.
async function requireCreditsForRoute(req, res, requestUrl) {
  const session = req.user || getSession(req);
  if (session?.role === "admin") return true;
  const username = session?.username;
  if (!username) return true; // requireAuthenticated already blocked anonymous
  const feature = ROUTE_TO_FEATURE[requestUrl.pathname];
  if (!feature) return true; // route not mapped to a feature

  const allowed = await checkAndDeductCredit(username, feature);
  if (!allowed) {
    const credits = readUserCredits();
    const fc = credits?.[username]?.[feature] || {};
    sendJson(res, 402, {
      code: "CREDITS_EXHAUSTED",
      error: `You have used all ${fc.allocated || 0} credits for this feature. Contact your administrator to allocate more.`,
      feature,
      allocated: fc.allocated || 0,
      used: fc.used || 0,
    });
    return false;
  }
  return true;
}

// GET  /api/credits/:username  — returns credit state for a user (self or admin).
// POST /api/credits/:username  — admin only: allocate credits for a feature.
async function handleCreditsApi(req, res, requestUrl) {
  const session = req.user || getSession(req);
  const parts = requestUrl.pathname.split("/").filter(Boolean); // ["api","credits",username]
  const targetUsername = parts[2];
  if (!targetUsername) { sendJson(res, 400, { error: "Username required in path." }); return; }

  // Access control: admin sees anyone; user sees only themselves.
  if (session?.role !== "admin" && session?.username !== targetUsername) {
    sendJson(res, 403, { error: "You can only view your own credits." });
    return;
  }

  if (req.method === "GET") {
    const credits = readUserCredits();
    sendJson(res, 200, { username: targetUsername, credits: credits[targetUsername] || {} });
    return;
  }

  if (req.method === "POST") {
    if (!requireAdmin(req, res)) return;
    const payload = await readJsonBody(req);
    const { feature, allocated, resetDate } = payload;
    if (!CREDIT_FEATURES.includes(feature)) {
      sendJson(res, 400, { error: `Invalid feature. Valid: ${CREDIT_FEATURES.join(", ")}` });
      return;
    }
    const result = allocateCredits(targetUsername, feature, allocated, resetDate || null);
    appendAuditLog(req, "admin.credits_allocated", { targetUsername, feature, allocated, resetDate });
    sendJson(res, 200, { username: targetUsername, feature, credits: result });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
}

async function handleCostApi(req, res, requestUrl) {
  if (req.method === "GET" && requestUrl.pathname === "/api/cost/estimate") {
    sendJson(res, 200, estimateCost({
      action: requestUrl.searchParams.get("action") || "review",
      returnType: requestUrl.searchParams.get("returnType") || "",
      hasWorkpaper: requestUrl.searchParams.get("hasWorkpaper") === "true",
      hasImage: requestUrl.searchParams.get("hasImage") === "true",
      model: requestUrl.searchParams.get("model") || MODEL_FALLBACKS[0] || "claude-sonnet-4-6",
    }));
    return;
  }

  if (!requireAdmin(req, res)) return;

  if (req.method === "GET" && requestUrl.pathname === "/api/cost/log") {
    const entries = filterCostEntries(readCostLog().entries || [], requestUrl.searchParams)
      .map((entry) => normalizedCostEntry(entry));
    sendJson(res, 200, {
      entries,
      total: roundMoney(entries.reduce((sum, entry) => sum + entryTotalCost(entry), 0)),
      calls: entries.length,
      grouped: groupCostEntries(entries, requestUrl.searchParams.get("groupBy") || "action"),
    });
    return;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/cost/summary") {
    sendJson(res, 200, buildCostSummary(readCostLog().entries || []));
    return;
  }

  sendJson(res, 404, { error: "Cost route not found." });
}

function readCostLog() {
  ensureDatabase();
  return readJsonFile(COST_LOG_PATH, { entries: [] });
}

function saveCostLog(log) {
  writeJsonFile(COST_LOG_PATH, { entries: Array.isArray(log.entries) ? log.entries : [] });
}

function estimateCost({ action, hasWorkpaper, hasImage, model }) {
  const estimates = {
    review: { base: 8000, withWorkpaper: 12000, outputAvg: 3000 },
    preparation: { base: 5000, withWorkpaper: 9000, outputAvg: 4000 },
    notices: { base: 4000, withImage: 5500, outputAvg: 2500 },
    diagnostics: { base: 2000, withImage: 3500, outputAvg: 1500 },
    data_entry_guide: { base: 5000, outputAvg: 5000 },
    organizer: { base: 3000, outputAvg: 3000 },
    deliverable: { base: 2000, outputAvg: 1500 },
    learning: { base: 500, outputAvg: 300 },
    research: { base: 8000, outputAvg: 4000 },
  };
  const est = estimates[action] || { base: 3000, outputAvg: 2000 };
  let inputEst = est.base;
  if (hasWorkpaper && est.withWorkpaper) inputEst = est.withWorkpaper;
  if (hasImage && est.withImage) inputEst = est.withImage;
  const rates = costRatesForModel(model);
  const inputCostEst = (inputEst / 1_000_000) * rates.inputPerMTok;
  const outputCostEst = ((est.outputAvg || 0) / 1_000_000) * rates.outputPerMTok;
  const total = inputCostEst + outputCostEst;
  return {
    estimatedInputTokens: inputEst,
    estimatedOutputTokens: est.outputAvg || 0,
    estimatedTotalCost: roundMoney(total),
    estimatedRange: { low: roundMoney(total * 0.7), high: roundMoney(total * 1.5) },
    model,
    note: "Estimate only. Actual cost depends on document size.",
  };
}

function costRatesForModel(model) {
  return MODEL_COSTS[model] || MODEL_COSTS["claude-sonnet-4-6"];
}

function calculateCost(usage, model) {
  const rates = costRatesForModel(model);
  const inputTokens = Number(usage?.input_tokens || 0);
  const outputTokens = Number(usage?.output_tokens || 0);
  const cacheCreationTokens = Number(usage?.cache_creation_input_tokens || 0);
  const cacheReadTokens = Number(usage?.cache_read_input_tokens || 0);
  const inputCost = (inputTokens / 1_000_000) * rates.inputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * rates.outputPerMTok;
  const cacheCost = (cacheCreationTokens / 1_000_000) * rates.cacheWritePerMTok + (cacheReadTokens / 1_000_000) * rates.cacheReadPerMTok;
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    inputCost: roundMoney(inputCost),
    outputCost: roundMoney(outputCost),
    cacheCost: roundMoney(cacheCost),
    totalCost: roundMoney(inputCost + outputCost + cacheCost),
  };
}

function logClaudeCost(req, result, action, tab, payload = {}, startedAt = Date.now()) {
  const usage = result?.data?.usage;
  if (!usage) return;
  const model = result.data.model || result.model || MODEL_FALLBACKS[0] || "claude-sonnet-4-6";
  const now = new Date();
  const cost = calculateCost(usage, model);
  const entry = {
    id: crypto.randomUUID(),
    timestamp: now.toISOString(),
    date: now.toISOString().slice(0, 10),
    week: isoWeekKey(now),
    month: now.toISOString().slice(0, 7),
    action,
    tab,
    model,
    ...cost,
    clientName: resolveClientNameFromPayload(payload),
    returnType: resolveReturnTypeFromPayload(payload) || null,
    taxYear: String(payload.metadata?.taxYear || payload.taxYear || payload.context?.taxYear || ""),
    username: req.user?.username || getSession(req)?.username || "unknown",
    durationMs: Math.max(0, Date.now() - startedAt),
  };
  const log = readCostLog();
  log.entries.push(entry);
  saveCostLog(log);
}

function resolveClientNameFromPayload(payload = {}) {
  return String(payload.client?.name || payload.clientName || payload.metadata?.clientName || payload.metadata?.entityName || payload.entityName || payload.context?.clientName || "") || null;
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function filterCostEntries(entries, params) {
  const period = params.get("period") || "all";
  const action = params.get("action") || "";
  const today = new Date().toISOString().slice(0, 10);
  const week = isoWeekKey(new Date());
  const month = today.slice(0, 7);
  const startDate = params.get("startDate") || "";
  const endDate = params.get("endDate") || "";
  return entries.filter((entry) => {
    if (action && entry.action !== action) return false;
    if (period === "today" && entry.date !== today) return false;
    if (period === "week" && entry.week !== week) return false;
    if (period === "month" && entry.month !== month) return false;
    if (startDate && entry.date < startDate) return false;
    if (endDate && entry.date > endDate) return false;
    return true;
  }).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

function groupCostEntries(entries, groupBy) {
  const grouped = new Map();
  entries.forEach((entry) => {
    const normalized = normalizedCostEntry(entry);
    const key = String(entry[groupBy] || entry.action || "unknown");
    const current = grouped.get(key) || { key, total: 0, calls: 0 };
    current.total += normalized.totalCost;
    current.calls += 1;
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).map((item) => ({ ...item, total: roundMoney(item.total), avgCost: roundMoney(item.calls ? item.total / item.calls : 0) }));
}

function buildCostSummary(entries) {
  const today = new Date().toISOString().slice(0, 10);
  const thisWeek = isoWeekKey(new Date());
  const thisMonth = today.slice(0, 7);
  const summarize = (filtered) => ({
    total: roundMoney(filtered.reduce((sum, entry) => sum + entryTotalCost(entry), 0)),
    calls: filtered.length,
    byAction: Object.fromEntries(groupCostEntries(filtered, "action").map((item) => [item.key, item])),
  });
  const sorted = entries.slice()
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .map((entry) => normalizedCostEntry(entry));
  return {
    today: summarize(entries.filter((entry) => entry.date === today)),
    thisWeek: summarize(entries.filter((entry) => entry.week === thisWeek)),
    thisMonth: summarize(entries.filter((entry) => entry.month === thisMonth)),
    allTime: summarize(entries),
    topCostActions: groupCostEntries(entries, "action").sort((a, b) => b.total - a.total).slice(0, 12),
    dailyTrend: buildDailyCostTrend(entries, 30),
    modelBreakdown: groupCostEntries(entries, "model").sort((a, b) => b.total - a.total),
    recentEntries: sorted.slice(0, 50),
  };
}

function buildDailyCostTrend(entries, days) {
  const output = [];
  const now = new Date();
  for (let index = days - 1; index >= 0; index -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - index);
    const date = d.toISOString().slice(0, 10);
    const dayEntries = entries.filter((entry) => entry.date === date);
    output.push({ date, total: roundMoney(dayEntries.reduce((sum, entry) => sum + entryTotalCost(entry), 0)), calls: dayEntries.length });
  }
  return output;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(6));
}

function buildLoginPage(error = "") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Sign in - RAG Tax AI</title>
    <meta name="description" content="AI-powered tax return review, automated workpaper preparation, and direct accounting software integration for CPA firms." />
    <link rel="canonical" href="https://ragtax-ia.com/login" />
    <link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png" />
    <link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png" />
    <link rel="icon" type="image/png" sizes="144x144" href="/favicon-144.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/favicon-512.png" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta property="og:title" content="RAG Tax AI" />
    <meta property="og:description" content="AI-powered tax return review, automated workpaper preparation, and direct accounting software integration for CPA firms." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://ragtax-ia.com/login" />
    <meta property="og:image" content="https://ragtax-ia.com/favicon-192.png" />
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "RAG Tax AI",
        "url": "https://ragtax-ia.com/",
        "description": "AI-powered tax return review, automated workpaper preparation, and direct accounting software integration for CPA firms.",
        "publisher": {
          "@type": "Organization",
          "name": "RAG Tax AI",
          "logo": {
            "@type": "ImageObject",
            "url": "https://ragtax-ia.com/favicon-512.png",
            "width": 512,
            "height": 512
          }
        }
      }
    </script>
    <style>
      :root { color-scheme: light; font-family: Inter, Arial, sans-serif; color: #0f172a; background: #f8fafc; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; }
      .login-page { display: flex; min-height: 100vh; }
      .login-left-panel {
        flex: 0 0 45%; min-height: 100vh; padding: 48px 52px;
        background: linear-gradient(135deg, #0f1e3d 0%, #1B3A6B 45%, #2563eb 100%);
        color: white; display: flex; flex-direction: column; justify-content: space-between;
        position: relative; overflow: hidden;
      }
      .login-bg-shapes, .shape { position: absolute; pointer-events: none; }
      .login-bg-shapes { inset: 0; }
      .shape { border-radius: 999px; border: 1px solid rgba(255,255,255,.08); }
      .shape-1 { width: 420px; height: 420px; top: -120px; right: -120px; background: radial-gradient(circle, rgba(37,99,235,.18), transparent 70%); }
      .shape-2 { width: 280px; height: 280px; bottom: 60px; left: -80px; background: radial-gradient(circle, rgba(255,255,255,.06), transparent 70%); }
      .shape-3 { width: 180px; height: 180px; top: 45%; right: 20%; }
      .login-brand, .login-features, .login-left-footer { position: relative; z-index: 1; }
      .login-logo-mark {
        width: 68px; height: 68px; margin-bottom: 18px;
      }
      .login-logo-mark img {
        width: 68px; height: 68px; object-fit: contain; display: block;
      }
      .login-app-name { margin: 0; font-size: 42px; line-height: 1; font-weight: 850; letter-spacing: 0; }
      .login-slogan { margin: 12px 0 0; color: rgba(255,255,255,.72); font-size: 16px; line-height: 1.5; }
      .login-features { display: grid; gap: 14px; }
      .login-feature-item { display: flex; align-items: center; gap: 14px; color: rgba(255,255,255,.84); font-size: 14px; }
      .login-feature-icon { width: 36px; height: 36px; border-radius: 8px; display: grid; place-items: center; background: rgba(255,255,255,.12); font-weight: 800; }
      .login-left-footer { display: flex; gap: 8px; color: rgba(255,255,255,.42); font-size: 12px; }
      .login-right-panel { flex: 1; display: grid; place-items: center; padding: 40px; background: #f8fafc; }
      .login-form-container { width: min(400px, 100%); }
      .login-form-title { margin: 0 0 4px; color: #0f1e3d; font-size: 28px; }
      .login-form-subtitle { margin: 0 0 28px; color: #64748b; font-size: 14px; }
      .login-field { margin-bottom: 16px; }
      .login-field label { display: block; margin-bottom: 6px; color: #374151; font-size: 13px; font-weight: 750; }
      .login-field input { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 11px 14px; color: #111827; font: inherit; background: white; }
      .login-field input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.1); }
      .login-password-wrapper { position: relative; }
      .login-show-password { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: 0; background: transparent; color: #64748b; cursor: pointer; font-weight: 700; }
      .login-error { border: 1px solid #fca5a5; border-radius: 8px; background: #fef2f2; color: #b91c1c; padding: 10px 12px; margin-bottom: 16px; font-size: 13px; font-weight: 700; }
      .login-submit-btn { width: 100%; min-height: 44px; border: 0; border-radius: 8px; background: linear-gradient(135deg, #1B3A6B, #2563eb); color: white; cursor: pointer; font-size: 15px; font-weight: 800; display: grid; place-items: center; }
      .login-submit-btn:hover { opacity: .93; }
      .login-submit-btn:disabled { opacity: .62; cursor: not-allowed; }
      .login-access-link { margin: 14px 0 0; text-align: center; color: #64748b; font-size: 13px; }
      .login-access-link a { color: #1d4ed8; font-weight: 800; text-decoration: underline; }
      .login-legal-links { margin-top: 18px; display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; color: #94a3b8; font-size: 12px; }
      .login-legal-links a { color: #64748b; text-decoration: none; font-weight: 700; }
      .login-legal-links a:hover { color: #1d4ed8; text-decoration: underline; }
      .login-version { margin-top: 24px; text-align: center; color: #94a3b8; font-size: 11px; }
      .spinner { width: 17px; height: 17px; animation: spin .8s linear infinite; vertical-align: -3px; margin-right: 7px; }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (max-width: 820px) {
        .login-page { display: block; }
        .login-left-panel { min-height: auto; padding: 30px 24px; }
        .login-features, .login-left-footer { display: none; }
        .login-app-name { font-size: 32px; }
        .login-right-panel { padding: 32px 20px; }
      }
    </style>
  </head>
  <body>
    <main class="login-page">
      <section class="login-left-panel">
        <div class="login-bg-shapes"><div class="shape shape-1"></div><div class="shape shape-2"></div><div class="shape shape-3"></div></div>
        <div class="login-brand">
          <div class="login-logo-mark">
            <img src="/assets/rag-r-logo.png" alt="RAG Tax AI logo" />
          </div>
          <h1 class="login-app-name">RAG Tax AI</h1>
          <p class="login-slogan">Built for CPA firms. Powered by AI.</p>
        </div>
        <div class="login-features">
          <div class="login-feature-item"><span class="login-feature-icon">AI</span><span>AI-powered tax return review</span></div>
          <div class="login-feature-item"><span class="login-feature-icon">WP</span><span>Automated workpaper preparation</span></div>
          <div class="login-feature-item"><span class="login-feature-icon">QB</span><span>Direct accounting software integration</span></div>
          <div class="login-feature-item"><span class="login-feature-icon">GD</span><span>Google Drive and Gmail workflows</span></div>
        </div>
        <div class="login-left-footer"><span>&copy; 2026 RAG Tax AI</span><span>&middot;</span><span>Certifai CPA</span></div>
      </section>
      <section class="login-right-panel">
        <div class="login-form-container">
          <h2 class="login-form-title">Welcome back</h2>
          <p class="login-form-subtitle">Sign in to your account</p>
          ${error ? `<div class="login-error">${escapeHtml(error)}</div>` : '<div id="error" class="login-error" hidden></div>'}
          <form id="loginForm">
            <div class="login-field"><label for="username">Username</label><input id="username" autocomplete="username" placeholder="Enter your username" required /></div>
            <div class="login-field">
              <label for="password">Password</label>
              <div class="login-password-wrapper">
                <input id="password" type="password" autocomplete="current-password" placeholder="Enter your password" required />
                <button class="login-show-password" type="button" id="showPasswordButton">Show</button>
              </div>
            </div>
            <div class="login-field" id="twoFactorField" hidden>
              <label for="twoFactorCode">Verification code</label>
              <input id="twoFactorCode" inputmode="numeric" autocomplete="one-time-code" placeholder="Enter the 6-digit code" />
            </div>
            <button class="login-submit-btn" id="loginSubmit" type="submit"><span id="loginText">Sign In</span><span id="loginSpinner" hidden><svg class="spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" opacity=".3"/><path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/></svg>Signing in...</span></button>
          </form>
          <p class="login-access-link">No account yet? <a href="/request-access">Request access</a></p>
          <div class="login-legal-links"><a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a><span>&middot;</span><a href="/eula" target="_blank" rel="noopener">Terms of Use</a></div>
          <div class="login-version">RAG Tax AI v2.0 &middot; Powered by Claude</div>
        </div>
      </section>
    </main>
    <script>
      let twoFactorChallengeId = "";
      document.getElementById("showPasswordButton").addEventListener("click", () => {
        const input = document.getElementById("password");
        input.type = input.type === "password" ? "text" : "password";
        document.getElementById("showPasswordButton").textContent = input.type === "password" ? "Show" : "Hide";
      });
      document.getElementById("loginForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = document.getElementById("loginSubmit");
        const text = document.getElementById("loginText");
        const spinner = document.getElementById("loginSpinner");
        submit.disabled = true;
        text.hidden = true;
        spinner.hidden = false;
        const body = {
          username: document.getElementById("username").value,
          password: document.getElementById("password").value,
        };
        if (twoFactorChallengeId) {
          body.twoFactorChallengeId = twoFactorChallengeId;
          body.twoFactorCode = document.getElementById("twoFactorCode").value;
        }
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => ({}));
        if (response.status === 202 && payload.requiresTwoFactor) {
          twoFactorChallengeId = payload.challengeId || "";
          document.getElementById("twoFactorField").hidden = false;
          document.getElementById("twoFactorCode").required = true;
          document.getElementById("twoFactorCode").focus();
          const error = document.getElementById("error");
          error.hidden = false;
          error.textContent = payload.message || "Enter the verification code sent to the admin email.";
          submit.disabled = false;
          text.hidden = false;
          text.textContent = "Verify Code";
          spinner.hidden = true;
          return;
        }
        if (response.ok) {
          window.location.href = "/";
          return;
        }
        const error = document.getElementById("error");
        error.hidden = false;
        error.textContent = payload.error || "Login failed.";
        submit.disabled = false;
        text.hidden = false;
        spinner.hidden = true;
      });
    </script>
  </body>
</html>`;
}

function buildAccessRequestPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Request access - RAG Tax AI</title>
    <meta name="description" content="Request a RAG Tax AI account and receive a proposal tailored to your estimated annual return volume." />
    <link rel="canonical" href="https://ragtax-ia.com/request-access" />
    <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png" />
    <link rel="icon" type="image/png" sizes="512x512" href="/favicon-512.png" />
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta property="og:title" content="Request access - RAG Tax AI" />
    <meta property="og:description" content="Request a RAG Tax AI account and receive a proposal tailored to your estimated annual return volume." />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://ragtax-ia.com/request-access" />
    <meta property="og:image" content="https://ragtax-ia.com/favicon-192.png" />
    <style>
      :root { color-scheme: light; font-family: Inter, Arial, sans-serif; color: #0f172a; background: #f8fafc; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: #f8fafc; }
      .access-page { min-height: 100vh; display: grid; grid-template-columns: minmax(320px, 0.9fr) minmax(420px, 1.1fr); }
      .access-brand-panel {
        position: relative; overflow: hidden; padding: 48px 52px; color: white;
        background: linear-gradient(135deg, #0f1e3d 0%, #1B3A6B 48%, #2563eb 100%);
        display: flex; flex-direction: column; justify-content: space-between;
      }
      .access-brand-panel::before {
        content: ""; position: absolute; width: 480px; height: 480px; border-radius: 999px;
        right: -160px; top: -160px; background: radial-gradient(circle, rgba(255,255,255,.17), transparent 68%);
      }
      .brand-lockup, .access-proof { position: relative; z-index: 1; }
      .brand-lockup img { width: 64px; height: 64px; object-fit: contain; margin-bottom: 18px; }
      .brand-lockup h1 { margin: 0; font-size: 42px; line-height: 1; letter-spacing: 0; }
      .brand-lockup p { margin: 12px 0 0; color: rgba(255,255,255,.76); line-height: 1.55; max-width: 420px; }
      .access-proof { display: grid; gap: 14px; }
      .proof-item { display: flex; gap: 12px; align-items: center; color: rgba(255,255,255,.86); font-size: 14px; }
      .proof-mark { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; background: rgba(255,255,255,.12); font-weight: 900; }
      .access-form-panel { display: grid; place-items: center; padding: 48px 28px; }
      .access-card { width: min(560px, 100%); }
      .back-link { display: inline-flex; margin-bottom: 26px; color: #1d4ed8; font-size: 13px; font-weight: 800; text-decoration: none; }
      .access-eyebrow { margin: 0 0 10px; color: #2563eb; font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .access-title { margin: 0 0 12px; color: #0f1e3d; font-size: 32px; line-height: 1.14; letter-spacing: 0; }
      .access-copy { margin: 0 0 24px; color: #64748b; font-size: 15px; line-height: 1.65; }
      .access-form { display: grid; gap: 16px; }
      .field label { display: block; margin-bottom: 7px; color: #374151; font-size: 13px; font-weight: 800; }
      .field input { width: 100%; border: 1px solid #d1d5db; border-radius: 8px; padding: 12px 14px; color: #111827; font: inherit; background: white; }
      .field input:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.1); }
      .submit-btn { width: 100%; min-height: 46px; border: 0; border-radius: 8px; background: linear-gradient(135deg, #1B3A6B, #2563eb); color: white; cursor: pointer; font-size: 15px; font-weight: 900; }
      .submit-btn:hover { opacity: .94; }
      .submit-btn:disabled { opacity: .62; cursor: not-allowed; }
      .access-status { border-radius: 8px; padding: 12px 14px; font-size: 13px; font-weight: 750; line-height: 1.45; }
      .access-status.success { border: 1px solid #86efac; background: #f0fdf4; color: #166534; }
      .access-status.error { border: 1px solid #fca5a5; background: #fef2f2; color: #b91c1c; }
      .access-note { margin-top: 18px; color: #94a3b8; font-size: 12px; line-height: 1.5; }
      @media (max-width: 860px) {
        .access-page { display: block; }
        .access-brand-panel { min-height: auto; padding: 34px 24px; gap: 34px; }
        .brand-lockup h1 { font-size: 34px; }
        .access-form-panel { padding: 34px 20px; place-items: start center; }
        .access-title { font-size: 27px; }
      }
    </style>
  </head>
  <body>
    <main class="access-page">
      <section class="access-brand-panel">
        <div class="brand-lockup">
          <img src="/assets/rag-r-logo.png" alt="RAG Tax AI logo" />
          <h1>RAG Tax AI</h1>
          <p>AI workflows for return review, workpaper preparation, client requests, and firm-ready tax operations.</p>
        </div>
        <div class="access-proof">
          <div class="proof-item"><span class="proof-mark">01</span><span>Tell us your expected annual return volume.</span></div>
          <div class="proof-item"><span class="proof-mark">02</span><span>We size the right user setup for your workflow.</span></div>
          <div class="proof-item"><span class="proof-mark">03</span><span>You receive a proposal matched to actual usage.</span></div>
        </div>
      </section>
      <section class="access-form-panel">
        <div class="access-card">
          <a class="back-link" href="/login">Back to sign in</a>
          <p class="access-eyebrow">Request access</p>
          <h2 class="access-title">Get a RAG Tax AI account built around your return volume.</h2>
          <p class="access-copy">At RAG Tax AI, every firm works differently. We create user access and proposals around the returns each team actually needs to review, prepare, and manage, so your setup matches your workflow instead of forcing you into a generic plan.</p>
          <form id="accessRequestForm" class="access-form">
            <div class="field"><label for="accessEmail">Email</label><input id="accessEmail" type="email" autocomplete="email" placeholder="you@firm.com" required /></div>
            <div class="field"><label for="accessName">Firm, company, or person</label><input id="accessName" autocomplete="organization" placeholder="Firm name or your name" required /></div>
            <div class="field"><label for="accessReturns">Estimated annual filed returns</label><input id="accessReturns" type="number" min="1" step="1" inputmode="numeric" placeholder="Example: 350" required /></div>
            <button class="submit-btn" id="accessSubmit" type="submit">Request proposal</button>
            <div id="accessStatus" class="access-status" hidden></div>
          </form>
          <p class="access-note">After submitting, our team will contact you shortly with a proposal based on the estimates provided.</p>
        </div>
      </section>
    </main>
    <script>
      let accessSuccessRedirect = null;
      document.querySelector(".back-link").addEventListener("click", () => {
        if (accessSuccessRedirect) clearTimeout(accessSuccessRedirect);
      });
      document.getElementById("accessRequestForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = document.getElementById("accessSubmit");
        const status = document.getElementById("accessStatus");
        submit.disabled = true;
        submit.textContent = "Sending request...";
        status.hidden = true;
        status.className = "access-status";
        const response = await fetch("/api/access-request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: document.getElementById("accessEmail").value,
            contactName: document.getElementById("accessName").value,
            annualReturns: document.getElementById("accessReturns").value,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        status.hidden = false;
        if (response.ok) {
          status.classList.add("success");
          status.textContent = "Thanks. We received your request and will contact you shortly with a proposal based on the estimates provided.";
          event.target.reset();
          if (accessSuccessRedirect) clearTimeout(accessSuccessRedirect);
          accessSuccessRedirect = setTimeout(() => {
            window.location.href = "/login";
          }, 10000);
        } else {
          status.classList.add("error");
          status.textContent = payload.error || "We could not send the request. Please try again.";
        }
        submit.disabled = false;
        submit.textContent = "Request proposal";
      });
    </script>
  </body>
</html>`;
}

// ---------------------------------------------------------------------------
// Review handler
// ---------------------------------------------------------------------------
async function handleConfig(_req, res) {
  const knowledgeBase = await loadContextFiles(KNOWLEDGE_BASE_DIR, "knowledge_base", { includeBackendOnly: false });
  const reviewExamples = await loadContextFiles(REVIEW_EXAMPLES_DIR, "review_examples", { includeBackendOnly: false });
  sendJson(res, 200, {
    apiKeyConfigured: Boolean(String(process.env.ANTHROPIC_API_KEY || "").trim()),
    webSearchEnabled: WEB_SEARCH_ENABLED,
    webSearchMaxUses: WEB_SEARCH_MAX_USES,
    webSearchAllowedDomains: WEB_SEARCH_ALLOWED_DOMAINS,
    knowledgeBaseCount: knowledgeBase.length,
    reviewExampleCount: reviewExamples.length,
    knowledgeBaseFiles: knowledgeBase.map((file) => file.name),
    reviewExampleFiles: reviewExamples.map((file) => file.name),
    masterPromptConfigured: Boolean(MASTER_REVIEW_PROMPT),
    modelFallbacks: MODEL_FALLBACKS,
    maxFilesPerReview: MAX_FILES_PER_REVIEW,
    maxUploadMb: MAX_UPLOAD_MB,
    costModel: {
      currency: "USD",
      inputCostPerMillionTokens: CLAUDE_INPUT_COST_PER_MTOK,
      outputCostPerMillionTokens: CLAUDE_OUTPUT_COST_PER_MTOK,
    },
  });
}

async function handleContextList(req, res) {
  const requestedUrl = new URL(req.url, `http://${req.headers.host}`);
  const kind = normalizeContextKind(requestedUrl.searchParams.get("kind") || "");
  if (!kind) {
    sendJson(res, 400, { error: "Invalid context kind." });
    return;
  }

  const directory = contextDirectoryForKind(kind);
  const files = await loadContextFiles(directory, kind, { includeBackendOnly: false });
  sendJson(res, 200, {
    kind,
    count: files.length,
    files: files.map((file) => ({ name: file.name, chars: file.text.length })),
  });
}

async function handleContextUpload(req, res) {
  const payload = await readJsonBody(req);
  const kind = normalizeContextKind(payload.kind);
  if (!kind) {
    sendJson(res, 400, { error: "Invalid context kind." });
    return;
  }
  if (!Array.isArray(payload.files) || !payload.files.length) {
    sendJson(res, 400, { error: "Upload at least one readable context file." });
    return;
  }
  if (payload.files.length > MAX_CONTEXT_UPLOAD_FILES) {
    sendJson(res, 400, { error: `Upload at most ${MAX_CONTEXT_UPLOAD_FILES} context files at once.` });
    return;
  }

  const directory = contextDirectoryForKind(kind);
  const saved = [];
  const skipped = [];
  await fs.mkdir(directory, { recursive: true });

  for (const file of payload.files) {
    const name = safeContextRelativePath(file.name || file.originalName || "context.txt");
    const text = String(file.text || "").trim();
    if (!text) {
      skipped.push({ name, reason: "No readable text was extracted." });
      continue;
    }

    const ext = path.extname(name).toLowerCase();
    const finalName = READABLE_CONTEXT_EXTENSIONS.has(ext) ? name : `${name}.txt`;
    const target = path.join(directory, finalName);
    const relativeTarget = path.relative(directory, target);
    if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      skipped.push({ name, reason: "Invalid file path." });
      continue;
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, "utf8");
    saved.push(finalName);
  }

  sendJson(res, 200, { ok: true, kind, saved, skipped });
}

function clientFromDbOr404(db, clientId, res) {
  const client = db.clients[clientId];
  if (!client) {
    sendJson(res, 404, { error: "Client not found." });
    return null;
  }
  db.clients[clientId] = normalizeClientRecord(client);
  return db.clients[clientId];
}

function addCollectionItem(client, collection, payload, defaults = {}) {
  client[collection] = Array.isArray(client[collection]) ? client[collection] : [];
  const now = new Date().toISOString();
  const item = { id: crypto.randomUUID(), ...defaults, ...payload, addedAt: payload.addedAt || now };
  client[collection].push(item);
  client.updatedAt = now;
  return item;
}

function updateCollectionItem(client, collection, itemId, payload) {
  client[collection] = Array.isArray(client[collection]) ? client[collection] : [];
  const item = client[collection].find((entry) => entry.id === itemId);
  if (!item) return null;
  Object.assign(item, payload, { updatedAt: new Date().toISOString() });
  client.updatedAt = new Date().toISOString();
  return item;
}

function deleteCollectionItem(client, collection, itemId) {
  client[collection] = Array.isArray(client[collection]) ? client[collection] : [];
  const before = client[collection].length;
  client[collection] = client[collection].filter((entry) => entry.id !== itemId);
  client.updatedAt = new Date().toISOString();
  return before !== client[collection].length;
}

function deleteClientDocument(client, documentId) {
  client.documents = Array.isArray(client.documents) ? client.documents : [];
  const index = client.documents.findIndex((entry) => entry.id === documentId);
  if (index < 0) return false;
  const [doc] = client.documents.splice(index, 1);
  if (doc?.localPath) {
    const absPath = path.resolve(ROOT, String(doc.localPath).replace(/^\.\//, ""));
    const relative = path.relative(CLIENT_FILES_DIR, absPath);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && fsSync.existsSync(absPath)) {
      try { fsSync.rmSync(absPath, { force: true }); } catch (_) {}
    }
  }
  client.updatedAt = new Date().toISOString();
  return true;
}

function saveClientDocument(client, payload = {}) {
  const now = new Date().toISOString();
  const doc = {
    id: crypto.randomUUID(),
    name: String(payload.name || "document").trim(),
    description: String(payload.description || ""),
    category: String(payload.category || "other"),
    taxYear: payload.taxYear ? String(payload.taxYear) : null,
    contentBase64: null,
    driveFolderId: payload.driveFolderId || client.driveFolderId || null,
    driveFileId: payload.driveFileId || null,
    driveWebViewLink: payload.driveWebViewLink || null,
    localPath: null,
    storageProvider: CLIENT_FILE_PERSISTENCE_ENABLED ? "vps-local-private" : "external-reference",
    retentionDays: CLIENT_FILE_RETENTION_DAYS,
    expiresAt: CLIENT_FILE_RETENTION_DAYS > 0 ? new Date(Date.now() + CLIENT_FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString() : null,
    deletedAt: null,
    addedAt: now,
    tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
  };
  const contentBase64 = String(payload.contentBase64 || payload.content || "");
  if (contentBase64) {
    if (!CLIENT_FILE_PERSISTENCE_ENABLED) {
      throw new Error("Local client file persistence is disabled for this deployment. Attach Google Drive-hosted files or wait for R2 storage.");
    }
    const buffer = Buffer.from(contentBase64, "base64");
    if (buffer.length <= 10 * 1024 && /text|json|csv|markdown|xml/i.test(String(payload.mimeType || ""))) {
      doc.contentBase64 = contentBase64;
    } else {
      const safeName = safeFileName(doc.name);
      const relPath = path.join("data", "client_files", client.id, `${doc.id}-${safeName}`).replace(/\\/g, "/");
      const absPath = path.join(ROOT, relPath);
      ensurePrivateDirectory(path.dirname(absPath));
      fsSync.writeFileSync(absPath, buffer, { mode: PRIVATE_FILE_MODE });
      try { fsSync.chmodSync(absPath, PRIVATE_FILE_MODE); } catch (_) {}
      doc.localPath = `./${relPath}`;
    }
  }
  client.documents = Array.isArray(client.documents) ? client.documents : [];
  client.documents.push(doc);
  client.updatedAt = now;
  return doc;
}

function safeFileName(name) {
  return String(name || "file").replace(/[<>:"/\\|?*\x00-\x1F]+/g, "-").slice(0, 120) || "file";
}

function enforceClientFileRetention() {
  if (!Number.isFinite(CLIENT_FILE_RETENTION_DAYS) || CLIENT_FILE_RETENTION_DAYS <= 0) return;
  const db = readDb();
  const now = Date.now();
  let changed = false;
  Object.values(db.clients || {}).forEach((client) => {
    const documents = Array.isArray(client.documents) ? client.documents : [];
    documents.forEach((doc) => {
      if (!doc || doc.deletedAt || !doc.expiresAt) return;
      const expiresAt = new Date(doc.expiresAt).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt > now) return;
      if (doc.localPath) {
        const absPath = path.resolve(ROOT, String(doc.localPath).replace(/^\.\//, ""));
        const relative = path.relative(CLIENT_FILES_DIR, absPath);
        if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && fsSync.existsSync(absPath)) {
          try { fsSync.rmSync(absPath, { force: true }); } catch (_) {}
        }
      }
      doc.deletedAt = new Date().toISOString();
      doc.retentionStatus = "expired_deleted";
      doc.localPath = null;
      doc.contentBase64 = null;
      client.updatedAt = doc.deletedAt;
      changed = true;
    });
  });
  if (changed) {
    writeDb(db);
    appendAuditLog({ user: { username: "system", role: "system" } }, "retention.documents_enforced", {});
  }
}

function handleClientSubresource(req, res, parts) {
  const clientId = parts[2];
  const resource = parts[3];
  const itemId = parts[4];
  const db = readDb();
  const client = clientFromDbOr404(db, clientId, res);
  if (!client) return true;
  if (!requireOwnerAccess(req, res, clientOwner(client))) return true;

  const collectionMap = {
    instructions: "permanentInstructions",
    "related-parties": "relatedParties",
    "communication-log": "communicationLog",
  };
  if (resource in collectionMap) {
    const collection = collectionMap[resource];
    if (req.method === "POST" && parts.length === 4) {
      readJsonBody(req).then((payload) => {
        const item = addCollectionItem(client, collection, payload, resource === "instructions" ? { active: true, category: "other" } : {});
        writeDb(db);
        sendJson(res, 200, { item, client });
      }).catch((error) => sendJson(res, 400, { error: error.message || "Could not save item." }));
      return true;
    }
    if (req.method === "PUT" && parts.length === 5) {
      readJsonBody(req).then((payload) => {
        const item = updateCollectionItem(client, collection, itemId, payload);
        if (!item) { sendJson(res, 404, { error: "Item not found." }); return; }
        writeDb(db);
        sendJson(res, 200, { item, client });
      }).catch((error) => sendJson(res, 400, { error: error.message || "Could not update item." }));
      return true;
    }
    if (req.method === "DELETE" && parts.length === 5) {
      if (!deleteCollectionItem(client, collection, itemId)) { sendJson(res, 404, { error: "Item not found." }); return true; }
      writeDb(db);
      sendJson(res, 200, { ok: true, client });
      return true;
    }
  }

  if (resource === "documents") {
    if (req.method === "POST" && parts.length === 4) {
      readJsonBody(req).then((payload) => {
        const document = saveClientDocument(client, payload);
        writeDb(db);
        appendAuditLog(req, "client.document_added", { clientId: client.id, documentId: document.id, name: document.name });
        sendJson(res, 200, { document, client });
      }).catch((error) => sendJson(res, 400, { error: error.message || "Could not save document." }));
      return true;
    }
    if (req.method === "DELETE" && parts.length === 5) {
      if (!deleteClientDocument(client, itemId)) { sendJson(res, 404, { error: "Document not found." }); return true; }
      writeDb(db);
      appendAuditLog(req, "client.document_deleted", { clientId: client.id, documentId: itemId });
      sendJson(res, 200, { ok: true, client });
      return true;
    }
    if (req.method === "GET" && parts.length === 6 && parts[5] === "download") {
      const doc = (client.documents || []).find((item) => item.id === itemId);
      if (!doc) { sendJson(res, 404, { error: "Document not found." }); return true; }
      appendAuditLog(req, "client.document_downloaded", { clientId: client.id, documentId: itemId, name: doc.name });
      if (doc.contentBase64) { sendJson(res, 200, { name: doc.name, contentBase64: doc.contentBase64 }); return true; }
      if (doc.localPath) {
        const absPath = path.resolve(ROOT, doc.localPath.replace(/^\.\//, ""));
        if (fsSync.existsSync(absPath)) { sendJson(res, 200, { name: doc.name, contentBase64: fsSync.readFileSync(absPath).toString("base64") }); return true; }
      }
      sendJson(res, 404, { error: "Document content is not stored locally." });
      return true;
    }
  }

  if (resource === "deadlines" && req.method === "POST" && parts.length === 5) {
    readJsonBody(req).then((payload) => {
      client.deadlines = client.deadlines && typeof client.deadlines === "object" ? client.deadlines : {};
      client.deadlines[itemId] = { ...(client.deadlines[itemId] || {}), ...payload };
      client.updatedAt = new Date().toISOString();
      writeDb(db);
      rebuildDeadlinesIndex();
      sendJson(res, 200, { client, deadlines: client.deadlines[itemId] });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not save deadline." }));
    return true;
  }

  return false;
}

function handleClientApi(req, res, requestUrl) {
  const username = req.user?.username || "unknown";
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  if (parts.length >= 4 && handleClientSubresource(req, res, parts)) return;
  if (parts.length === 4 && parts[3] === "tax-software" && req.method === "PUT") {
    readJsonBody(req).then((payload) => {
      const db = readDb();
      const client = db.clients[parts[2]];
      if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
      if (!requireOwnerAccess(req, res, clientOwner(client))) return;
      client.taxSoftware = normalizeTaxSoftware(payload);
      client.updatedAt = new Date().toISOString();
      writeDb(db);
      sendJson(res, 200, { ok: true, client });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not update tax software." }));
    return;
  }
  if (parts.length === 4 && parts[3] === "link-accounting" && req.method === "POST") {
    readJsonBody(req).then((payload) => {
      const db = readDb();
      const client = db.clients[parts[2]];
      if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
      if (!requireOwnerAccess(req, res, clientOwner(client))) return;
      const softwareId = String(payload.softwareId || "").trim();
      const companyId = String(payload.companyId || "").trim();
      if (!softwareId || !companyId) { sendJson(res, 400, { error: "Missing accounting software or company." }); return; }
      client.accountingConnections = client.accountingConnections && typeof client.accountingConnections === "object" ? client.accountingConnections : {};
      client.accountingConnections[softwareId] = {
        companyId,
        companyName: String(payload.companyName || companyId).trim(),
        linkedAt: new Date().toISOString(),
      };
      client.updatedAt = new Date().toISOString();
      writeDb(db);
      sendJson(res, 200, { ok: true, connection: client.accountingConnections[softwareId] });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not link accounting software." }));
    return;
  }
  if (parts.length === 4 && parts[3] === "link-qbo" && req.method === "POST") {
    readJsonBody(req).then((payload) => {
      const db = readDb();
      const client = db.clients[parts[2]];
      if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
      if (!requireOwnerAccess(req, res, clientOwner(client))) return;
      const realmId = String(payload.realmId || "");
      const company = Object.values(readQboStore().users || {}).flatMap((user) => Object.values(user.companies || {})).find((item) => item.realmId === realmId);
      client.qboRealmId = realmId;
      client.qboCompanyName = company?.companyName || realmId;
      client.qboLinkedAt = new Date().toISOString();
      client.updatedAt = new Date().toISOString();
      writeDb(db);
      sendJson(res, 200, { ok: true, companyName: client.qboCompanyName });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not link QBO company." }));
    return;
  }
  if (parts.length === 4 && parts[3] === "link-qbo" && req.method === "DELETE") {
    const db = readDb();
    const client = db.clients[parts[2]];
    if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
    if (!requireOwnerAccess(req, res, clientOwner(client))) return;
    delete client.qboRealmId;
    delete client.qboCompanyName;
    delete client.qboLinkedAt;
    client.updatedAt = new Date().toISOString();
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (parts.length === 2 && req.method === "GET") {
    const db = readDb();
    sendJson(res, 200, { clients: Object.values(db.clients).filter((client) => canAccessOwner(req, clientOwner(client))).sort((a, b) => String(a.name).localeCompare(String(b.name))) });
    return;
  }
  if (parts.length === 2 && req.method === "POST") {
    readJsonBody(req).then((payload) => {
      const db = readDb();
      const now = new Date().toISOString();
      const client = { id: crypto.randomUUID(), tenantId: req.user?.tenantId || DEFAULT_TENANT_ID, ...pickClientFields(payload), name: String(payload.name || "Unnamed client").trim(), ownerUsername: username, createdBy: username, createdAt: now, updatedAt: now };
      db.clients[client.id] = client;
      writeDb(db);
      appendAuditLog(req, "client.created", { clientId: client.id, name: client.name });
      sendJson(res, 200, { client });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not create client." }));
    return;
  }
  if (parts.length === 3 && req.method === "GET") {
    const db = readDb();
    const client = db.clients[parts[2]];
    if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
    if (!requireOwnerAccess(req, res, clientOwner(client))) return;
    sendJson(res, 200, { client, sessions: Object.values(db.sessions).filter((session) => session.clientId === client.id) });
    return;
  }
  if (parts.length === 3 && req.method === "PUT") {
    readJsonBody(req).then((payload) => {
      const db = readDb();
      const client = db.clients[parts[2]];
      if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
      if (!requireOwnerAccess(req, res, clientOwner(client))) return;
      Object.assign(client, pickClientFields(payload), { updatedAt: new Date().toISOString() });
      writeDb(db);
      appendAuditLog(req, "client.updated", { clientId: client.id });
      sendJson(res, 200, { client });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not update client." }));
    return;
  }
  sendJson(res, 405, { error: "Client route not supported." });
}

function readFirmLibrary() {
  const library = readJsonFile(FIRM_LIBRARY_PATH, { documents: [], globalInstructions: "", defaultTaxSoftware: "" });
  return {
    documents: Array.isArray(library.documents) ? library.documents : [],
    globalInstructions: String(library.globalInstructions || ""),
    driveFolderId: library.driveFolderId || null,
    defaultTaxSoftware: String(library.defaultTaxSoftware || ""),
  };
}

function writeFirmLibrary(library) {
  writeJsonFile(FIRM_LIBRARY_PATH, {
    documents: Array.isArray(library.documents) ? library.documents : [],
    globalInstructions: String(library.globalInstructions || ""),
    driveFolderId: library.driveFolderId || null,
    defaultTaxSoftware: String(library.defaultTaxSoftware || ""),
  });
}

function readLearning() {
  const learning = readJsonFile(AI_LEARNING_PATH, { globalCorrections: [], clientCorrections: {}, returnTypePatterns: {} });
  return {
    globalCorrections: Array.isArray(learning.globalCorrections) ? learning.globalCorrections : [],
    clientCorrections: learning.clientCorrections && typeof learning.clientCorrections === "object" ? learning.clientCorrections : {},
    returnTypePatterns: learning.returnTypePatterns && typeof learning.returnTypePatterns === "object" ? learning.returnTypePatterns : {},
  };
}

function writeLearning(learning) {
  writeJsonFile(AI_LEARNING_PATH, {
    globalCorrections: Array.isArray(learning.globalCorrections) ? learning.globalCorrections : [],
    clientCorrections: learning.clientCorrections && typeof learning.clientCorrections === "object" ? learning.clientCorrections : {},
    returnTypePatterns: learning.returnTypePatterns && typeof learning.returnTypePatterns === "object" ? learning.returnTypePatterns : {},
  });
}

function readFeedbackStore() {
  const feedback = readJsonFile(FEEDBACK_PATH, { entries: [] });
  return { entries: Array.isArray(feedback.entries) ? feedback.entries : [] };
}

function writeFeedbackStore(feedback) {
  writeJsonFile(FEEDBACK_PATH, { entries: Array.isArray(feedback.entries) ? feedback.entries : [] });
}

function handleLibraryApi(req, res, requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const library = readFirmLibrary();
  if (req.method === "GET" && requestUrl.pathname === "/api/library") {
    sendJson(res, 200, library);
    return;
  }
  if (requestUrl.pathname === "/api/library/global-instructions") {
    if (req.method === "GET") {
      sendJson(res, 200, { globalInstructions: library.globalInstructions });
      return;
    }
    if (req.method === "PUT") {
      readJsonBody(req).then((payload) => {
        library.globalInstructions = String(payload.globalInstructions ?? payload.text ?? "");
        writeFirmLibrary(library);
        sendJson(res, 200, { globalInstructions: library.globalInstructions, savedAt: new Date().toISOString() });
      }).catch((error) => sendJson(res, 400, { error: error.message || "Could not save global instructions." }));
      return;
    }
  }
  if (requestUrl.pathname === "/api/library/default-tax-software") {
    if (req.method === "GET") {
      sendJson(res, 200, { defaultTaxSoftware: library.defaultTaxSoftware || "" });
      return;
    }
    if (req.method === "PUT") {
      readJsonBody(req).then((payload) => {
        library.defaultTaxSoftware = String(payload.defaultTaxSoftware || payload.primary || "").trim();
        writeFirmLibrary(library);
        sendJson(res, 200, { defaultTaxSoftware: library.defaultTaxSoftware, savedAt: new Date().toISOString() });
      }).catch((error) => sendJson(res, 400, { error: error.message || "Could not save default tax software." }));
      return;
    }
  }
  if (parts.length === 2 && req.method === "POST") {
    readJsonBody(req).then((payload) => {
      const now = new Date().toISOString();
      const doc = {
        id: crypto.randomUUID(),
        title: String(payload.title || "Untitled document").trim(),
        category: String(payload.category || "reference"),
        applicableTo: Array.isArray(payload.applicableTo) && payload.applicableTo.length ? payload.applicableTo.map(String) : ["all"],
        content: String(payload.content || ""),
        contentBase64: payload.contentBase64 || null,
        mimeType: payload.mimeType || null,
        driveFolderId: payload.driveFolderId || null,
        driveFileId: payload.driveFileId || null,
        driveWebViewLink: payload.driveWebViewLink || null,
        tags: Array.isArray(payload.tags) ? payload.tags.map(String) : [],
        alwaysInject: Boolean(payload.alwaysInject),
        active: payload.active !== false,
        addedBy: String(payload.addedBy || "local user"),
        addedAt: now,
        updatedAt: now,
      };
      library.documents.push(doc);
      writeFirmLibrary(library);
      sendJson(res, 200, { document: doc, library });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not add library item." }));
    return;
  }
  if (parts.length === 3 && req.method === "PUT") {
    readJsonBody(req).then((payload) => {
      const doc = library.documents.find((item) => item.id === parts[2]);
      if (!doc) { sendJson(res, 404, { error: "Library item not found." }); return; }
      Object.assign(doc, payload, { updatedAt: new Date().toISOString() });
      if (payload.applicableTo) doc.applicableTo = Array.isArray(payload.applicableTo) ? payload.applicableTo.map(String) : ["all"];
      if (payload.tags) doc.tags = Array.isArray(payload.tags) ? payload.tags.map(String) : [];
      writeFirmLibrary(library);
      sendJson(res, 200, { document: doc, library });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not update library item." }));
    return;
  }
  if (parts.length === 3 && req.method === "DELETE") {
    const before = library.documents.length;
    library.documents = library.documents.filter((item) => item.id !== parts[2]);
    if (before === library.documents.length) { sendJson(res, 404, { error: "Library item not found." }); return; }
    writeFirmLibrary(library);
    sendJson(res, 200, { ok: true, library });
    return;
  }
  sendJson(res, 404, { error: "Library route not found." });
}

function parseIsoDate(date) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function standardDeadline(returnType, taxYear, extended = false) {
  const year = Number(taxYear) + 1;
  const type = normalizeReturnType(returnType);
  const dates = {
    "1040": extended ? [year, 9, 15] : [year, 3, 15],
    "1041": extended ? [year, 8, 30] : [year, 3, 15],
    "1065": extended ? [year, 8, 15] : [year, 2, 15],
    "1120": extended ? [year, 9, 15] : [year, 3, 15],
    "1120-S": extended ? [year, 8, 15] : [year, 2, 15],
    "990": extended ? [year, 10, 15] : [year, 4, 15],
    "706": [year, 8, 30],
    "709": [year, 3, 15],
    "2290": [Number(taxYear), 7, 31],
  };
  const parts = dates[type] || dates["1120"];
  return new Date(Date.UTC(parts[0], parts[1], parts[2]));
}

function calculateDeadlines(client, taxYear) {
  const year = String(taxYear);
  const configured = client.deadlines?.[year] || {};
  const returnType = client.returnType || client.entityType || "1120";
  const original = parseIsoDate(configured.originalDeadline) || standardDeadline(returnType, year, false);
  const extended = configured.extendedDeadline ? parseIsoDate(configured.extendedDeadline) : standardDeadline(returnType, year, true);
  const extensionFiled = Boolean(configured.extensionFiled);
  const primaryDue = extensionFiled && extended ? extended : original;
  const now = new Date();
  const base = [{
    clientId: client.id,
    clientName: client.name,
    returnType,
    taxYear: year,
    deadlineType: extensionFiled ? "extended" : "original",
    deadlineLabel: `${returnType || "Return"} Filing Deadline`,
    dueDate: primaryDue.toISOString(),
    daysUntil: Math.ceil((primaryDue.getTime() - now.getTime()) / 86400000),
    extensionFiled,
    notificationsSent: {
      "90days": Boolean(configured.notifications?.["90days"]?.sent),
      "60days": Boolean(configured.notifications?.["60days"]?.sent),
      "30days": Boolean(configured.notifications?.["30days"]?.sent),
      "15days": Boolean(configured.notifications?.["15days"]?.sent),
    },
  }];
  const estimates = Array.isArray(configured.estimatedPaymentDates) ? configured.estimatedPaymentDates : [];
  estimates.forEach((date) => {
    const due = parseIsoDate(date);
    if (!due) return;
    base.push({
      clientId: client.id,
      clientName: client.name,
      returnType,
      taxYear: year,
      deadlineType: "estimated_payment",
      deadlineLabel: "Estimated Tax Payment",
      dueDate: due.toISOString(),
      daysUntil: Math.ceil((due.getTime() - now.getTime()) / 86400000),
      extensionFiled,
      notificationsSent: {},
    });
  });
  (configured.customDeadlines || []).forEach((item) => {
    const due = parseIsoDate(item.date);
    if (!due) return;
    base.push({
      clientId: client.id,
      clientName: client.name,
      returnType,
      taxYear: year,
      deadlineType: "custom",
      deadlineLabel: item.label || "Custom Deadline",
      dueDate: due.toISOString(),
      daysUntil: Math.ceil((due.getTime() - now.getTime()) / 86400000),
      extensionFiled,
      notificationsSent: {},
    });
  });
  return base.filter((item) => item.daysUntil >= 0);
}

function rebuildDeadlinesIndex() {
  const db = readDb();
  const upcoming = [];
  Object.values(db.clients || {}).forEach((client) => {
    const years = new Set(Object.keys(client.taxYears || {}));
    Object.keys(client.deadlines || {}).forEach((year) => years.add(year));
    const currentYear = new Date().getFullYear() - 1;
    if (years.size === 0) years.add(String(currentYear));
    years.forEach((year) => upcoming.push(...calculateDeadlines(client, year)));
  });
  upcoming.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const index = { lastRebuilt: new Date().toISOString(), upcoming };
  writeJsonFile(DEADLINES_PATH, index);
  return index;
}

function checkDeadlineNotifications() {
  const db = readDb();
  const notifications = [];
  const thresholds = [90, 60, 30, 15];
  Object.values(db.clients || {}).forEach((client) => {
    Object.keys(client.deadlines || {}).forEach((year) => {
      const configured = client.deadlines[year] || {};
      configured.notifications = configured.notifications || {};
      calculateDeadlines(client, year).forEach((deadline) => {
        thresholds.forEach((days) => {
          const key = `${days}days`;
          configured.notifications[key] = configured.notifications[key] || { sent: false, sentAt: null };
          if (deadline.daysUntil <= days && !configured.notifications[key].sent) {
            notifications.push({ threshold: key, ...deadline });
            configured.notifications[key] = { sent: true, sentAt: new Date().toISOString() };
          }
        });
      });
      client.deadlines[year] = configured;
    });
  });
  writeDb(db);
  rebuildDeadlinesIndex();
  return { notifications };
}

function handleDeadlinesApi(req, res, requestUrl) {
  // Firm scoping: deadline items carry client names, so each item is only returned when
  // the requester's firm can access that client (lookup by clientId against the db).
  const filterDeadlineItems = (items) => {
    const db = readDb();
    return (Array.isArray(items) ? items : []).filter((item) => canAccessOwner(req, clientOwner(db.clients?.[item.clientId])));
  };
  if (req.method === "GET" && requestUrl.pathname === "/api/deadlines") {
    const index = readJsonFile(DEADLINES_PATH, { lastRebuilt: "", upcoming: [] });
    sendJson(res, 200, { ...index, upcoming: filterDeadlineItems(index.upcoming) });
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/deadlines/urgent") {
    const index = readJsonFile(DEADLINES_PATH, { upcoming: [] });
    sendJson(res, 200, { upcoming: filterDeadlineItems(index.upcoming).filter((item) => item.daysUntil <= 90) });
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/deadlines/check") {
    const result = checkDeadlineNotifications();
    sendJson(res, 200, { ...result, notifications: filterDeadlineItems(result?.notifications) });
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/deadlines/rebuild") {
    const index = rebuildDeadlinesIndex();
    sendJson(res, 200, { ...index, upcoming: filterDeadlineItems(index.upcoming) });
    return;
  }
  sendJson(res, 404, { error: "Deadline route not found." });
}

function handleLearningApi(req, res, requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const learning = readLearning();
  if (req.method === "GET" && parts.length === 2) {
    sendJson(res, 200, learning);
    return;
  }
  if (req.method === "POST" && parts.length === 3 && parts[2] === "global") {
    readJsonBody(req).then((payload) => {
      const item = {
        id: crypto.randomUUID(),
        correction: String(payload.correction || payload.text || "").trim(),
        appliesTo: Array.isArray(payload.appliesTo) && payload.appliesTo.length ? payload.appliesTo.map(String) : ["all"],
        source: String(payload.source || "manual"),
        confidence: String(payload.confidence || "medium"),
        usageCount: 0,
        addedAt: new Date().toISOString(),
        active: payload.active !== false,
      };
      if (!item.correction) { sendJson(res, 400, { error: "Correction text is required." }); return; }
      learning.globalCorrections.push(item);
      writeLearning(learning);
      sendJson(res, 200, { correction: item, learning });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not add correction." }));
    return;
  }
  if (req.method === "POST" && parts.length === 4 && parts[2] === "client") {
    readJsonBody(req).then((payload) => {
      const clientId = parts[3];
      const item = {
        id: crypto.randomUUID(),
        correction: String(payload.correction || payload.text || "").trim(),
        context: String(payload.context || ""),
        source: String(payload.source || "manual"),
        addedAt: new Date().toISOString(),
        active: payload.active !== false,
      };
      if (!item.correction) { sendJson(res, 400, { error: "Correction text is required." }); return; }
      learning.clientCorrections[clientId] = Array.isArray(learning.clientCorrections[clientId]) ? learning.clientCorrections[clientId] : [];
      learning.clientCorrections[clientId].push(item);
      writeLearning(learning);
      sendJson(res, 200, { correction: item, learning });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not add client correction." }));
    return;
  }
  if (req.method === "PUT" && parts.length === 3) {
    readJsonBody(req).then((payload) => {
      const item = findLearningCorrection(learning, parts[2]);
      if (!item) { sendJson(res, 404, { error: "Correction not found." }); return; }
      Object.assign(item, payload, { updatedAt: new Date().toISOString() });
      writeLearning(learning);
      sendJson(res, 200, { correction: item, learning });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not update correction." }));
    return;
  }
  if (req.method === "DELETE" && parts.length === 3) {
    const item = findLearningCorrection(learning, parts[2]);
    if (!item) { sendJson(res, 404, { error: "Correction not found." }); return; }
    item.active = false;
    writeLearning(learning);
    sendJson(res, 200, { ok: true, learning });
    return;
  }
  if (req.method === "POST" && parts.length === 4 && parts[2] === "from-feedback") {
    promoteFeedbackToLearning(parts[3]);
    sendJson(res, 200, { ok: true, learning: readLearning(), feedback: readFeedbackStore() });
    return;
  }
  sendJson(res, 404, { error: "Learning route not found." });
}

function findLearningCorrection(learning, id) {
  const global = learning.globalCorrections.find((item) => item.id === id);
  if (global) return global;
  for (const list of Object.values(learning.clientCorrections || {})) {
    const found = (list || []).find((item) => item.id === id);
    if (found) return found;
  }
  return null;
}

function handleFeedbackApi(req, res, requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const feedback = readFeedbackStore();
  if (req.method === "GET" && requestUrl.pathname === "/api/feedback/stats") {
    const stats = { totalEntries: feedback.entries.length, byType: {}, byRating: {}, byTab: {} };
    feedback.entries.forEach((entry) => {
      stats.byType[entry.feedbackType || "general"] = (stats.byType[entry.feedbackType || "general"] || 0) + 1;
      if (entry.rating) stats.byRating[entry.rating] = (stats.byRating[entry.rating] || 0) + 1;
      stats.byTab[entry.tab || "general"] = (stats.byTab[entry.tab || "general"] || 0) + 1;
    });
    sendJson(res, 200, stats);
    return;
  }
  if (req.method === "GET" && parts.length === 2) {
    const tags = String(requestUrl.searchParams.get("tags") || "").split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
    if (tags.length) {
      const entries = feedback.entries.filter((entry) => {
        const labels = [
          entry.tag,
          entry.category,
          entry.tab,
          entry.feedbackType,
          ...(Array.isArray(entry.tags) ? entry.tags : []),
        ].map((value) => String(value || "").toLowerCase());
        return labels.some((label) => tags.includes(label) || tags.some((tag) => label.includes(tag)));
      });
      sendJson(res, 200, { ...feedback, entries });
      return;
    }
    sendJson(res, 200, feedback);
    return;
  }
  if (req.method === "POST" && parts.length === 2) {
    readJsonBody(req).then((payload) => {
      const entry = {
        id: crypto.randomUUID(),
        sessionId: payload.sessionId || null,
        clientId: payload.clientId || null,
        returnType: payload.returnType || null,
        taxYear: payload.taxYear || null,
        tab: String(payload.tab || "general"),
        tag: String(payload.tag || payload.category || payload.tab || "general"),
        tags: Array.isArray(payload.tags) ? payload.tags.map((tag) => String(tag)) : [],
        feedbackType: String(payload.feedbackType || "general"),
        rating: payload.rating ? Number(payload.rating) : null,
        issueRef: payload.issueRef || null,
        originalAIOutput: String(payload.originalAIOutput || ""),
        preparerCorrection: String(payload.preparerCorrection || payload.correction || ""),
        learnFromThis: Boolean(payload.learnFromThis),
        addedToLearning: false,
        addedAt: new Date().toISOString(),
      };
      feedback.entries.push(entry);
      writeFeedbackStore(feedback);
      if (entry.learnFromThis && entry.preparerCorrection) promoteFeedbackToLearning(entry.id);
      sendJson(res, 200, { entry, feedback: readFeedbackStore() });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not submit feedback." }));
    return;
  }
  if (req.method === "POST" && parts.length === 4 && parts[3] === "learn") {
    promoteFeedbackToLearning(parts[2]);
    sendJson(res, 200, { ok: true, learning: readLearning(), feedback: readFeedbackStore() });
    return;
  }
  sendJson(res, 404, { error: "Feedback route not found." });
}

function promoteFeedbackToLearning(feedbackId) {
  const feedback = readFeedbackStore();
  const entry = feedback.entries.find((item) => item.id === feedbackId);
  if (!entry || entry.addedToLearning || !entry.preparerCorrection) return null;
  const learning = readLearning();
  const correction = {
    id: crypto.randomUUID(),
    correction: cleanLearningCorrection(entry.preparerCorrection),
    source: "feedback",
    addedAt: new Date().toISOString(),
    active: true,
  };
  if (entry.clientId) {
    learning.clientCorrections[entry.clientId] = Array.isArray(learning.clientCorrections[entry.clientId]) ? learning.clientCorrections[entry.clientId] : [];
    learning.clientCorrections[entry.clientId].push({ ...correction, context: entry.originalAIOutput || "" });
  } else {
    learning.globalCorrections.push({ ...correction, appliesTo: [entry.returnType || "all"], confidence: "medium", usageCount: 0 });
  }
  entry.addedToLearning = true;
  entry.learnFromThis = true;
  writeLearning(learning);
  writeFeedbackStore(feedback);
  return correction;
}

function cleanLearningCorrection(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 700);
}

async function handleDatabaseDriveSyncApi(req, res, requestUrl) {
  if (req.method !== "POST") { sendJson(res, 405, { error: "Drive sync route requires POST." }); return; }
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  if (parts[2] === "client" && parts[3]) {
    const db = readDb();
    const client = db.clients[parts[3]];
    if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
    if (!requireOwnerAccess(req, res, clientOwner(client))) return;
    sendJson(res, 200, { ok: true, folderId: client.driveFolderId || null, message: "Drive sync metadata recorded. Use the Drive picker to attach Drive-hosted files." });
    return;
  }
  if (parts[2] === "auto-upload") {
    sendJson(res, 200, { ok: true, message: "Auto-upload is queued when Google Drive write access is available." });
    return;
  }
  sendJson(res, 404, { error: "Drive sync route not found." });
}

async function handleRequestsApi(req, res, requestUrl) {
  const username = req.user?.username || "default";
  if (req.method === "POST" && requestUrl.pathname === "/api/requests/search-files") {
    const payload = await readJsonBody(req);
    const db = readDb();
    const client = db.clients[String(payload.clientId || "")];
    if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
    if (!requireOwnerAccess(req, res, clientOwner(client))) return;
    const results = await searchClientRequestFiles(client, payload, username);
    sendJson(res, 200, { results, total: results.length, clientName: client.name });
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/requests/read-files") {
    const payload = await readJsonBody(req);
    const db = readDb();
    const client = db.clients[String(payload.clientId || "")];
    if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
    if (!requireOwnerAccess(req, res, clientOwner(client))) return;
    const result = await readClientRequestFiles(client, Array.isArray(payload.files) ? payload.files : [], username);
    sendJson(res, 200, result);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/requests/generate-email") {
    await handleRequestGenerateEmail(req, res);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/requests/log") {
    const payload = await readJsonBody(req);
    const db = readDb();
    const client = db.clients[String(payload.clientId || "")];
    if (!client) { sendJson(res, 404, { error: "Client not found." }); return; }
    if (!requireOwnerAccess(req, res, clientOwner(client))) return;
    const sentAt = payload.sentAt || new Date().toISOString();
    const filesSent = Array.isArray(payload.filesSent) ? payload.filesSent : [];
    client.communicationLog = Array.isArray(client.communicationLog) ? client.communicationLog : [];
    client.communicationLog.push({
      id: crypto.randomUUID(),
      date: sentAt,
      type: "email",
      summary: `Sent ${filesSent.length} document(s) per client request: ${filesSent.map((file) => file.name).join(", ")}`,
      sentTo: payload.sentTo || "",
      gmailMessageId: payload.gmailMessageId || null,
      addedBy: "Client Requests",
      addedAt: new Date().toISOString(),
    });
    client.updatedAt = new Date().toISOString();
    writeDb(db);
    appendAuditLog(req, "client_request.logged", { clientId: client.id, filesSent: filesSent.length });
    sendJson(res, 200, { ok: true, client });
    return;
  }
  sendJson(res, 404, { error: "Client request route not found." });
}

async function searchClientRequestFiles(client, payload = {}, username = "default") {
  const query = String(payload.query || "").trim().toLowerCase();
  const sources = Array.isArray(payload.sources) && payload.sources.length ? payload.sources : ["database", "drive"];
  const fileTypes = Array.isArray(payload.fileTypes) && payload.fileTypes.length ? payload.fileTypes.map((item) => String(item).toLowerCase()) : ["all"];
  const taxYear = payload.taxYear ? String(payload.taxYear) : "";
  const results = [];

  if (sources.includes("database")) {
    (client.documents || []).filter((doc) => {
      const haystack = [doc.name, doc.description, doc.category, ...(doc.tags || [])].join(" ").toLowerCase();
      const matchesQuery = !query || query.split(/\s+/).some((term) => haystack.includes(term));
      const matchesYear = !taxYear || String(doc.taxYear || "") === taxYear;
      const matchesType = fileMatchesType(doc.name, doc.mimeType, fileTypes);
      return matchesQuery && matchesYear && matchesType;
    }).forEach((doc) => {
      results.push({
        id: doc.id,
        name: doc.name,
        description: doc.description || "",
        category: doc.category || "other",
        taxYear: doc.taxYear || extractYearFromName(doc.name),
        source: "database",
        mimeType: doc.mimeType || mimeFromName(doc.name),
        size: doc.size || null,
        driveFileId: doc.driveFileId || null,
        driveWebViewLink: doc.driveWebViewLink || null,
        hasLocalCopy: Boolean(doc.contentBase64 || doc.localPath),
        hasDriveCopy: Boolean(doc.driveFileId),
        addedAt: doc.addedAt || "",
      });
    });
  }

  if (sources.includes("drive") && client.driveFolderId && isGoogleDriveEnabled() && readGoogleTokens(username)) {
    try {
      const safeTerms = query ? query.split(/\s+/).filter(Boolean) : [];
      const queryFilter = safeTerms.length ? ` and (${safeTerms.map((term) => `name contains '${term.replace(/'/g, "\\'")}'`).join(" or ")})` : "";
      const q = encodeURIComponent(`'${client.driveFolderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'${queryFilter}${driveMimeFilter(fileTypes)}`);
      const res = await googleApiFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${encodeURIComponent("files(id,name,mimeType,size,modifiedTime,webViewLink)")}&orderBy=modifiedTime desc&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`, {}, username);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const existingDriveIds = new Set((client.documents || []).map((doc) => doc.driveFileId).filter(Boolean));
        (data.files || []).forEach((file) => {
          if (existingDriveIds.has(file.id)) return;
          const year = extractYearFromName(file.name);
          if (taxYear && year !== taxYear) return;
          results.push({
            id: `drive_${file.id}`,
            name: file.name,
            description: "",
            category: "drive",
            taxYear: year,
            source: "drive_only",
            mimeType: file.mimeType || mimeFromName(file.name),
            size: file.size ? Number(file.size) : null,
            driveFileId: file.id,
            driveWebViewLink: file.webViewLink || null,
            hasLocalCopy: false,
            hasDriveCopy: true,
            modifiedTime: file.modifiedTime || "",
          });
        });
      }
    } catch (error) {
      console.warn("[Requests] Drive search failed:", error.message);
    }
  }

  results.sort((a, b) => {
    if (a.source === "database" && b.source !== "database") return -1;
    if (b.source === "database" && a.source !== "database") return 1;
    if (a.taxYear && b.taxYear && a.taxYear !== b.taxYear) return String(b.taxYear).localeCompare(String(a.taxYear));
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  return results;
}

function fileMatchesType(name, mimeType, fileTypes = ["all"]) {
  if (fileTypes.includes("all")) return true;
  const lowerName = String(name || "").toLowerCase();
  const lowerMime = String(mimeType || "").toLowerCase();
  return fileTypes.some((type) => {
    if (type === "pdf") return lowerName.endsWith(".pdf") || lowerMime.includes("pdf");
    if (type === "xlsx" || type === "excel") return /\.(xlsx|xls|csv)$/.test(lowerName) || lowerMime.includes("spreadsheet") || lowerMime.includes("excel") || lowerMime.includes("csv");
    if (type === "docx" || type === "word") return /\.(docx|doc)$/.test(lowerName) || lowerMime.includes("word") || lowerMime.includes("document");
    return lowerName.endsWith(`.${type}`) || lowerMime.includes(type);
  });
}

function mimeFromName(name = "") {
  const ext = path.extname(String(name).toLowerCase());
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".doc") return "application/msword";
  if (ext === ".csv") return "text/csv";
  if (ext === ".txt") return "text/plain";
  return "application/octet-stream";
}

function extractYearFromName(filename = "") {
  const match = String(filename).match(/\b(20[2-3][0-9])\b/);
  return match ? match[1] : null;
}

async function readClientRequestFiles(client, files, username = "default") {
  const output = [];
  const errors = [];
  for (const item of files) {
    try {
      if (item.source === "drive_only") {
        const file = await readDriveFile(item.driveFileId, item.name || "drive-file", item.mimeType || "", username);
        output.push({ name: file.fileName, mimeType: file.mimeType, contentBase64: file.contentBase64, size: file.sizeBytes });
        continue;
      }
      const doc = (client.documents || []).find((entry) => entry.id === item.id);
      if (!doc) throw new Error("Document not found in client database.");
      if (doc.contentBase64) {
        output.push({ name: doc.name, mimeType: doc.mimeType || mimeFromName(doc.name), contentBase64: doc.contentBase64, size: Buffer.byteLength(doc.contentBase64, "base64") });
        continue;
      }
      if (doc.localPath) {
        const absPath = path.resolve(ROOT, doc.localPath.replace(/^\.\//, ""));
        if (!fsSync.existsSync(absPath)) throw new Error("Local copy is missing.");
        const buffer = fsSync.readFileSync(absPath);
        output.push({ name: doc.name, mimeType: doc.mimeType || mimeFromName(doc.name), contentBase64: buffer.toString("base64"), size: buffer.length });
        continue;
      }
      if (doc.driveFileId) {
        const file = await readDriveFile(doc.driveFileId, doc.name, doc.mimeType || "", username);
        output.push({ name: file.fileName, mimeType: file.mimeType, contentBase64: file.contentBase64, size: file.sizeBytes });
        continue;
      }
      throw new Error("No local or Drive copy is available.");
    } catch (error) {
      errors.push({ name: item.name || item.id || "file", error: error.message });
    }
  }
  return { files: output, errors };
}

async function handleRequestGenerateEmail(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) { sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." }); return; }
  const prompt = [
    "Generate a routine client document delivery email.",
    "",
    `Client: ${JSON.stringify(payload.client || {})}`,
    `Preparer: ${JSON.stringify(payload.preparer || {})}`,
    `Files selected: ${JSON.stringify(payload.files || [])}`,
    `Client request context: ${payload.requestContext || "Not provided"}`,
    `Tone: ${payload.tone || "friendly"}`,
  ].join("\n");
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, [{ type: "text", text: prompt }], { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 1600,
    webSearch: false,
    system: [{ type: "text", text: buildClientRequestEmailSystemPrompt() }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "deliverable", "client_requests", payload, startedAt);
  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw) || {};
  const body = String(parsed.body || raw || "");
  sendJson(res, 200, {
    subject: String(parsed.subject || "Requested documents"),
    body,
    bodyHtml: String(parsed.bodyHtml || plainTextToHtml(body)),
    raw,
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

function buildClientRequestEmailSystemPrompt() {
  return [
    "You are a senior CPA at a professional accounting firm responding to a client document request. The client has requested documents and you are sending them.",
    "Write a short, professional email that greets the client by name, confirms the requested documents are attached, lists what is attached with one short sentence per document, notes any unavailable documents if applicable, includes a professional closing, and is signed by the preparer.",
    "Keep it concise. This is a routine document delivery email, not a complex tax communication. Use 3-6 sentences for the body.",
    "Tone rules: formal uses Dear [Last Name] and no contractions; friendly uses Hi [First Name] and warm professional language; brief uses 2-3 sentences max.",
    'Return only valid JSON inside ```json``` fences: {"subject":"string","body":"string with newline breaks","bodyHtml":"HTML version"}',
  ].join("\n");
}

function handleSessionApi(req, res, requestUrl) {
  const username = req.user?.username || "unknown";
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  if (parts.length === 2 && req.method === "GET") {
    const db = readDb();
    sendJson(res, 200, { sessions: listSessionsWithClients(db).filter((session) => canAccessOwner(req, sessionOwner(session, db))) });
    return;
  }
  if (parts.length === 2 && req.method === "POST") {
    readJsonBody(req).then((payload) => {
      const db = readDb();
      const client = getOrCreateClient(db, payload.client || payload);
      client.tenantId = client.tenantId || req.user?.tenantId || DEFAULT_TENANT_ID;
      client.ownerUsername = client.ownerUsername || username;
      client.createdBy = client.createdBy || username;
      const now = new Date().toISOString();
      const session = normalizeSession({ ...payload, id: crypto.randomUUID(), tenantId: client.tenantId || req.user?.tenantId || DEFAULT_TENANT_ID, clientId: client.id, returnType: payload.returnType || client.returnType || "", ownerUsername: username, createdBy: username, createdAt: now, updatedAt: now });
      db.sessions[session.id] = session;
      writeDb(db);
      appendAuditLog(req, "session.created", { sessionId: session.id, clientId: client.id });
      sendJson(res, 200, { session, client });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not create session." }));
    return;
  }
  if (parts.length === 3 && req.method === "GET") {
    const db = readDb();
    const session = db.sessions[parts[2]];
    if (!session) { sendJson(res, 404, { error: "Session not found." }); return; }
    if (!requireOwnerAccess(req, res, sessionOwner(session, db))) return;
    sendJson(res, 200, { session, client: db.clients[session.clientId] || null });
    return;
  }
  if (parts.length === 3 && req.method === "PUT") {
    readJsonBody(req).then((payload) => {
      const db = readDb();
      const session = db.sessions[parts[2]];
      if (!session) { sendJson(res, 404, { error: "Session not found." }); return; }
      if (!requireOwnerAccess(req, res, sessionOwner(session, db))) return;
      Object.assign(session, normalizeSessionUpdate(payload), { updatedAt: new Date().toISOString() });
      session.issues = countSessionIssues(session);
      if (payload.client && db.clients[session.clientId]) Object.assign(db.clients[session.clientId], pickClientFields(payload.client), { updatedAt: new Date().toISOString() });
      if (payload.deliverableSent && db.clients[session.clientId]) appendClientDeliverableRecord(db.clients[session.clientId], session, payload.deliverableSent);
      writeDb(db);
      appendAuditLog(req, "session.updated", { sessionId: session.id, clientId: session.clientId });
      sendJson(res, 200, { session, client: db.clients[session.clientId] || null });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not update session." }));
    return;
  }
  if (parts.length === 3 && req.method === "DELETE") {
    const db = readDb();
    if (!db.sessions[parts[2]]) { sendJson(res, 404, { error: "Session not found." }); return; }
    if (!requireOwnerAccess(req, res, sessionOwner(db.sessions[parts[2]], db))) return;
    delete db.sessions[parts[2]];
    writeDb(db);
    appendAuditLog(req, "session.deleted", { sessionId: parts[2] });
    sendJson(res, 200, { ok: true });
    return;
  }
  if (parts.length === 4 && parts[3] === "resolve-issue" && req.method === "POST") {
    readJsonBody(req).then((payload) => {
      const db = readDb();
      const session = db.sessions[parts[2]];
      if (!session) { sendJson(res, 404, { error: "Session not found." }); return; }
      if (!requireOwnerAccess(req, res, sessionOwner(session, db))) return;
      session.resolvedIssues = Array.isArray(session.resolvedIssues) ? session.resolvedIssues : [];
      session.resolvedIssues.push({ issueIndex: Number(payload.issueIndex), resolution: String(payload.resolution || ""), resolvedAt: new Date().toISOString() });
      session.issues = countSessionIssues(session);
      session.updatedAt = new Date().toISOString();
      writeDb(db);
      sendJson(res, 200, { session });
    }).catch((error) => sendJson(res, 400, { error: error.message || "Could not resolve issue." }));
    return;
  }
  sendJson(res, 405, { error: "Session route not supported." });
}

async function handleDriveApi(req, res, requestUrl) {
  const username = req.user?.username || "default";
  if (req.method === "GET" && requestUrl.pathname === "/api/drive/status") {
    const tokens = readGoogleTokens(username);
    const hasToken = Boolean(tokens?.refresh_token || tokens?.access_token);
    const driveAuthorized = hasToken && googleTokenHasScope(tokens, GOOGLE_DRIVE_SCOPE);
    const status = {
      enabled: isGoogleDriveEnabled(),
      connected: driveAuthorized,
      driveAuthorized,
      reconnectRequired: hasToken && !driveAuthorized,
      email: "",
    };
    if (status.enabled && status.connected) {
      const profile = await googleApiFetch("https://www.googleapis.com/oauth2/v2/userinfo", {}, username).then((r) => r.ok ? r.json() : {}).catch(() => ({}));
      status.email = profile.email || "";
    }
    sendJson(res, 200, status);
    return;
  }

  if (!isGoogleDriveEnabled()) { sendJson(res, 503, { enabled: false, connected: false, error: "Google Drive is not configured." }); return; }
  if (!readGoogleTokens(username)) { sendJson(res, 401, { enabled: true, connected: false, error: "Google Drive is not connected." }); return; }

  if (req.method === "GET" && requestUrl.pathname === "/api/drive/folders") {
    const parentId = requestUrl.searchParams.get("parentId") || "root";
    const folders = await listDriveFolders(parentId, username);
    sendJson(res, 200, { folders });
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/drive/files") {
    const folderId = requestUrl.searchParams.get("folderId") || "root";
    const fileTypes = parseDriveFileTypes(requestUrl.searchParams.get("fileTypes"));
    const pageToken = requestUrl.searchParams.get("pageToken") || "";
    const payload = await listDriveFiles(folderId, fileTypes, pageToken, username);
    sendJson(res, 200, payload);
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/drive/search") {
    const q = requestUrl.searchParams.get("q") || "";
    const fileTypes = parseDriveFileTypes(requestUrl.searchParams.get("fileTypes"));
    const payload = await searchDriveFiles(q, fileTypes, username);
    sendJson(res, 200, payload);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/drive/read-file") {
    const payload = await readJsonBody(req);
    const file = await readDriveFile(payload.fileId, payload.fileName, payload.mimeType, username);
    sendJson(res, 200, file);
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/drive/read-folder") {
    const payload = await readJsonBody(req);
    const fileTypes = parseDriveFileTypes(payload.fileTypes);
    const result = await readDriveFolder(payload.folderId, payload.folderName, fileTypes, username);
    sendJson(res, 200, result);
    return;
  }
  sendJson(res, 404, { error: "Drive route not found." });
}

async function handleQboApi(req, res, requestUrl) {
  const username = req.user?.username || "augusto";
  if (req.method === "GET" && requestUrl.pathname === "/api/qbo/status") {
    const companies = qboCompaniesForUser(username);
    sendJson(res, 200, { enabled: isQboEnabled(), connected: companies.length > 0, companies });
    return;
  }
  if (!isQboEnabled()) {
    sendJson(res, 503, { enabled: false, connected: false, error: "QuickBooks Online is not configured." });
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/qbo/disconnect") {
    deleteQboUser(username);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/qbo/companies") {
    sendJson(res, 200, { companies: qboCompaniesForUser(username) });
    return;
  }
  if (req.method === "GET" && requestUrl.pathname === "/api/qbo/reports/available") {
    sendJson(res, 200, availableQboReports());
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/qbo/reports/fetch") {
    const payload = await readJsonBody(req);
    const realmId = String(payload.realmId || "");
    const reportSpecs = Array.isArray(payload.reports) ? payload.reports : [];
    if (!realmId) { sendJson(res, 400, { error: "Select a QuickBooks company first." }); return; }
    const results = await Promise.all(reportSpecs.map(async (spec) => {
      try {
        return { report: await fetchQboReport(username, realmId, spec) };
      } catch (error) {
        return { error: { reportId: spec.reportId || "", error: error.message || "Report failed." } };
      }
    }));
    const reports = results.filter((item) => item.report).map((item) => item.report);
    const errors = results.filter((item) => item.error).map((item) => item.error);
    const company = getQboUserStore(username).companies?.[realmId];
    if (company) updateQboCompany(username, realmId, { ...company, lastSync: new Date().toISOString() });
    sendJson(res, 200, { ok: true, reports, errors });
    return;
  }
  // ── Descarga y normalización de reportes para el workpaper (qbo-connector) ──
  if (req.method === "POST" && requestUrl.pathname === "/api/qbo/fetch-financials") {
    const payload    = await readJsonBody(req);
    const realmId    = String(payload.realmId    || "");
    const taxYear    = Number(payload.taxYear    || new Date().getFullYear() - 1);
    const entityType = String(payload.entityType || "1120S");
    if (!realmId) { sendJson(res, 400, { error: "realmId es requerido." }); return; }
    const connector  = new QBOConnector();
    const requestFn  = (pathName, params) => qboRequest(username, realmId, pathName, params);
    const qboData    = await connector.fetchFinancials(requestFn, realmId, taxYear, entityType);
    const canonical  = connector.normalize(qboData);
    const company    = getQboUserStore(username).companies?.[realmId];
    if (company) updateQboCompany(username, realmId, { ...company, lastSync: new Date().toISOString() });
    sendJson(res, 200, { ok: true, canonical, errors: qboData.errors, fetchedAt: qboData.fetchedAt });
    return;
  }
  sendJson(res, 404, { error: "QBO route not found." });
}

// ── CCH Axcess Tax (Wolters Kluwer Open Integration Platform) ───────────────
// Reports whether the firm's OIP credentials, endpoints and field maps are in
// place. Every value comes from official CCH documentation — nothing is invented
// here, so the integration stays inert until those values are supplied.
function cchConfigStatus() {
  const CCH = require("./tax-loader/config/cchEndpoints");
  const isSet = (value) => Boolean(value) && !String(value).startsWith(CCH.SENTINEL);
  const env = {
    CCH_BASE_URL:            isSet(CCH.baseUrl),
    CCH_OAUTH_TOKEN_PATH:    isSet(CCH.oauth.tokenPath),
    CCH_OAUTH_GRANT_TYPE:    isSet(CCH.oauth.grantType),
    CCH_OAUTH_SCOPES:        isSet(CCH.oauth.scope),
    CCH_CLIENTS_SEARCH_PATH: isSet(CCH.paths.clientsSearch),
    CCH_CLIENTS_CREATE_PATH: isSet(CCH.paths.clientsCreate),
    CCH_RETURNS_CREATE_PATH: isSet(CCH.paths.returnsCreate),
    CCH_RETURN_INPUT_PATH:   isSet(CCH.paths.returnInput),
    CCH_RETURN_INPUT_METHOD: isSet(CCH.methods.returnInput),
    CCH_DIAGNOSTICS_PATH:    isSet(CCH.paths.diagnostics),
    CCH_CLIENT_ID:           isSet(process.env.CCH_CLIENT_ID),
    CCH_CLIENT_SECRET:       isSet(process.env.CCH_CLIENT_SECRET),
  };
  const fieldMaps = {};
  for (const entity of ["1040", "1065", "1120", "1120S"]) {
    try {
      const map = JSON.parse(fsSync.readFileSync(path.join(ROOT, "tax-loader", "fieldMaps", `cch_axcess_${entity}.json`), "utf8"));
      fieldMaps[entity] = map._verified === true;
    } catch (_) {
      fieldMaps[entity] = false;
    }
  }
  const missingEnv = Object.entries(env).filter(([, ok]) => !ok).map(([key]) => key);
  const unverifiedFieldMaps = Object.entries(fieldMaps).filter(([, ok]) => !ok).map(([key]) => key);
  return {
    configured: missingEnv.length === 0 && unverifiedFieldMaps.length === 0,
    missingEnv,
    unverifiedFieldMaps,
    env,
    fieldMaps,
  };
}

async function handleCchApi(req, res, requestUrl) {
  if (req.method === "GET" && requestUrl.pathname === "/api/cch/status") {
    sendJson(res, 200, cchConfigStatus());
    return;
  }
  if (req.method === "POST" && requestUrl.pathname === "/api/cch/push-return") {
    const status = cchConfigStatus();
    if (!status.configured) {
      sendJson(res, 503, {
        error: "CCH Axcess is not configured. Supply the OIP environment variables and complete the field maps before pushing returns.",
        missingEnv: status.missingEnv,
        unverifiedFieldMaps: status.unverifiedFieldMaps,
      });
      return;
    }
    const payload = await readJsonBody(req);
    const data = payload.data || payload;
    if (!data?.client?.entityType || !Array.isArray(data.fields)) {
      sendJson(res, 400, { error: "Body must be a CanonicalReturn with client.entityType and fields[]." });
      return;
    }
    try {
      const { CCHAxcessAdapter } = require("./tax-loader/adapters/cchAxcessAdapter");
      const adapter = new CCHAxcessAdapter({
        clientId:     String(process.env.CCH_CLIENT_ID || ""),
        clientSecret: String(process.env.CCH_CLIENT_SECRET || ""),
        apiKey:       String(process.env.CCH_API_KEY || ""),
      });
      const artifact = await adapter.prepare(data);
      const result = await adapter.load(artifact, data);
      sendJson(res, result.success ? 200 : 502, { ok: result.success, ...result });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "CCH push failed." });
    }
    return;
  }
  sendJson(res, 404, { error: "CCH route not found." });
}

async function handleAccountingAuthRoute(req, res, requestUrl) {
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  const softwareId = parts[2];
  const isCallback = parts[3] === "callback";
  const username = req.user?.username || getSession(req)?.username || "augusto";
  const software = ACCOUNTING_SOFTWARE[softwareId];
  if (!software) { sendHtml(res, 404, "<p>Accounting software not found.</p>"); return; }
  if (software.authType === "none") { redirect(res, "/?accounting=manual"); return; }
  if (software.authType !== "oauth2") {
    sendHtml(res, 400, `<p>${escapeHtml(software.name)} does not use a browser OAuth redirect. Configure it in environment variables and restart the app.</p>`);
    return;
  }
  if (!isCallback) {
    redirect(res, buildAccountingAuthUrl(softwareId, username));
    return;
  }
  const code = requestUrl.searchParams.get("code");
  const realmId = requestUrl.searchParams.get("realmId");
  let state = {};
  try { state = JSON.parse(Buffer.from(requestUrl.searchParams.get("state") || "", "base64url").toString("utf8")); } catch (_) {}
  // Verify the HMAC-signed state to prevent CSRF / login-CSRF (attacker attaching their connection to a victim).
  const stateUser = String(state.username || "");
  if (!stateUser || !safeEqual(String(state.sig || ""), hmac(`accounting:${softwareId}:${stateUser}`))) {
    sendHtml(res, 400, "<p>Accounting authorization failed state verification. Please retry the connection.</p>");
    return;
  }
  const owner = stateUser;
  if (!code) { sendHtml(res, 400, "<p>Accounting authorization did not return a code.</p>"); return; }
  const tokens = await exchangeAccountingToken(softwareId, code);
  if (softwareId === "quickbooks") {
    const qboTokens = normalizeQboTokens(tokens, realmId || "");
    writeQboTokenRecord(owner, realmId || "", qboTokens);
    let companyName = realmId || "QuickBooks company";
    try {
      const companyRes = await qboRequest(owner, realmId, `/companyinfo/${realmId}`);
      companyName = companyRes.CompanyInfo?.CompanyName || companyName;
    } catch (_) {}
    updateQboCompany(owner, realmId || "", { companyName, lastSync: new Date().toISOString() });
    sendHtml(res, 200, `<!doctype html><html><body><script>if (window.opener) window.opener.postMessage({type:"accounting_connected",software:"quickbooks"},"*"); window.close();</script><p>QuickBooks Online connected. You can close this tab.</p></body></html>`);
    return;
  }
  const companies = await fetchAccountingCompanies(softwareId, tokens).catch((error) => [{ id: "default", name: `${software.name} connected`, error: error.message }]);
  updateAccountingRecord(owner, softwareId, { tokens, companies, connectedAt: new Date().toISOString() });
  sendHtml(res, 200, `<!doctype html><html><body><script>if (window.opener) window.opener.postMessage({type:"accounting_connected",software:${JSON.stringify(softwareId)}},"*"); window.close();</script><p>${escapeHtml(software.name)} connected. You can close this tab.</p></body></html>`);
}

async function handleAccountingApi(req, res, requestUrl) {
  const username = req.user?.username || "augusto";
  const parts = requestUrl.pathname.split("/").filter(Boolean);
  if (req.method === "GET" && requestUrl.pathname === "/api/accounting/status") {
    const available = Object.values(ACCOUNTING_SOFTWARE).map((software) => accountingPublicSoftware(software, username));
    const connected = available.filter((item) => item.connected).map((item) => {
      const companies = item.softwareId === "quickbooks"
        ? qboCompaniesForUser(username).map((company) => ({ id: company.realmId, name: company.companyName || company.realmId }))
        : (getAccountingRecord(username, item.softwareId).companies || []);
      return { softwareId: item.softwareId, name: item.name, logo: item.logo, companies };
    });
    sendJson(res, 200, { connected, available });
    return;
  }
  if (parts.length === 4 && parts[2] === "reports" && parts[3] === "fetch" && req.method === "POST") {
    const payload = await readJsonBody(req);
    const softwareId = String(payload.softwareId || "quickbooks");
    const companyId = String(payload.companyId || "");
    const reportSpecs = Array.isArray(payload.reports) ? payload.reports : [];
    if (!companyId) { sendJson(res, 400, { error: "Select a company first." }); return; }
    const results = await Promise.allSettled(reportSpecs.map((spec) => fetchUnifiedAccountingReport(username, softwareId, companyId, spec)));
    const reports = [];
    const errors = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") reports.push(result.value);
      else errors.push({ reportId: reportSpecs[index]?.reportId || "", error: result.reason?.message || "Report failed." });
    });
    sendJson(res, 200, { ok: true, reports, errors });
    return;
  }
  if (parts.length === 5 && parts[2] === "reports" && parts[3] === "available" && req.method === "GET") {
    const softwareId = parts[4];
    sendJson(res, 200, accountingReportDefinitions(softwareId));
    return;
  }
  if (parts.length === 4 && parts[3] === "companies" && req.method === "GET") {
    const softwareId = parts[2];
    const companies = softwareId === "quickbooks"
      ? qboCompaniesForUser(username).map((company) => ({ id: company.realmId, name: company.companyName || company.realmId, currency: "", country: "" }))
      : (getAccountingRecord(username, softwareId).companies || []);
    sendJson(res, 200, { companies });
    return;
  }
  if (parts.length === 4 && parts[3] === "disconnect" && req.method === "POST") {
    const softwareId = parts[2];
    // Remove the local token record FIRST — that is what actually disconnects the user.
    // Provider-side revocation was previously awaited BEFORE deletion, so a slow or
    // unreachable Intuit/Xero revoke endpoint (the fetch had no timeout) hung the request
    // and the local token was never deleted — the UI then re-read the still-present token
    // and flipped back to "connected". Capture the tokens, delete locally, respond, then
    // revoke at the provider in the background where it cannot block or undo the disconnect.
    let tokensToRevoke = [];
    if (softwareId === "quickbooks") {
      const companies = getQboUserStore(username).companies || {};
      tokensToRevoke = Object.keys(companies).map((realmId) => companies[realmId]?.tokens || {});
      deleteQboUser(username);
    } else {
      const record = getAccountingRecord(username, softwareId);
      tokensToRevoke = [record.tokens || {}];
      deleteAccountingRecord(username, softwareId);
    }
    sendJson(res, 200, { ok: true });
    for (const tokens of tokensToRevoke) {
      revokeAccountingTokens(softwareId, tokens).catch(() => {});
    }
    return;
  }
  sendJson(res, 404, { error: "Accounting route not found." });
}

async function handleHealth(_req, res) {
  sendJson(res, 200, {
    ok: true,
    service: "ai-tax-agent",
    apiKeyConfigured: Boolean(String(process.env.ANTHROPIC_API_KEY || "").trim()),
    databaseConfigured: DATABASE_PERSISTENCE_ENABLED,
    databaseReady,
    databaseLastError: databaseSyncLastError ? "present" : "",
  });
}

async function handleReview(req, res) {
  try {
    const payload = await readJsonBody(req);
    const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();

    if (!apiKey) {
      sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." });
      return;
    }
    if (!Array.isArray(payload.files) || payload.files.length === 0) {
      sendJson(res, 400, { error: "Upload at least one document before starting the review." });
      return;
    }

    payload.files = annotateReviewFileRoles(payload.files || [], payload);
    let reviewRequest = buildDirectReviewRequest(payload, req);
    const startedAt = Date.now();
    // Keep the proxy connection alive during the long model call to avoid a 504.
    startHeartbeatResponse(res);
    // Firm context (master prompt form rules, Knowledge Base, Review Examples, historical
    // corrections) was previously only wired into an orphaned legacy call path
    // (callClaudeWithFallbacks) that nothing invoked — the UI advertised these as used in
    // every review but the actual review call never saw them. Built once per request and
    // marked cache_control:ephemeral since it is identical across reviews of the same
    // return type until an admin changes the uploads.
    const firmContext = await buildReviewFirmContextBlock(payload);
    // Both system blocks are static across runs — each carries a cache breakpoint so the
    // master prompt is cached even when the firm context is empty.
    const systemBlocks = [withReviewCache({ type: "text", text: reviewRequest.systemPrompt })];
    if (firmContext) systemBlocks.push(withReviewCache({ type: "text", text: firmContext }));
    let result = await callAnthropicDirectWithFallbacks(apiKey, {
      max_tokens: REVIEW_MAX_TOKENS,
      // Determinism: the review runs without extended thinking, so temperature 0 is
      // allowed and makes the same package produce the same findings run to run. The API
      // default of 1.0 was why two identical runs returned entirely different issues.
      temperature: 0,
      system: systemBlocks,
      messages: [{ role: "user", content: reviewRequest.userContent }],
    }, reviewModelCandidates());
    let retriedWithCompactPackage = false;
    if (!result.ok && isReviewTimeoutError(result)) {
      retriedWithCompactPackage = true;
      console.log(`[Review] first attempt did not complete (${result.error || "unknown"}) — retrying with a tighter extract.`);
      reviewRequest = buildDirectReviewRequest(payload, req, {
        maxTotalChars: REVIEW_RETRY_MAX_TOTAL_CHARS,
        maxCharsPerFile: REVIEW_RETRY_MAX_CHARS_PER_FILE,
        minCharsPerFile: REVIEW_RETRY_MIN_CHARS_PER_FILE,
      });
      const retrySystemBlocks = [{
        type: "text",
        text: `${reviewRequest.systemPrompt}\n\nThe first review attempt timed out. This retry uses a tighter document extract. Prioritize high-risk findings, tie-outs, missing support, elections, inconsistencies, and items that block filing. If detail is unavailable because a file was compacted, explicitly flag the document and area for manual follow-up.`,
        cache_control: { type: "ephemeral" },
      }];
      if (firmContext) retrySystemBlocks.push({ type: "text", text: firmContext, cache_control: { type: "ephemeral" } });
      result = await callAnthropicDirectWithFallbacks(apiKey, {
        max_tokens: REVIEW_MAX_TOKENS,
        temperature: 0,
        system: retrySystemBlocks,
        messages: [{ role: "user", content: reviewRequest.userContent }],
      }, reviewModelCandidates());
    }
    if (!result.ok) {
      endHeartbeatResponse(res, { error: result.error || "Claude API request failed." });
      return;
    }
    logClaudeCost(req, result, "review", "review", payload, startedAt);

    const cacheUsage = result?.data?.usage || {};
    const cacheWrote = Number(cacheUsage.cache_creation_input_tokens || 0);
    const cacheRead = Number(cacheUsage.cache_read_input_tokens || 0);
    if (cacheWrote || cacheRead) {
      // Written-but-never-read means the 25% write premium is pure cost. If this line keeps
      // showing writes with no reads, set REVIEW_CACHE_TTL=off (or =1h if runs cluster).
      console.log(`[Review] prompt cache (${REVIEW_CACHE_TTL}): wrote ${cacheWrote} token(s), read ${cacheRead}${cacheRead ? "" : " — no hit, the write premium bought nothing this run"}.`);
    }
    console.log("[Review] stop_reason:", result.data.stop_reason);
    console.log("[Review] content block types:", Array.isArray(result.data.content) ? result.data.content.map((block) => block.type) : []);

    const textBlocks = extractTextBlocksOnly(result.data);
    const truncated = result.data.stop_reason === "max_tokens";
    let review = normalizeDirectReview(parseClaudeJson(textBlocks), reviewRequest);
    // The package composition still goes to the server log every run; it no longer goes
    // into the client's document. It was put there because the one person who could
    // reproduce the problem had no access to the log, and it did its job: it showed the
    // attachments were being sent and the generation was not being truncated, which
    // ended six runs of guessing. A deliverable is not the place for it.
    let rawFallback = null;
    let finalResult = result;

    if (!hasDirectReviewContent(review) && textBlocks.trim()) {
      const fixStartedAt = Date.now();
      const fixed = await structureDirectReviewJson(apiKey, textBlocks, reviewRequest);
      if (fixed.ok) {
        logClaudeCost(req, fixed, "review", "review_structuring", payload, fixStartedAt);
        finalResult = fixed;
        const fixedText = extractTextBlocksOnly(fixed.data);
        review = normalizeDirectReview(parseClaudeJson(fixedText), reviewRequest);
      }
    }

    if (!hasDirectReviewContent(review)) {
      rawFallback = textBlocks || "(no text returned by model)";
      review = null;
    }

    const savedReviewHistory = review ? saveReviewHistoryFromResult(payload, review, rawFallback || textBlocks) : null;

    endHeartbeatResponse(res, {
      ok: true,
      review,
      structured: review,
      rawFallback,
      truncated,
      meta: reviewRequest.meta,
      documentsRead: reviewRequest.documentsRead,
      feedbackApplied: reviewRequest.feedbackApplied,
      retriedWithCompactPackage,
      model: finalResult.data.model || finalResult.model,
      usage: finalResult.data.usage || null,
      tokensUsed: Number(finalResult.data.usage?.input_tokens || 0) + Number(finalResult.data.usage?.output_tokens || 0),
      costEstimate: estimateClaudeCost(finalResult.data.usage || null),
      savedReviewHistory,
    });
  } catch (error) {
    console.error("[Review] route failed:", error);
    const message = error.expose ? error.message : `Review route failed: ${error.message || "Unexpected server error."}`;
    if (res._heartbeatActive) endHeartbeatResponse(res, { error: message });
    else sendJson(res, Number(error.statusCode) || 500, { error: message });
  }
}

function buildDirectReviewRequest(payload = {}, req, compactionLimits = {}) {
  const metadata = payload.metadata || {};
  const clientName = metadata.entityName || metadata.clientName || payload.clientName || "Unnamed client";
  // The Return type selector is often left blank; without a type there is no mandatory
  // tie-out checklist and no missing-line detection, so fall back to reading the identity
  // out of the return itself.
  const detectedReturnType = detectReturnTypeFromFiles(payload.files);
  const returnType = metadata.returnType || payload.returnType || detectedReturnType || "Not specified";
  const taxYear = metadata.taxYear || payload.taxYear || "Not specified";
  const reviewStage = metadata.reviewStage || payload.reviewStage || "Initial review";
  const state = metadata.state || metadata.statesIncluded || payload.state || "";
  const feedback = getReviewFeedbackForPayload(payload);
  const documents = compactReviewDocuments((payload.files || []).map((file) => ({
    name: String(file.name || "Uploaded file"),
    role: String(file.reviewRole || file.canonicalRole || file.role || "supporting_document"),
    mimeType: String(file.mediaType || file.mimeType || file.type || "application/octet-stream"),
    extractedText: String(file.extractedText || file.text || "").trim(),
    encoding: String(file.encoding || ""),
    size: Number(file.size || 0),
  })), compactionLimits);
  const meta = {
    clientName,
    returnType,
    taxYear,
    reviewStage,
    state,
    // Carried through so normalizeSeniorReviewServer can verify the model actually
    // addressed client facts rather than silently dropping them.
    clientFacts: String(metadata.clientFacts || "").trim(),
    generatedDate: new Date().toLocaleDateString("en-US"),
    reviewerName: req?.user?.displayName || getSession(req)?.displayName || "",
  };
  return {
    meta,
    documents,
    documentsRead: documents.map((file) => ({ name: file.name, filename: file.name, role: file.role })),
    feedbackApplied: feedback.map((entry) => entry.text).filter(Boolean),
    systemPrompt: buildDirectReviewSystemPrompt(returnType, state),
    userContent: buildDirectReviewUserContent(meta, documents, feedback, metadata, payload),
  };
}

async function buildReviewFirmContextBlock(payload = {}) {
  // includeBackendOnly defaults to true (omitted here) so proprietary reference files
  // (e.g. the firm's IRS instructions reference, agent notes) reach the model even though
  // they are hidden from the admin file-list UI.
  const [knowledgeBase, reviewExamples] = await Promise.all([
    loadContextFiles(KNOWLEDGE_BASE_DIR, "knowledge_base"),
    loadContextFiles(REVIEW_EXAMPLES_DIR, "review_examples"),
  ]);
  const masterPrompt = selectMasterPromptForReturn(payload);
  const dbLines = CORRECTIONS_DB.map((c, i) => `${i + 1}. [${c.stage.toUpperCase()}][${c.type}] ${c.client}: ${c.desc}`).join("\n");
  const sections = [];
  if (masterPrompt) {
    sections.push("=== FIRM MASTER REVIEW PROMPT: FORM-SPECIFIC RULES (AUTHORITY) ===", masterPrompt);
  }
  if (knowledgeBase.length) {
    sections.push(
      "=== CLIENT KNOWLEDGE BASE: TECHNICAL AUTHORITY ===",
      "Apply these files before general reasoning whenever they address an issue. Cite the file name in source when it supports a finding.",
      formatContextFiles(knowledgeBase)
    );
  }
  if (reviewExamples.length) {
    sections.push(
      "=== CLIENT REVIEW EXAMPLES: TONE AND FORMAT ONLY ===",
      "Use these only to match the firm's preferred wording, structure, and comment style. They are never tax authority — never copy facts, amounts, or findings from them into this review.",
      formatContextFiles(reviewExamples)
    );
  }
  if (CORRECTIONS_DB.length) {
    sections.push(
      `=== FIRM HISTORICAL CORRECTIONS DATABASE (${CORRECTIONS_DB.length} entries) ===`,
      "Real errors this firm has caught on past reviews. Use as pattern hints for what to check closely (addresses, K-1 %, officer comp, etc.) — not as technical authority.",
      dbLines
    );
  }
  return sections.join("\n\n");
}

function compactReviewDocuments(documents = [], limits = {}) {
  if (!Array.isArray(documents) || documents.length === 0) return [];
  const maxTotalChars = Number(limits.maxTotalChars || REVIEW_MAX_TOTAL_CHARS);
  const maxCharsPerFile = Number(limits.maxCharsPerFile || REVIEW_MAX_CHARS_PER_FILE);
  const minCharsPerFile = Number(limits.minCharsPerFile || REVIEW_MIN_CHARS_PER_FILE);
  const weights = documents.map((file) => reviewDocumentWeight(file.role));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || documents.length;
  const minBudget = Math.max(2000, minCharsPerFile);
  return documents.map((file, index) => {
    const originalText = String(file.extractedText || "");
    if (!originalText) return { ...file, originalTextLength: 0, compacted: false };
    const weightedBudget = Math.floor(maxTotalChars * (weights[index] / totalWeight));
    const budget = Math.max(minBudget, Math.min(maxCharsPerFile, weightedBudget));
    const compactedText = truncateMiddle(originalText, budget);
    const compacted = compactedText.length < originalText.length;
    const note = compacted
      ? `\n\n[SERVER NOTE: This document was compacted from ${originalText.length.toLocaleString("en-US")} to approximately ${compactedText.length.toLocaleString("en-US")} characters so the review can complete. The beginning and ending sections were preserved.]`
      : "";
    return {
      ...file,
      extractedText: compactedText + note,
      // Kept alongside the compacted copy for checks that run in CODE. Only the prompt has
      // a token budget; a regex does not, and feeding it the truncated middle of a return
      // is how the cross-year checks came back empty on a package whose prior-year Form
      // 8582 sits at 90% of the document, inside the part compaction removes.
      originalText,
      originalTextLength: originalText.length,
      compacted,
    };
  });
}

function reviewDocumentWeight(role) {
  const normalized = String(role || "").toLowerCase();
  if (normalized.includes("current_return") || normalized.includes("current_workpaper")) return 3;
  if (normalized.includes("prior_return") || normalized.includes("prior_workpaper")) return 1.5;
  return 1;
}

function buildDirectReviewSystemPrompt(returnType, state) {
  // The checklist is fixed in code (lib/tie-out.js) so two reviews of the same package
  // always compare the same lines instead of each run picking its own set.
  const checklist = tieOutChecklistPromptLines(returnType);
  const checklistBlock = checklist.length ? `\n\n${checklist.join("\n")}` : "";
  return `You are a senior tax return reviewer at a CPA firm with 20+ years of experience reviewing ${returnType || "US tax"} returns. You review with meticulous attention to detail - you catch errors a partner would catch and the ones they would miss.

WRITE LIKE A BUSY PARTNER, NOT A TREATISE. Every finding must be scannable in seconds. issueDescription is ONE short sentence naming what disagrees and the two amounts. Example of the ONLY acceptable style: "W-2 Box 1 shows $81,824.69 but return Line 1a shows $91,825; verify the entry." Do NOT write background, do NOT restate the same numbers in multiple fields, do NOT speculate about what an error "might indicate," do NOT chain hypotheticals. A finding longer than two sentences is wrong. Half-page findings are a failure.

PRIMARY AUTHORITY: Base every judgment on official IRS guidance (IRS.gov publications, instructions, IRC sections, Treasury regulations) and, where relevant, the official state tax authority for ${state || "the applicable state"}. Cite the specific authority for material findings.

You will be given multiple documents, each labeled with its role:
- current_return: the return you are reviewing.
- prior_return: last year's return for reference.
- current_workpaper: the numbers the current return must tie to.
- prior_workpaper: how amounts were derived last year.
- supporting_document: W-2, W-3, W-9, 1099, K-1, PIR, depreciation schedules, notices, and other support.

Read and understand EVERY document before writing anything.

FIRM CONTEXT PRIORITY: a second system block may follow with firm-specific context, in this priority order: (1) firm master review prompt and Knowledge Base = technical authority, apply before general reasoning when they address an issue; (2) historical corrections database = pattern hints for what to check closely, not authority; (3) review examples = tone and formatting reference ONLY, never copy facts or findings from them. If that block is absent, proceed on IRS/state authority and the documents provided.

REVIEW THE CURRENT YEAR RETURN FOR, at minimum:
1. Cross-document consistency: entity name, EIN/SSN, addresses, ownership percentages, tax year dates.
2. Every checkbox and election.
3. Numeric tie-out from the return to the current_workpaper — the mandatory checklist below is not optional.
4. Balance Sheet / Schedule L: assets must equal liabilities plus equity and beginning balances must tie to prior year.
5. M-1, M-2, and M-3 footings and requirements.
6. Supporting documents: decide whether each belongs on the return and whether it is reflected correctly.
7. Form-specific checks for ${returnType || "the return type"}.
8. Every firm feedback item provided.

CLIENT FACTS ARE MANDATORY TO CHECK (ABSOLUTE): every line under CLIENT FACTS TO VERIFY must be actively compared against the uploaded documents. If a client fact does not match what the documents show, you MUST report it — as an issues[] entry (priority per the rubric below) AND as an infoConsistency row with status MISMATCH. Never mark a client fact as MATCH without actually checking every digit/word against the documents, and never silently drop a client fact that does not match.

USER REVIEW INSTRUCTIONS ARE MANDATORY TASKS (ABSOLUTE): every request under USER REVIEW INSTRUCTIONS must be explicitly fulfilled in your JSON output, not just acknowledged. If the user asks for a list, summary, or specific extra output (e.g. "list every EIN and SSN found in the return"), produce that exact list as its own set of entries in verifiedItems (prefixed "REQUESTED: ") so it is impossible to miss. Do not skip a requested task because it does not fit neatly into another section.

ROUNDING RULE (ABSOLUTE): Differences of less than $1.00 on any line are IRS whole-dollar rounding and are CORRECT. Never report them as issues at any priority — not even to note that they are correct. A return line of $81,825 supported by a W-2 showing $81,824.69 is right, not wrong. Do NOT create an issues[] entry whose own conclusion is "this is correct" or "no correction needed" — if you find yourself writing that, delete the issue and put the line in verifiedItems or the Numeric Tie-Out (status TIE) instead. An issue exists only to report something that needs a person's attention.

PRIORITY RUBRIC:
- HIGH: a CONFIRMED error that changes the tax outcome or blocks filing — a tie-out that does not reconcile against a document you have, a wrong SSN/EIN, an unfiled election that was required, a material amount ($100+) that actively contradicts a document you have.
- MEDIUM: needs verification, not yet confirmed wrong — a K-1 or other source document not yet provided so an amount cannot be checked, documentation the reviewer must confirm exists, a prior-year inconsistency without a clear explanation. Missing a supporting document is MEDIUM, not HIGH, unless the amount on the return actively contradicts a document you DO have.
- LOW: informational — formatting, address style variations, presentation. Never escalate a LOW item by speculating about what it "might indicate."
Do not use missing-document language for a form you can see in the documents. If a form is referenced (e.g., in the forms list of the client letter) and its pages appear in the return package, it is NOT missing.

NO DUPLICATE ISSUES: one root cause is ONE issue. If a wrong amount also causes a wrong penalty or a wrong downstream total, that is a single issue — state the cause and mention the downstream effect in the same issueDescription, never as a second issue. Before finalizing, scan your issues array and merge any two issues that reference the same line, the same document, or the same underlying number.

ENTITY-TYPE GUARD: only compare identifiers that apply to the entity in question. Do not compare an EIN against an individual's SSN (or vice versa) unless the source explicitly labels them as the same identifier — if a client fact is ambiguous or refers to a different entity than the one on the return, note it under openQuestions instead of issues.

CONCISENESS (ABSOLUTE): issueDescription is 1-2 sentences maximum stating what disagrees, the two amounts, and which documents: "W-2 Box 1 shows $81,824.69 but the return Line 1a shows $91,825; verify the entry." evidence lists only the line references and amounts. riskAnalysis is one sentence maximum and empty for LOW items. proposedSolution is one sentence. No essays, no repetition of the same numbers across fields, no speculative chains.

CHECKBOX CHECKLIST (REQUIRED): Examine EVERY checkbox and election on the current-year return against the prior-year return, then report in checkboxReview ONLY the ones that are wrong, doubtful, or a real elective choice the reviewer should confirm. Do NOT list boxes that are plainly correct — a page of rows reading "Correct" hides the one row that matters, and every such row is a claim that can itself be wrong. Add ONE final row with box "Boxes verified as correct", currentState = the count you checked and found correct, shouldBe = "No action", explanation = a short list of the areas covered, so the reviewer can see the scope of the check. currentState = what the current return shows (e.g. "Checked" or "No"), shouldBe = ONLY the expected value itself (e.g. "Checked" or "No") with no leading label and no restated question, explanation = one short sentence giving the reason. shouldBe and explanation must never contradict each other.

INFORMATIONAL DATA CHECK (REQUIRED): Verify every informational item across ALL documents — taxpayer/entity name, SSN/EIN, address, tax year dates, filing status, ownership and K-1 percentages, bank account info. Report in infoConsistency: (a) every MISMATCH, with the exact values compared; (b) every item named under CLIENT FACTS TO VERIFY, matched or not; (c) one final row with item "Identifiers verified as matching", status MATCH, and note = the count and a short list of what was checked. Do not spend a row per identifier that matches — the reviewer needs the exceptions and the scope, not a transcript.${checklistBlock}

For each error, provide risk analysis and a specific proposed solution within the length limits above.

CRITICAL OUTPUT RULE: Return your COMPLETE review as a single valid JSON object matching the schema in the user message. Every field is required. The issues array must list every finding. Do not return an empty issues array for a return that has problems. Write every string in clear, complete English. Do not write prose outside the JSON. Return ONLY the JSON object.`;
}

function buildDirectReviewUserContent(meta, documents, feedback, metadata = {}, scanSource = {}) {
  const feedbackBlock = feedback.length ? feedback.map((entry, index) => `${index + 1}. ${entry.text}`).join("\n") : "None on file";
  const userNotes = String(metadata.userNotes || "").trim();
  const clientFacts = String(metadata.clientFacts || "").trim();
  const docsBlock = documents.map((file, index) => {
    const body = file.extractedText
      ? file.extractedText
      : `[No readable extracted text was available. Encoding: ${file.encoding || "unknown"}; MIME: ${file.mimeType}; Size: ${file.size} bytes. If this document is material, flag it for manual review.]`;
    return [
      `=== DOCUMENT ${index + 1}: ${file.name} (role: ${file.role}) ===`,
      `MIME: ${file.mimeType}`,
      body,
    ].join("\n");
  }).join("\n\n");
  // Two blocks, ON PURPOSE: the heavy, stable part (client meta + firm feedback + the
  // full document package — routinely ~100k tokens) goes FIRST and carries the prompt-
  // cache breakpoint; the volatile part (this run's instructions/facts + schema) goes
  // after it. Re-running the same package with tweaked instructions — the most common
  // real workflow — then re-reads the documents from cache at ~10% of the input price
  // instead of paying full price every run.
  const stablePrefix = [
    "REVIEW REQUEST",
    `Client: ${meta.clientName}`,
    `Return Type: ${meta.returnType}`,
    `Tax Year: ${meta.taxYear}`,
    `Review Stage: ${meta.reviewStage}`,
    `State: ${meta.state || "Not specified"}`,
    "",
    "FIRM REVIEW FEEDBACK TO APPLY:",
    feedbackBlock,
    "",
    "DOCUMENTS:",
    docsBlock,
  ].join("\n");
  // Image-only PDFs go in as native documents so the model can actually read them.
  // The browser already ships their bytes (prepareFileForReview -> scannedPdfBase64) and
  // the Preparation tab already attached them; Review was the one tab that did not, which
  // is why scanned uploads kept coming back reported as "not provided".
  const { scannedDocs, skippedScans } = collectScannedPdfDocuments(scanSource);
  // Named once more in the LAST block the model reads before the schema.
  //
  // The attachments sit behind ~90k tokens of document text, and whether the model opens
  // them varies run to run on a byte-identical request: two reviews of this package quoted
  // every scanned page, the next three reported those same documents as "not provided". The
  // request did not change between them — a timeout did, which decides only which prompt
  // gets answered, and both of those runs answered the same one. Recency is the cheap lever
  // against a long prompt: the last instruction is the one that survives it.
  const scanReminder = scannedDocs.length
    ? `BEFORE YOU CONCLUDE: ${scannedDocs.length} scanned PDF(s) are attached to this message (${scannedDocs.map((d) => d.name).join("; ")}). They are images, so nothing printed inside them appears in the document text above. A form found inside an attachment is support that WAS provided: reporting it as missing is a false finding, and so is a tie-out that leaves it out of the total.
REQUIRED, and do this before writing any issue: for EACH attached PDF, add ONE line to verifiedItems, prefixed "SCANNED:", naming the file and then every form on every page of it with its key figures — e.g. "SCANNED: taxes.pdf — p1 1099-INT Capital One $1,699.30; p2 1098 First National $35,048.14 (610 Piedmont); p3 1098 CMG $37,513.99 (26350 Cat Tail Dr); p4 Fort Bend 2025 tax bill $23,055.92; p5 Galveston 2025 tax bill $9,445.41". Number the pages you actually saw and never skip one: if page 2 holds a form, page 2 must appear in that line. One scanned file routinely holds several unrelated forms and its filename names at most one of them, so page 1 is never the whole story. Keep each line to figures, no commentary.
TRANSCRIBE, DO NOT INFER. Copy each figure digit by digit from the image and copy the form type from its printed title. Do not guess a document's contents from its filename: a file called "Health Benefits" turned out to hold a W-2, and a review that assumed otherwise reported dollar amounts that appear nowhere in it. If a figure is not legible, write "illegible" rather than a number.
A figure you read off an image is NOT verified support. Reading scans is error-prone — real runs have turned $1,699.30 into $699.70, $37,513.99 into $0, and $9,445.41 into $99,445.41 — and a misread number silently becomes a false finding. So: any tie-out line whose support comes from a scanned attachment must be reported with status NOT VERIFIED and a note naming the file and page, however confident you feel. State the figure, cite where it came from, and let the reviewer confirm it against the document.\n`
    : "";
  const volatileSuffix = [
    scanReminder,
    userNotes ? `USER REVIEW INSTRUCTIONS:\n${userNotes}\n` : "",
    clientFacts ? `CLIENT FACTS TO VERIFY:\n${clientFacts}\n` : "",
    "Return the complete senior review as JSON in exactly this schema:",
    reviewJsonSchemaText(),
  ].filter(Boolean).join("\n");
  // Logged every run. Two consecutive reviews of the same package disagreed on whether the
  // scanned documents had been read, and the output alone could not tell "the model ignored
  // the attachments" from "the attachments never left the browser".
  const withText = (scanSource.files || []).filter((f) => String(f.text || "").trim().length > 40).length;
  console.log(`[Review] package: ${(scanSource.files || []).length} file(s), ${withText} with extractable text, ${scannedDocs.length} scan(s) attached as PDF (${Math.round(scannedDocs.reduce((n, d) => n + d.bytes, 0) / 1024)} KB)${skippedScans.length ? `, ${skippedScans.length} skipped for size: ${skippedScans.join("; ")}` : ""}${(metadata.scanDropped || []).length ? `, ${metadata.scanDropped.length} DROPPED IN BROWSER: ${metadata.scanDropped.join("; ")}` : ""}.`);
  const blocks = [{ type: "text", text: stablePrefix }];
  if (scannedDocs.length) {
    blocks.push({
      type: "text",
      text: `SCANNED SOURCE DOCUMENTS ATTACHED (${scannedDocs.length}): these uploads are image-based PDFs with no extractable text, attached below as documents. READ THEM VISUALLY and pull every reportable figure exactly as printed — payer, form type, box numbers, amounts, withholding. One scanned file routinely holds SEVERAL unrelated forms on different pages — a 1099-INT on page 1, a 1098 on page 3, a property tax bill on page 5 — and its filename usually names only one of them, or none. Work through every page of every attachment before concluding anything is missing. A W-2, a 1098 or a 1099 inside one of these is support that WAS provided: do NOT report it as missing, and do include it when you total a tie-out line. Read them; do NOT transcribe them: never spend executiveSummary, finalConclusion or an issue on an inventory of what the package contains. The reviewer already has the documents. Your output budget is for findings and tie-outs, and a summary that lists documents instead of conclusions is a failed review. Files: ${scannedDocs.map((d) => d.name).join("; ")}.${skippedScans.length ? ` NOT ATTACHED (over size limits — report these as unreviewed): ${skippedScans.join("; ")}.` : ""}`,
    });
    for (const doc of scannedDocs) {
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.data }, title: doc.name.slice(0, 120) });
    }
  }
  // The cache breakpoint goes on the LAST stable block, so the documents are cached too.
  // Put it on the volatile suffix and the PDFs get re-uploaded at full price every run.
  blocks[blocks.length - 1] = withReviewCache(blocks[blocks.length - 1]);
  blocks.push({ type: "text", text: volatileSuffix });
  return blocks;
}

/**
 * Rebuilds a non-streaming response shape out of the SSE event stream, so every caller
 * downstream keeps reading `data.content[].text`, `data.usage` and `data.stop_reason`
 * exactly as before. Streaming is a transport change here, not an interface change.
 */
async function readAnthropicStream(res, onActivity) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const blocks = [];
  let usage = {};
  let stopReason = null;
  let model = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (onActivity) onActivity();
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event;
      try { event = JSON.parse(payload); } catch (_) { continue; }
      if (event.type === "message_start") {
        model = event.message?.model || model;
        usage = { ...usage, ...(event.message?.usage || {}) };
      } else if (event.type === "content_block_start") {
        blocks[event.index] = { type: event.content_block?.type || "text", text: event.content_block?.text || "" };
      } else if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        if (!blocks[event.index]) blocks[event.index] = { type: "text", text: "" };
        blocks[event.index].text += event.delta.text || "";
      } else if (event.type === "message_delta") {
        stopReason = event.delta?.stop_reason ?? stopReason;
        usage = { ...usage, ...(event.usage || {}) };
      } else if (event.type === "error") {
        throw new Error(event.error?.message || "Anthropic stream error");
      }
    }
  }
  return { content: blocks.filter(Boolean), usage, stop_reason: stopReason, model };
}

async function callAnthropicDirect(apiKey, requestBody) {
  const controller = new AbortController();
  // Streaming for long generations, and the timeout becomes an IDLE timeout rather than a
  // total one. A review generating ~14k output tokens takes 4-5 minutes; against a 5-minute
  // total cap it aborted a breath from finishing, and the timeout handler then rebuilt the
  // whole request and ran it again — which is how a single review came to take 15 minutes.
  // While tokens keep arriving the request is alive by definition; only real silence is a
  // hang. Same request, same response shape, roughly half the wall time.
  const wantsStream = Number(requestBody?.max_tokens || 0) >= STREAM_ABOVE_MAX_TOKENS;
  const body = wantsStream ? { ...requestBody, stream: true } : requestBody;
  let timer = null;
  const armTimer = (ms) => { if (timer) clearTimeout(timer); timer = setTimeout(() => controller.abort(), ms); };
  armTimer(ANTHROPIC_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-beta": "prompt-caching-2024-07-31",
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (res.ok && wantsStream) {
      const data = await readAnthropicStream(res, () => armTimer(ANTHROPIC_STREAM_IDLE_TIMEOUT_MS));
      return { ok: true, data, model: data.model || requestBody.model };
    }
    const raw = await res.text().catch(() => "");
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (_) {
      data = { raw: raw.slice(0, 1000) };
    }
    if (res.ok) return { ok: true, data, model: data.model || requestBody.model };
    const errorMessage = data.error?.message || data.message || data.raw || `Claude API returned HTTP ${res.status}.`;
    // Pass retry-after header upstream so the fallback loop can use it.
    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    return { ok: false, status: Number(res.status) || 502, error: errorMessage, retryAfterMs };
  } catch (error) {
    console.error("[Review] Anthropic request failed:", error);
    const timedOut = error?.name === "AbortError";
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      error: timedOut
        ? `Claude review timed out after ${Math.round(ANTHROPIC_REQUEST_TIMEOUT_MS / 1000)} seconds. The uploaded package was received, but the model did not finish in time. Please rerun the review; the server now compacts large files automatically.`
        : `Claude request failed before a response was received: ${error.message || "network/request error"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callAnthropicDirectWithFallbacks(apiKey, requestBody, models = MODEL_FALLBACKS, { userId = "unknown", feature = "review" } = {}) {
  const candidates = Array.from(new Set((models || []).filter(Boolean)));
  let lastError = "Claude API request failed.";
  let lastStatus = 500;
  const attempts = [];
  const MAX_429_RETRIES = 3;
  const BACKOFF_MS = [1000, 2000, 4000];

  for (const model of candidates) {
    const body = { ...requestBody, model };
    if (body.thinking && !supportsClaudeThinking(model)) delete body.thinking;
    // The API rejects an explicit temperature together with extended thinking.
    if (body.thinking) delete body.temperature;

    let triedNextModel = false;
    for (let attempt = 1; attempt <= MAX_429_RETRIES + 1; attempt++) {
      const result = await callAnthropicDirect(apiKey, body);
      if (result.ok) return result;
      lastError = `Model ${model}: ${result.error}`;
      lastStatus = result.status || 500;

      if (isRateLimitError(lastStatus, result.error)) {
        if (attempt <= MAX_429_RETRIES) {
          const baseMs = result.retryAfterMs || BACKOFF_MS[attempt - 1];
          const waitMs = baseMs + Math.floor(Math.random() * 500);
          console.log(`[RETRY] model=${model} attempt=${attempt}/${MAX_429_RETRIES} waitMs=${waitMs} userId=${userId} feature=${feature}`);
          await sleep(waitMs);
          continue;
        }
        triedNextModel = true;
        break;
      }
      // Same treatment for a network stumble: retry the same model before giving up.
      if (isTransientNetworkError(lastStatus, result.error) && attempt <= MAX_429_RETRIES) {
        const waitMs = (BACKOFF_MS[attempt - 1] || 4000) + Math.floor(Math.random() * 400);
        console.log(`[RETRY-NET] model=${model} attempt=${attempt}/${MAX_429_RETRIES} waitMs=${waitMs} userId=${userId} feature=${feature}`);
        await sleep(waitMs);
        continue;
      }
      if (!shouldTryNextModel(lastStatus, result.error)) {
        attempts.push(lastError);
        return { ok: false, status: lastStatus, error: `${lastError} Tried: ${candidates.join(", ")}. Details: ${attempts.join(" | ")}` };
      }
      triedNextModel = true;
      break;
    }
    attempts.push(lastError);
    if (!triedNextModel) break;
  }
  return { ok: false, status: lastStatus, error: `${lastError} Tried: ${candidates.join(", ")}. Details: ${attempts.join(" | ")}` };
}

function isReviewTimeoutError(result) {
  return Number(result?.status) === 504 || /timed out|abort/i.test(String(result?.error || ""));
}

function reviewModelCandidates() {
  // Si el modelo primario falla, la review NO devuelve error: cae al siguiente de la
  // lista y entrega igual. Por eso el ORDEN es una decision de calidad, no de plumbing:
  // un Haiku en segunda posicion seria una degradacion silenciosa. Haiku va ultimo,
  // como red de seguridad para no perder la corrida, nunca como plan B.
  const isHaiku = (model) => /^claude-haiku/i.test(String(model || ""));
  const reviewSafeFallbacks = MODEL_FALLBACKS.filter((model) =>
    !/^claude-opus/i.test(model) && !/^claude-sonnet-4-6$/i.test(model) && !isHaiku(model)
  );
  return Array.from(new Set([
    "claude-sonnet-4-5-20250929",
    ...reviewSafeFallbacks,
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
  ].filter(Boolean)));
}

function supportsClaudeThinking(model) {
  return /^claude-(opus|sonnet)-4/i.test(String(model || "")) || /^claude-haiku-4-5/i.test(String(model || ""));
}

function extractTextBlocksOnly(data) {
  if (!Array.isArray(data?.content)) {
    console.error("[Review] Response had no content array:", JSON.stringify(data || {}).slice(0, 2000));
    return "";
  }
  const text = data.content.filter((block) => block.type === "text" && block.text).map((block) => block.text).join("\n");
  if (!text.trim()) console.error("[Review] NO TEXT BLOCKS. Full content:", JSON.stringify(data.content).slice(0, 2000));
  return text.trim();
}

async function structureDirectReviewJson(apiKey, textBlocks, reviewRequest) {
  // This is a purely mechanical text->JSON reformat of a review Sonnet already wrote.
  // The tax analysis was done in the first call; here we only restructure existing text
  // into the schema, so Haiku handles it identically at ~1/3 the cost. Sonnet stays as a
  // fallback so reliability is unchanged if Haiku ever fails to produce valid JSON.
  return callAnthropicDirectWithFallbacks(apiKey, {
    max_tokens: 16000,
    temperature: 0, // mechanical reformat — no reason for sampling variance
    system: "You convert a tax review into strict JSON. Output ONLY the JSON object matching the schema the user provides. No prose, no fences.",
    messages: [{ role: "user", content: `SCHEMA:\n${reviewJsonSchemaText()}\n\nREVIEW TO CONVERT:\n${String(textBlocks || "").slice(0, 50000)}\n\nDOCUMENTS READ:\n${reviewRequest.documentsRead.map((doc) => `${doc.name} - ${doc.role}`).join("\n")}` }],
  }, structureModelCandidates());
}

function structureModelCandidates() {
  // Haiku first (cheap, sufficient for reformatting), then the normal review models as
  // a safety net so a Haiku hiccup never blocks the review from completing.
  return Array.from(new Set([
    "claude-haiku-4-5-20251001",
    ...reviewModelCandidates(),
  ].filter(Boolean)));
}

function normalizeDirectReview(review, reviewRequest) {
  if (!review || typeof review !== "object") return null;
  const normalized = normalizeSeniorReviewServer(review, { metadata: reviewRequest.meta, files: reviewRequest.documents.map((file) => ({ name: file.name, reviewRole: file.role, text: file.extractedText, fullText: file.originalText || file.extractedText, encoding: file.encoding, mediaType: file.mimeType, size: file.size })) }) || {};
  normalized.clientName = normalized.clientName || reviewRequest.meta.clientName;
  normalized.returnType = normalized.returnType || reviewRequest.meta.returnType;
  normalized.taxYear = normalized.taxYear || reviewRequest.meta.taxYear;
  normalized.reviewStage = normalized.reviewStage || reviewRequest.meta.reviewStage;
  normalized.generatedDate = normalized.generatedDate || reviewRequest.meta.generatedDate;
  normalized.reviewerName = normalized.reviewerName || reviewRequest.meta.reviewerName || "RAG Tax AI";
  if (!Array.isArray(normalized.documentsRead) || !normalized.documentsRead.length) {
    normalized.documentsRead = reviewRequest.documentsRead.map((doc) => ({ filename: doc.name, role: doc.role, summary: "Included in the review package." }));
  }
  if (!Array.isArray(normalized.feedbackApplied)) normalized.feedbackApplied = reviewRequest.feedbackApplied;
  return normalized;
}

function hasDirectReviewContent(review) {
  if (!review || typeof review !== "object") return false;
  const text = [review.executiveSummary, review.finalConclusion, review.overallRiskScore].filter(Boolean).join(" ");
  const hasText = /\S/.test(text) && !/no executive summary provided|no issue list was returned/i.test(text);
  return hasText || (Array.isArray(review.issues) && review.issues.length > 0);
}

function isUsableSeniorReview(structured, payload = {}) {
  if (!structured || typeof structured !== "object") return false;
  const docsRead = Array.isArray(structured.documentsRead) ? structured.documentsRead : [];
  const issues = Array.isArray(structured.issues) ? structured.issues : [];
  const checkbox = Array.isArray(structured.checkboxReview) ? structured.checkboxReview : [];
  const tieOut = Array.isArray(structured.tieOutResults) ? structured.tieOutResults : [];
  const verified = Array.isArray(structured.verifiedItems) ? structured.verifiedItems : [];
  const missing = Array.isArray(structured.missingDocuments) ? structured.missingDocuments : [];
  const open = Array.isArray(structured.openQuestions) ? structured.openQuestions : [];
  const hasBalance = structured.balanceSheetCheck && typeof structured.balanceSheetCheck === "object";
  const hasDocuments = docsRead.length > 0;
  const hasReviewWork = issues.length || checkbox.length || tieOut.length || verified.length || missing.length || open.length || hasBalance;
  const emptyLanguage = /no issues were identified|none noted|review complete/i.test([
    structured.executiveSummary,
    structured.finalConclusion,
    structured.overallRiskScore,
  ].filter(Boolean).join(" "));
  return hasDocuments && hasReviewWork && !(emptyLanguage && !issues.length && !checkbox.length && !tieOut.length && !hasBalance && !verified.length && !missing.length && !open.length);
}

function normalizeSeniorReviewServer(structured, payload = {}) {
  if (!structured || typeof structured !== "object") return structured;
  const normalized = { ...structured };
  if (!Array.isArray(normalized.documentsRead) || !normalized.documentsRead.length) {
    const documentSummary = Array.isArray(normalized.documentSummary) ? normalized.documentSummary : Array.isArray(normalized.documentsReviewed) ? normalized.documentsReviewed : [];
    normalized.documentsRead = documentSummary.length
      ? documentSummary.map((item, index) => ({
        filename: `Document ${index + 1}`,
        role: "unknown",
        summary: typeof item === "object" ? JSON.stringify(item) : String(item || ""),
      }))
      : buildDocumentsReadFromPayload(payload);
  }
  if (!Array.isArray(normalized.verifiedItems) && Array.isArray(normalized.reviewerComments)) normalized.verifiedItems = normalized.reviewerComments;
  if (!Array.isArray(normalized.openQuestions) && Array.isArray(normalized.questions)) normalized.openQuestions = normalized.questions;
  if (!Array.isArray(normalized.missingDocuments) && Array.isArray(normalized.missingInformation)) normalized.missingDocuments = normalized.missingInformation;
  if (!Array.isArray(normalized.checkboxReview)) normalized.checkboxReview = [];
  if (!Array.isArray(normalized.infoConsistency)) normalized.infoConsistency = [];
  if (!Array.isArray(normalized.tieOutResults)) normalized.tieOutResults = [];
  // Every required tie-out line must appear, even when the review skipped it: a silently
  // missing check used to read as "nothing wrong there".
  const reviewReturnType = payload?.metadata?.returnType || payload?.returnType || detectReturnTypeFromFiles(payload?.files);
  const requiredRows = ensureRequiredTieOutRows(normalized.tieOutResults, reviewReturnType);
  normalized.tieOutResults = requiredRows.rows;
  if (requiredRows.added) console.log(`[Review] ${requiredRows.added} required tie-out line(s) were missing and added as unverified.`);
  // Arithmetic verdicts, roll-up coherence (a total cannot tie while its components do
  // not) and unsupported-tie annotation are decided by code, not by the model.
  const verdicts = enforceNumericVerdicts(normalized, reviewReturnType, payload?.files);
  normalized.tieOutResults = verdicts.review.tieOutResults;
  if (verdicts.review.balanceSheetCheck) normalized.balanceSheetCheck = verdicts.review.balanceSheetCheck;
  if (verdicts.corrections) console.log(`[Review] recomputed ${verdicts.corrections} numeric verdict(s) that disagreed with the arithmetic.`);
  if (verdicts.unevidenced) console.log(`[Review] ${verdicts.unevidenced} tie-out row(s) cited evidence that does not hold up against the uploaded files.`);
  if (verdicts.badArithmetic) console.log(`[Review] ${verdicts.badArithmetic} tie-out row(s) showed a derivation that does not add up.`);

  // Coverage: a file nobody opened cannot have been reviewed, and the review's own prose
  // will never say so. Counted here and surfaced as open questions so it reaches the
  // reviewer even where the UI has no dedicated section for it.
  // Cross-year and cross-form checks run in code, not in the prompt. The model found the
  // suspended-loss carryforward in one run out of three of the SAME package; these fire
  // every time. They are appended rather than merged so a deterministic finding is never
  // displaced by the model's own list being long.
  // Two families, gated by return type so neither can fire on the other's forms: the 1040
  // checks key off Schedule 8582/7203/8960 and W-2s, the entity checks off Schedule L, M-2,
  // the K-1s and Form 8825. A package only ever satisfies one of them.
  // Runs over the finished review, before the deterministic findings are prepended: a claim
  // that a figure is absent from the return is checked against the return, and a downgraded
  // finding carries the line that contradicts it.
  const absence = verifyAbsenceClaims(normalized, payload?.files);
  if (absence.corrected) {
    normalized.issues = absence.issues;
    console.log(`[Review] ${absence.corrected} finding(s) claimed a figure was absent from a return that prints it; lowered to LOW.`);
  }

  // The same error about a form rather than a figure, which the check above cannot see
  // because such a finding names no dollar amount.
  const attachments = verifyAttachmentClaims(normalized, payload?.files);
  if (attachments.corrected) {
    normalized.issues = attachments.issues;
    console.log(`[Review] ${attachments.corrected} finding(s) reported a form as missing that is in the package; lowered to LOW.`);
  }

  const individualChecks = runPriorYearChecks(payload?.files, payload?.metadata || {});
  const entityChecks = runEntityReturnChecks(payload?.files, payload?.metadata || {});
  // Only meaningful when the continuity check actually compared two returns: an empty result
  // because there was no prior return says nothing about whether the balances tie.
  const continuity = verifyContinuityClaims(normalized, {
    continuityRan: Boolean(entityChecks.identified && entityChecks.identified.prior),
    continuityFindings: entityChecks.filter((f) => f.category === "Prior-year continuity"),
  });
  if (continuity.corrected) {
    normalized.issues = continuity.issues;
    console.log(`[Review] ${continuity.corrected} finding(s) claimed a continuity break that the balance-sheet check had already ruled out; lowered to LOW.`);
  }
  // Not gated by return type: a stated position contradicting another stated position reads
  // the same on a 1065 as on an 1120-S, and each check is anchored on text that only its own
  // form prints, so a package without that form produces nothing.
  const consistencyChecks = runReturnConsistencyChecks(payload?.files, payload?.metadata || {});
  const bridged = [...individualChecks, ...entityChecks, ...consistencyChecks, checkUnusedReconcilingLines(payload?.files)].filter(Boolean);
  bridged.identified = individualChecks.identified || entityChecks.identified;
  if (bridged.length) {
    normalized.issues = Array.isArray(normalized.issues) ? normalized.issues : [];
    const seen = new Set(normalized.issues.map((i) => String(i?.issueDescription || "").slice(0, 60).toLowerCase()));
    for (const finding of bridged) {
      if (seen.has(String(finding.detail).slice(0, 60).toLowerCase())) continue;
      normalized.issues.unshift({
        priority: finding.severity,
        category: finding.category,
        areaReviewed: finding.category,
        formOrSchedule: finding.title,
        issueDescription: finding.detail,
        evidence: "Computed by RAG Tax AI directly from the filed returns in this package, not by the language model.",
        riskAnalysis: "This check runs deterministically on every review. Confirm the figures against the forms before acting.",
        proposedSolution: finding.action,
        authority: finding.authority,
        source: "Automated cross-year check",
        needsMoreInfo: "",
      });
    }
    console.log(`[Review] ${bridged.length} deterministic cross-year finding(s) added.`);
  }
  // Always logged, findings or none: a silent zero was indistinguishable from "nothing to
  // find" and cost two production round-trips to diagnose.
  if (bridged.identified) {
    const id = bridged.identified;
    console.log(`[Review] cross-year inputs — current: ${id.current || "NOT FOUND"}; prior: ${id.prior || "NOT FOUND"}${id.byContent ? " (identified by content; file roles were not set)" : ""}.`);
  }

  const coverage = auditDocumentCoverage(normalized, payload?.files);
  if (coverage.coverage.length) {
    normalized.documentCoverage = coverage.coverage;
    normalized.openQuestions = Array.isArray(normalized.openQuestions) ? normalized.openQuestions : [];
    if (coverage.unreviewed.length) {
      const notRead = coverage.unreviewed.map((c) => c.name);
      normalized.openQuestions = Array.isArray(normalized.openQuestions) ? normalized.openQuestions : [];
      normalized.openQuestions.unshift(`${notRead.length} uploaded document(s) are not listed as read by this review: ${notRead.join("; ")}. A tie-out cannot be complete if the supporting document was never opened — confirm whether these affect the return.`);
      console.log(`[Review] document coverage: ${coverage.unreviewed.length} of ${coverage.coverage.length} file(s) unreferenced.`);
    }
    // Separate, and the one signal the model cannot talk its way past: these files carry no
    // extractable text, so the review never saw their contents whatever it claims. In a real
    // package this is where the Form 1098, a 1099-INT and a fourth W-2 were hiding, and the
    // review reported all three as "not provided".
    if (coverage.unreadable.length) {
      const names = coverage.unreadable.map((c) => c.name);
      normalized.openQuestions.unshift(`${names.length} uploaded document(s) are scanned images with no extractable text and were NOT read by this review: ${names.join("; ")}. Any conclusion that a document is "missing" may simply mean it is inside one of these files — open them by hand before requesting anything from the client.`);
      console.log(`[Review] ${names.length} uploaded file(s) had no extractable text.`);
    }
  }
  if (!normalized.balanceSheetCheck && hasBalanceSheetRelevantFiles(payload)) {
    normalized.balanceSheetCheck = {
      totalAssets: null,
      totalLiabEquity: null,
      balanced: false,
      difference: null,
      note: "Balance sheet check was required but Claude did not return a Schedule L tie-out. Treat this item as needing reviewer follow-up.",
    };
    normalized.openQuestions = Array.isArray(normalized.openQuestions) ? normalized.openQuestions : [];
    normalized.openQuestions.push("Complete and document the Schedule L balance sheet tie-out because the AI response did not return one.");
  }
  const clientFacts = String(payload.metadata?.clientFacts || "").trim();
  if (clientFacts && !clientFactsWereAddressed(normalized, clientFacts)) {
    normalized.openQuestions = Array.isArray(normalized.openQuestions) ? normalized.openQuestions : [];
    normalized.openQuestions.push(`REVIEWER FOLLOW-UP REQUIRED: Client Facts were provided but nothing in this review addresses them — verify manually against the documents: "${clientFacts}"`);
  }
  enforceReviewConciseness(normalized);
  enforceInfoConsistencyStatus(normalized);
  enforceFilingReadinessConsistency(normalized);
  return normalized;
}

// The model has repeatedly written a MISMATCH explanation in the note field ("Client fact
// requirement: SSN ends in 123. Actual SSN ends in 0756. [MISMATCH ALERT]") while leaving the
// structured status column as "MATCH" — so the row reads as fine at a glance and the actual
// conflict only shows up if someone reads every note. Force the status to agree with what the
// note itself says.
function enforceInfoConsistencyStatus(review) {
  if (!Array.isArray(review.infoConsistency)) return;
  review.infoConsistency = review.infoConsistency.map((row) => {
    if (!row || typeof row !== "object") return row;
    const noteText = String(row.note || "").toLowerCase();
    const looksMismatched = /mismatch|does not match|conflict|incorrect|does not equal/.test(noteText);
    if (looksMismatched && String(row.status || "").toUpperCase() !== "MISMATCH") {
      return { ...row, status: "MISMATCH" };
    }
    return row;
  });
}

// Filing readiness must reflect what is actually in the review, not the model's own summary
// judgment — it has said "READY / LOW risk" in the same response that lists an unresolved
// SSN conflict, a $37,000 undocumented payment gap, and a possible late-filing question.
// Recomputed deterministically from the review's own content instead of trusted as-is:
//   - Any HIGH-priority issue -> NOT READY (something confirmed wrong blocks filing).
//   - No HIGH issue, but open questions or missing documents remain -> a distinct status
//     that says the return itself looks correct but named items still need checking, so a
//     preparer can tell "clean, just confirm these" apart from "actually broken."
//   - Nothing outstanding -> READY.
function enforceFilingReadinessConsistency(review) {
  const hasHighIssue = Array.isArray(review.issues) && review.issues.some((issue) => String(issue.priority || issue.severity || "").toUpperCase() === "HIGH");
  // A return whose numbers do not reconcile is not ready to file, regardless of how the
  // model graded its own issue list: one run reported six unreconciled tie-out lines and
  // still called the return READY. The Schedule L imbalance counts the same way.
  // An unreconciled line blocks filing — and so does a line nobody actually verified.
  const hasUnreconciledTieOut = Array.isArray(review.tieOutResults)
    && review.tieOutResults.some((row) => ["OUT_OF_BALANCE", "NOT VERIFIED"].includes(String(row?.status || "").toUpperCase()));
  const balanceSheetOff = review.balanceSheetCheck
    && review.balanceSheetCheck.balanced === false
    && Number(String(review.balanceSheetCheck.totalAssets || "").replace(/[^0-9.-]/g, "")) !== 0;
  const hasOpenItems = (Array.isArray(review.openQuestions) && review.openQuestions.length > 0)
    || (Array.isArray(review.missingDocuments) && review.missingDocuments.length > 0);
  if (hasHighIssue || hasUnreconciledTieOut || balanceSheetOff) {
    review.filingReadiness = "NOT READY";
  } else if (hasOpenItems) {
    review.filingReadiness = "READY - OPEN QUESTIONS REMAINING";
  } else {
    review.filingReadiness = "READY";
  }
}

// Safety net for the prompt-level "CLIENT FACTS ARE MANDATORY TO CHECK" instruction: the
// model has silently dropped client facts before (checked one review, ignored the next with
// identical instructions — non-deterministic prompt compliance). This looks for a
// distinctive token from the client facts text (a number with 3+ digits, or a word with 4+
// letters) anywhere in the JSON response; if none appear, the fact was almost certainly never
// checked, so a follow-up question is force-added rather than letting it disappear silently.
function clientFactsWereAddressed(structured, clientFacts) {
  const haystack = JSON.stringify(structured || {}).toLowerCase();
  // Numbers (SSN/EIN digits, dollar amounts) are the distinctive, checkable part of a
  // client fact — require one to appear verbatim when present. Generic words like
  // "client" or "ends" are too common in a review to prove the fact was actually checked.
  const numericTokens = clientFacts.match(/\d{3,}/g) || [];
  if (numericTokens.length) return numericTokens.some((token) => haystack.includes(token));
  const wordTokens = clientFacts.match(/[A-Za-z]{5,}/g) || [];
  if (!wordTokens.length) return true;
  return wordTokens.some((token) => haystack.includes(token.toLowerCase()));
}

// The model reliably ignores "1-2 sentences max" instructions in the prompt and writes
// paragraph-length findings. This trims each field to a hard sentence cap on the server so
// conciseness is guaranteed regardless of the model output. Cuts at sentence boundaries so
// nothing reads as truncated mid-thought; the actionable content (what is wrong, the amounts,
// the fix) lives in the first sentences, the essays that follow are what gets dropped.
function limitSentences(text, maxSentences, maxChars) {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  // Split only where sentence-ending punctuation is followed by whitespace AND the next
  // token starts a new sentence (capital letter, digit, quote, or paren). A decimal like
  // "$81,824.69" has no space after the dot, so it is never split — that bug dropped the
  // first half of findings and left stray fragments like "69 but return Line 1a shows...".
  const parts = raw.split(/(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/);
  // Re-join fragments that split after a common abbreviation ("W-2 vs. Return", "Reg.",
  // "Inc.", "e.g."), which otherwise cut a finding short at a false sentence boundary.
  const abbrev = /\b(vs|no|nos|inc|llc|ltd|corp|co|mr|mrs|ms|dr|sec|reg|pub|est|approx|dept|fig|al|e\.g|i\.e|etc)\.$/i;
  const sentences = [];
  for (const part of parts) {
    if (sentences.length && abbrev.test(sentences[sentences.length - 1])) {
      sentences[sentences.length - 1] += " " + part;
    } else {
      sentences.push(part);
    }
  }
  let out = sentences.slice(0, maxSentences).join(" ").replace(/\s+/g, " ").trim();
  if (maxChars && out.length > maxChars) {
    const clipped = out.slice(0, maxChars);
    const lastStop = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
    out = lastStop > maxChars * 0.5 ? clipped.slice(0, lastStop + 1) : clipped.replace(/\s+\S*$/, "") + "…";
  }
  return out;
}

// The ROUNDING RULE prompt instruction gets followed in spirit but not in letter: the
// model correctly concludes a sub-$1 difference is fine, then still emits a formal issue
// saying so ("this is correct, not an error") instead of dropping it. That inflates the
// HIGH/MEDIUM count with noise the Numeric Tie-Out section already covers as a TIE row.
// This is a hard filter so it can never slip through regardless of prompt compliance.
function isConfirmedRoundingNonIssue(issue) {
  const text = [issue.issueDescription, issue.description, issue.issue, issue.riskAnalysis, issue.proposedSolution]
    .filter(Boolean).join(" ").toLowerCase();
  const declaredFine = /(this is correct|not an error|no correction needed|is (irs )?whole-dollar rounding|correct,? not (an )?error)/.test(text);
  if (!declaredFine) return false;
  // "difference" can appear before or after the dollar amount ("$0.31 difference" or
  // "difference of $0.31") — check both orders.
  const diffMatch = text.match(/differ(?:ence|s)?\s*(?:of|is|by)?\s*\$?(-?\d+(?:\.\d+)?)/)
    || text.match(/\$(-?\d+(?:\.\d+)?)\s*differ(?:ence|s)?/);
  return Boolean(diffMatch) && Math.abs(Number(diffMatch[1])) < 1;
}

// Broader version of the same defect, not limited to rounding: the model creates a formal
// issue for a line it just finished confirming ties correctly ("Amounts tie correctly;
// verified... No correction needed — amounts tie."). These duplicate a Numeric Tie-Out
// TIE row or a verifiedItems entry that already exists, and inflate the HIGH/MEDIUM count
// with nothing actionable in it. Unlike isConfirmedRoundingNonIssue this does not require
// a dollar-difference match, since a "ties correctly" confirmation often mentions no
// difference amount at all.
function isSelfDeclaredNonIssue(issue) {
  const text = [issue.issueDescription, issue.description, issue.issue, issue.riskAnalysis, issue.proposedSolution]
    .filter(Boolean).join(" ").toLowerCase();
  return /(no correction needed|amounts tie correctly|ties correctly|correctly ties|no action (is )?(needed|required)|verified;? (no|correct)|nothing (further )?to (verify|correct)|no further (action|verification) (is )?(needed|required))/.test(text);
}

function enforceReviewConciseness(review) {
  if (!review || typeof review !== "object") return;
  review.executiveSummary = limitSentences(review.executiveSummary, 3, 500);
  review.finalConclusion = limitSentences(review.finalConclusion, 3, 500);
  if (Array.isArray(review.issues)) {
    review.issues = review.issues.filter((issue) => issue && !isConfirmedRoundingNonIssue(issue) && !isSelfDeclaredNonIssue(issue));
    review.issues = review.issues.map((issue) => {
      if (!issue || typeof issue !== "object") return issue;
      const priority = String(issue.priority || issue.severity || "").toUpperCase();
      return {
        ...issue,
        issueDescription: limitSentences(issue.issueDescription || issue.description || issue.issue, 2, 320),
        evidence: limitSentences(issue.evidence, 2, 240),
        // LOW findings are informational; a risk essay on them is exactly the noise to cut.
        riskAnalysis: priority === "LOW" ? "" : limitSentences(issue.riskAnalysis || issue.whyItMatters, 1, 180),
        proposedSolution: limitSentences(issue.proposedSolution || issue.recommendedAction || issue.recommendation, 2, 220),
        needsMoreInfo: limitSentences(issue.needsMoreInfo || issue.needsClientInfo, 1, 160),
      };
    });
  }
  // Documents Read is an index, not a report — one line per file is enough to confirm
  // it was actually opened. Long per-document summaries were pushing the review to
  // half a page before the findings even started.
  if (Array.isArray(review.documentsRead)) {
    review.documentsRead = review.documentsRead.map((doc) => {
      if (!doc || typeof doc !== "object") return doc;
      return { ...doc, summary: limitSentences(doc.summary, 1, 140) };
    });
  }
}

function buildDocumentsReadFromPayload(payload = {}) {
  return (payload.files || []).map((file) => ({
    filename: String(file.name || "Uploaded file"),
    role: String(file.reviewRole || file.canonicalRole || file.role || "supporting_document"),
    summary: `${file.encoding || file.mediaType || "Uploaded"} file included in the review package. ${file.text ? `Extracted approximately ${String(file.text).length.toLocaleString("en-US")} characters of readable content.` : "Readable text was not available; review may be limited."}`,
  }));
}

function hasBalanceSheetRelevantFiles(payload = {}) {
  // Only entity returns (corp/S-corp/partnership/trust) file a Schedule L. Checking
  // metadata.returnType directly avoids false positives: the old version grepped file
  // names/types for "taxreturn(s)", which matched the client-side upload category
  // "taxReturns" present on every review regardless of entity type — a 1040 with zero
  // balance-sheet relevance was flagging "OUT OF BALANCE" on every run.
  const returnType = String(payload.metadata?.returnType || "").toLowerCase().replace(/\s+/g, "");
  if (/^(1120|1120s|1120-s|1065|1041)$/.test(returnType)) return true;
  const text = JSON.stringify((payload.files || []).map((file) => ({ name: file.name, role: file.reviewRole || file.canonicalRole || file.role }))).toLowerCase();
  return /\bworkpaper\b|\bbalance sheet\b|\bschedule l\b/.test(text);
}

function buildIncompleteReviewResult(payload = {}, raw = "") {
  const metadata = payload.metadata || {};
  return {
    clientName: metadata.entityName || metadata.clientName || "",
    returnType: metadata.returnType || "",
    taxYear: metadata.taxYear || "",
    reviewStage: "Senior Review",
    generatedDate: new Date().toISOString(),
    reviewerName: "RAG Tax AI",
    executiveSummary: "The AI response did not contain a complete senior-review checklist. The uploaded documents were received, but the review must be rerun or completed manually before relying on the result.",
    documentsRead: buildDocumentsReadFromPayload(payload),
    feedbackApplied: [],
    issues: [{
      priority: "HIGH",
      category: "Incomplete AI Review",
      areaReviewed: "Review completeness",
      formOrSchedule: metadata.returnType || "Return package",
      issueDescription: "Claude did not return a complete senior review with findings, checkbox review, numeric tie-outs, and balance sheet review.",
      evidence: String(raw || "").slice(0, 1200) || "No usable review body was returned.",
      riskAnalysis: "If this output is treated as complete, material return errors could be missed before filing.",
      proposedSolution: "Confirm that the current-year return and current-year workpaper are uploaded and rerun the review. If the package is large, split the return/workpaper into separate readable PDFs or Excel files.",
      source: "AI response validation",
      needsMoreInfo: "Readable current-year return and current-year workpaper.",
    }],
    checkboxReview: [],
    tieOutResults: [],
    balanceSheetCheck: {
      totalAssets: null,
      totalLiabEquity: null,
      balanced: false,
      difference: null,
      note: "Not completed because Claude did not return a usable balance sheet check.",
    },
    openQuestions: ["Was the current-year return uploaded as a readable PDF?", "Was the current-year workpaper uploaded as a readable Excel/PDF file?"],
    verifiedItems: [],
    missingDocuments: ["Complete current-year return and current-year workpaper may be missing or unreadable."],
    finalConclusion: "NOT READY. The senior review output is incomplete and must be rerun before relying on it.",
    filingReadiness: "NOT READY",
    overallRiskScore: "High - incomplete senior review",
    structuringFailed: true,
    rawReviewOutput: String(raw || ""),
  };
}

function saveReviewHistoryFromResult(payload, structured, raw) {
  const clientId = resolveClientIdFromPayload(payload);
  if (!clientId || !structured) return null;
  const db = readDb();
  const client = db.clients[clientId];
  if (!client) return null;
  const issues = Array.isArray(structured.issues) ? structured.issues : [];
  const summary = {
    high: issues.filter((issue) => String(issue.priority || "").toLowerCase() === "high").length,
    medium: issues.filter((issue) => String(issue.priority || "").toLowerCase() === "medium").length,
    low: issues.filter((issue) => String(issue.priority || "").toLowerCase() === "low").length,
  };
  const entry = {
    id: crypto.randomUUID(),
    sessionId: payload.sessionId || payload.metadata?.sessionId || "",
    taxYear: String(payload.metadata?.taxYear || payload.taxYear || ""),
    returnType: resolveReturnTypeFromPayload(payload),
    reviewStage: String(payload.metadata?.reviewStage || payload.reviewStage || "Initial"),
    runAt: new Date().toISOString(),
    issuesSummary: summary,
    executiveSummary: String(structured.executiveSummary || raw || "").slice(0, 500),
    issues,
    filingReadiness: String(structured.finalConclusion || ""),
    feedback: [],
  };
  client.reviewHistory = Array.isArray(client.reviewHistory) ? client.reviewHistory : [];
  client.reviewHistory.unshift(entry);
  client.reviewHistory = client.reviewHistory.slice(0, 20);
  client.updatedAt = new Date().toISOString();
  writeDb(db);
  return entry;
}

async function handleReviewResponse(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) {
    sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." });
    return;
  }

  const issues = payload.originalReview?.structured?.issues || payload.originalReview?.issues || [];
  const issueIndex = Number(payload.issueIndex);
  const issue = Array.isArray(issues) ? issues[issueIndex] : null;
  if (!issue) {
    sendJson(res, 400, { error: "Issue not found in the original review." });
    return;
  }
  if (!String(payload.preparerResponse || "").trim()) {
    sendJson(res, 400, { error: "Write a preparer response before submitting." });
    return;
  }

  const content = buildReviewResponseContent(issue, payload);
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 1800,
    webSearch: false,
    system: [{
      type: "text",
      text: "You are a senior tax reviewer evaluating a preparer's response to a flagged issue. Given the original issue and the preparer's response, determine: (1) Is the response adequate to resolve the issue? (2) If yes, what is the correct treatment? (3) If no, what additional information is still needed? Return JSON: { resolved: boolean, resolution: string, followUpRequired: boolean, followUpQuestion: string }",
    }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "review_response", "review", payload, startedAt);

  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw) || {};
  sendJson(res, 200, {
    resolved: Boolean(parsed.resolved),
    resolution: String(parsed.resolution || raw || ""),
    followUpRequired: Boolean(parsed.followUpRequired),
    followUpQuestion: String(parsed.followUpQuestion || ""),
    raw,
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

async function handleIrsInstructions(_req, res, requestUrl) {
  const form = String(requestUrl.searchParams.get("form") || "").trim();
  const year = String(requestUrl.searchParams.get("year") || "").trim();
  const match = await findIrsInstructionUrl(form, year);
  if (!match) {
    sendJson(res, 404, { error: "No IRS instructions URL found for that form and year." });
    return;
  }
  sendJson(res, 200, match);
}

async function handlePresentationsGenerate(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) { sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." }); return; }
  if (!String(payload.instructions || "").trim()) { sendJson(res, 400, { error: "Write presentation instructions before generating." }); return; }

  const context = await buildUploadedFileContext(payload.files || []);
  const content = buildPresentationContent(payload, context);
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 8000,
    webSearch: false,
    models: [...MODEL_FALLBACKS, "claude-sonnet-4-5-20250929"],
    system: [{ type: "text", text: buildPresentationSystemPrompt(payload, context.text) }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "presentations", "presentations", payload, startedAt);

  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  if (!parsed?.slides?.length) {
    sendJson(res, 502, { error: "Claude did not return valid presentation JSON. No PowerPoint file was generated.", raw });
    return;
  }
  const spec = normalizePresentationSpec(parsed, payload);
  let pptxBuffer;
  try {
    pptxBuffer = await buildPresentation(spec);
  } catch (error) {
    sendJson(res, 502, { error: `PowerPoint file generation failed: ${error.message || "unknown error"}` });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    filename: safeFileName(`${spec.presentationTitle || "Client_Presentation"}_${payload.clientName || "Client"}.pptx`),
    contentBase64: pptxBuffer.toString("base64"),
    slideCount: spec.slides.length,
    slideOutline: spec.slides.map((slide) => ({ slideNumber: slide.slideNumber, title: slide.title, type: slide.type })),
    tokensUsed: result.data.usage || null,
    cost: estimateClaudeCost(result.data.usage || null),
  });
}

async function handleCalculationsRun(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) { sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." }); return; }
  if (!String(payload.instructions || "").trim()) { sendJson(res, 400, { error: "Write calculation instructions before running." }); return; }

  const context = await buildUploadedFileContext(payload.files || []);
  const content = buildCalculationContent(payload, context);
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 12000,
    webSearch: false,
    system: [{ type: "text", text: buildCalculationSystemPrompt(payload, context.text) }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "calculations", "calculations", payload, startedAt);

  const raw = extractText(result.data);
  let parsed = parseClaudeJson(raw);
  let repairedRaw = "";
  if (!parsed) {
    const repairStartedAt = Date.now();
    const repair = await repairCalculationJson(apiKey, raw, payload, context.text);
    if (repair.ok) {
      logClaudeCost(req, repair, "calculations", "calculations", { ...payload, repair: true }, repairStartedAt);
      repairedRaw = extractText(repair.data);
      parsed = parseClaudeJson(repairedRaw);
    }
  }
  if (!parsed) {
    sendJson(res, 502, { error: "Claude did not return valid calculation JSON. No Excel workbook was generated.", raw, repairedRaw });
    return;
  }
  let workbook;
  try {
    workbook = normalizeCalculationWorkbook(parsed, payload);
  } catch (error) {
    sendJson(res, 502, { error: error.message || "Claude did not return usable workbook sheets.", raw });
    return;
  }
  let xlsxBuffer;
  try {
    xlsxBuffer = buildSimpleXlsx(workbook);
  } catch (error) {
    sendJson(res, 502, { error: `Excel file generation failed: ${error.message || "unknown error"}` });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    filename: safeFileName(`Calculations_${payload.clientName || "Client"}_${payload.calculationTitle || "Analysis"}.xlsx`),
    contentBase64: xlsxBuffer.toString("base64"),
    workbook,
    sheetNames: workbook.sheets.map((sheet) => sheet.name),
    executiveSummary: String(parsed.executiveSummary || ""),
    flagCount: countCalculationFlags(parsed),
    tokensUsed: result.data.usage || null,
    cost: estimateClaudeCost(result.data.usage || null),
  });
}

async function buildUploadedFileContext(files = []) {
  const textParts = [];
  const images = [];
  const documents = [];
  for (const file of Array.isArray(files) ? files.slice(0, 30) : []) {
    const name = String(file.name || "Uploaded file");
    const type = String(file.type || mimeFromName(name) || "");
    const content = String(file.content || file.contentBase64 || "");
    const workbookTemplates = [
      file.workbookTemplate,
      ...(Array.isArray(file.workbookTemplates) ? file.workbookTemplates : []),
    ].filter((template) => template?.sheets?.length);

    // PDFs: always attach the actual file as a document block so the model reads it
    // natively (including scanned / image-only PDFs that have no extractable text layer,
    // which is why "could not extract readable text" was appearing). Supplement with any
    // genuinely readable extracted text.
    const isPdf = /\.pdf$/i.test(name) || type.includes("pdf");
    if (isPdf && content) {
      documents.push({ name, type: "application/pdf", content, role: file.role || "other" });
      let pdfText = String(file.text || "").trim();
      if (!pdfText || /could not extract/i.test(pdfText)) {
        try { pdfText = await extractPdfPlainText(Buffer.from(content, "base64")); } catch (_) { pdfText = ""; }
      }
      if (pdfText && !/Server could not extract readable text/i.test(pdfText)) {
        textParts.push(`FILE: ${name}\nROLE: ${file.role || "other"}\n${pdfText.slice(0, 60000)}`);
      } else {
        textParts.push(`FILE: ${name}\nROLE: ${file.role || "other"}\n[PDF attached as a document for direct reading.]`);
      }
      continue;
    }

    if (String(file.text || "").trim()) {
      const templateBlock = workbookTemplates.length
        ? ["", "=== STRUCTURED WORKBOOK TEMPLATE TO MIRROR ===", safeJsonForPrompt(workbookTemplates.slice(0, 3), 100000)].join("\n")
        : "";
      textParts.push(`FILE: ${name}\nROLE: ${file.role || "other"}\n${String(file.text).trim().slice(0, 60000)}${templateBlock}`);
      continue;
    }
    if (!content) {
      if (workbookTemplates.length) {
        textParts.push(`FILE: ${name}\nROLE: ${file.role || "other"}\n=== STRUCTURED WORKBOOK TEMPLATE TO MIRROR ===\n${safeJsonForPrompt(workbookTemplates.slice(0, 3), 100000)}`);
      }
      continue;
    }
    const buffer = Buffer.from(content, "base64");
    if (/^image\//i.test(type) || /\.(png|jpe?g)$/i.test(name)) {
      images.push({ name, type: type || "image/png", content });
      continue;
    }
    let extracted = "";
    try {
      if (/\.pptx$/i.test(name) || type.includes("presentationml.presentation")) extracted = extractPptxText(buffer);
      else if (/\.docx$/i.test(name) || type.includes("wordprocessingml.document")) extracted = extractDocxText(buffer);
      else if (/\.xlsx$/i.test(name) || type.includes("spreadsheet")) extracted = extractXlsxText(buffer);
      else if (/\.zip$/i.test(name) || type.includes("zip")) extracted = await extractZipPackageTextServer(buffer, name);
      else if (/\.csv$/i.test(name) || type.includes("csv")) extracted = buffer.toString("utf8");
      else if (/\.json$/i.test(name) || type.includes("json")) extracted = buffer.toString("utf8");
      else if (/\.txt$/i.test(name) || type.startsWith("text/")) extracted = buffer.toString("utf8");
      else if (/\.pdf$/i.test(name) || type.includes("pdf")) extracted = await extractPdfPlainText(buffer);
      else extracted = buffer.toString("utf8").replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ").slice(0, 12000);
    } catch (error) {
      extracted = `[Could not extract text from ${name}: ${error.message || "unknown error"}]`;
    }
    if (extracted.trim() || workbookTemplates.length) {
      const templateBlock = workbookTemplates.length
        ? ["", "=== STRUCTURED WORKBOOK TEMPLATE TO MIRROR ===", safeJsonForPrompt(workbookTemplates.slice(0, 3), 100000)].join("\n")
        : "";
      textParts.push(`FILE: ${name}\nROLE: ${file.role || "other"}\n${extracted.trim().slice(0, 60000)}${templateBlock}`);
    }
  }
  return { text: textParts.join("\n\n---\n\n").slice(0, 180000), images, documents };
}

// Real PDF parser (pdf-parse, same lineage as the pdf.js already used client-side). The
// previous implementation was a handwritten regex against raw PDF bytes that only matched
// uncompressed "(...)Tj" operators — it returned nothing on the vast majority of real-world
// PDFs (virtually all modern PDF generators compress content streams), and on some inputs
// the alternation-heavy regex hit catastrophic backtracking and hung the single-threaded
// Node event loop for the whole server, not just the one request. Confirmed against a real
// client package: 3 of 6 PDFs hung >5s, the other 3 silently returned zero text.
async function extractPdfPlainText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const joined = String(result?.text || "").replace(/\n{3,}/g, "\n\n").trim();
    return joined || "[PDF uploaded. Server could not extract readable text from this PDF (likely a scanned/image-only PDF); use visible document metadata and any image analysis if available.]";
  } catch (error) {
    console.warn("[PDF] extraction failed:", error?.message || error);
    return "[PDF uploaded. Server could not extract readable text from this PDF; use visible document metadata and any image analysis if available.]";
  } finally {
    await parser.destroy().catch(() => {});
  }
}

function extractXlsxText(buffer) {
  const sharedXml = readZipEntry(buffer, "xl/sharedStrings.xml") || "";
  const shared = Array.from(sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)).map((m) => stripXmlText(m[0]));
  const parts = [];
  for (let index = 1; index <= 20; index += 1) {
    const xml = readZipEntry(buffer, `xl/worksheets/sheet${index}.xml`);
    if (!xml) continue;
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row[\s\S]*?<\/row>/g)) {
      const values = [];
      for (const cellMatch of rowMatch[0].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1] || "";
        const body = cellMatch[2] || "";
        const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
        const inlineMatch = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        let value = inlineMatch ? stripXmlText(inlineMatch[1]) : valueMatch ? stripXmlText(valueMatch[1]) : "";
        if (/\bt="s"/.test(attrs)) value = shared[Number(value)] || value;
        values.push(value);
      }
      // Join columns with " | " rather than ", ". QBO/bank transaction exports put long
      // free-text descriptions (e.g. "WELLS FARGO BANK, N.A. FORT PIERCE,FL ...") in one
      // cell, and those descriptions contain many commas. With a comma delimiter the model
      // cannot tell where the description ends and the Amount column begins, so it marked
      // real dollar amounts as "TBD / not in source". A pipe never appears in the data, so
      // every column boundary — including the Amount — stays unambiguous.
      if (values.some(Boolean)) rows.push(values.join(" | "));
      if (rows.length >= 100) break;
    }
    if (rows.length) parts.push(`Sheet ${index}\n${rows.join("\n")}`);
  }
  return parts.join("\n\n");
}

function buildPresentationContent(payload, context) {
  const blocks = context.images.slice(0, 6).map((image) => ({
    type: "image",
    source: { type: "base64", media_type: image.type || "image/png", data: image.content },
  }));
  blocks.push({ type: "text", text: buildPresentationUserPrompt(payload, context.text) });
  return blocks;
}

function buildPresentationSystemPrompt(payload, extractedText) {
  return `You are a professional presentation designer and financial communicator specializing in CPA firm client presentations.

Create clear PowerPoint presentations that explain financial and tax information to clients.

Rules:
- Each slide has one clear message.
- Use short bullets, max 5 words where possible.
- Format numbers with dollar signs and commas.
- Explain tax jargon.
- Include visual suggestions.
- Return ONLY valid JSON inside \`\`\`json fences.

Client: ${payload.clientName || "Client"}
Firm: ${payload.firmName || "CPA Firm"}
Prepared by: ${payload.preparedBy || "CPA"}
Tax Year: ${payload.taxYear || ""}
Language: ${payload.language || "en"}

Uploaded content:
${extractedText || "(No readable text extracted.)"}`;
}

function buildPresentationUserPrompt(payload, extractedText) {
  return `Build a ${payload.style || "professional"} client presentation.
Requested slide count: ${payload.slideCount || "auto"}
Include agenda: ${Boolean(payload.includeAgenda)}
Include executive summary: ${Boolean(payload.includeSummary)}

User instructions:
${payload.instructions || ""}

Output schema:
{
  "presentationTitle": "string",
  "subtitle": "string",
  "totalSlides": 5,
  "theme": {"primaryColor":"1B3A6B","secondaryColor":"2563EB","accentColor":"60A5FA","backgroundColor":"FFFFFF","textColor":"0F172A","fontTitle":"Aptos Display","fontBody":"Aptos"},
  "slides": [
    {"slideNumber":1,"type":"title_slide|agenda|two_column|bullets|big_number|table|timeline|comparison|action_items|closing","title":"string","subtitle":null,"bullets":["string"],"columns":[{"header":"string","content":"string"}],"tableData":{"headers":["string"],"rows":[["string"]]},"chartData":null,"bigNumbers":[{"value":"string","label":"string","change":null}],"timelineItems":[{"date":"string","event":"string","description":"string"}],"actionItems":[{"number":1,"action":"string","owner":"string","deadline":"string"}],"quote":null,"speakerNotes":"string","visualSuggestion":"string","backgroundColor":null}
  ]
}

Use this extracted source content:
${extractedText || "(No readable text extracted.)"}`;
}

function buildCalculationContent(payload, context) {
  const blocks = [
    ...(context.documents || []).slice(0, 10).map((doc) => ({
      type: "document",
      source: { type: "base64", media_type: doc.type || "application/pdf", data: doc.content },
      title: doc.name,
      context: doc.role || "calculation source file",
    })),
    ...context.images.slice(0, 8).map((image) => ({
      type: "image",
      source: { type: "base64", media_type: image.type || "image/png", data: image.content },
    })),
  ];
  blocks.push({ type: "text", text: buildCalculationUserPrompt(payload, context.text) });
  return blocks;
}

function buildCalculationSystemPrompt(payload, extractedText) {
  return `You are a senior CPA and financial analyst. Perform the user's requested calculations from uploaded financial data.

Rules:
- PDFs and images are attached directly to this message as document/image blocks. READ THEM DIRECTLY, including scanned or image-only PDFs and photographed statements. Never claim a file is unreadable or that text could not be extracted when it is attached — extract the figures straight from the attached document or image.
- Show all work and make every number traceable.
- Label every row clearly.
- Round currency and percentages appropriately.
- Flag missing data, discrepancies, and totals that do not tie.
- Return ONLY one valid JSON object. Do not include prose before or after it.
- Every sheet must contain either sections with columns/rows or direct rows.
- Every material number must include a source row, note, or formula/reference in the workbook content.
- If data is genuinely missing from every attached file and the text, create a flag. Do not invent amounts.

Uploaded content (text-extracted; attached PDFs/images may contain additional or clearer data):
${extractedText || "(No text extracted — read the attached PDF/image documents directly.)"}`;
}

function buildCalculationUserPrompt(payload, extractedText) {
  return `Client: ${payload.clientName || "Client"}
Calculation title: ${payload.calculationTitle || "Misc Calculation"}
Instructions:
${payload.instructions || ""}

Output options:
${JSON.stringify(payload.outputFormat || {}, null, 2)}

Return this schema:
{
  "calculationTitle": "string",
  "clientName": "string",
  "dateGenerated": "YYYY-MM-DD",
  "executiveSummary": "string",
  "sheets": [
    {
      "sheetName": "Summary",
      "sheetType": "summary",
      "description": "string",
      "sections": [
        {
          "sectionTitle": "string",
          "sectionDescription": "string",
          "columns": [{"header":"Description","dataType":"text","width":24},{"header":"Amount","dataType":"currency","width":14}],
          "rows": [{"cells":["Label",123.45],"source":"file/page/line","notes":"string","flag":null}],
          "totals": [{"label":"Total","value":123.45}]
        }
      ]
    }
  ],
  "flags": [{"severity":"high|medium|low","message":"string","sheet":"string","row":"string"}]
}

Source content:
${extractedText || "(No readable text extracted.)"}`;
}

async function repairCalculationJson(apiKey, raw, payload, extractedText) {
  const repairPrompt = `The prior response did not parse as JSON. Convert it into ONE valid JSON object matching this schema. Do not add markdown fences or explanation.

Required schema:
{
  "calculationTitle": "string",
  "clientName": "string",
  "dateGenerated": "YYYY-MM-DD",
  "executiveSummary": "string",
  "sheets": [
    {
      "sheetName": "Summary",
      "sheetType": "summary|detail|support",
      "description": "string",
      "sections": [
        {
          "sectionTitle": "string",
          "sectionDescription": "string",
          "columns": [{"header":"Description","dataType":"text","width":24},{"header":"Amount","dataType":"currency","width":14},{"header":"Source","dataType":"text","width":32}],
          "rows": [{"cells":["Label",123.45,"source file / line"],"source":"file/page/line","notes":"string","flag":null}],
          "totals": [{"label":"Total","value":123.45}]
        }
      ]
    }
  ],
  "flags": [{"severity":"high|medium|low","message":"string","sheet":"string","row":"string"}]
}

Client: ${payload.clientName || "Client"}
Calculation title: ${payload.calculationTitle || "Misc Calculation"}
User instructions:
${payload.instructions || ""}

Available uploaded content summary:
${String(extractedText || "(No readable text extracted.)").slice(0, 60000)}

Prior response to convert:
${String(raw || "").slice(0, 60000)}`;

  return callClaudeContentWithFallbacks(apiKey, [{ type: "text", text: repairPrompt }], { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 10000,
    webSearch: false,
    system: [{ type: "text", text: "You are a strict JSON repair engine. Return only valid JSON. Do not use markdown fences. Do not invent missing amounts; flag missing data instead." }],
  });
}

function normalizePresentationSpec(parsed, payload) {
  const theme = parsed.theme || {};
  const defaultTheme = presentationTheme(payload.style);
  return {
    presentationTitle: String(parsed.presentationTitle || payload.instructions || "Client Presentation").slice(0, 120),
    subtitle: String(parsed.subtitle || `${payload.clientName || "Client"} ${payload.taxYear || ""}`).trim(),
    firmName: String(payload.firmName || "CPA Firm"),
    preparedBy: String(payload.preparedBy || "CPA"),
    theme: {
      primaryColor: cleanHex(theme.primaryColor, defaultTheme.primaryColor),
      secondaryColor: cleanHex(theme.secondaryColor, defaultTheme.secondaryColor),
      accentColor: cleanHex(theme.accentColor, defaultTheme.accentColor),
      backgroundColor: cleanHex(theme.backgroundColor, defaultTheme.backgroundColor),
      textColor: cleanHex(theme.textColor, defaultTheme.textColor),
      fontTitle: String(theme.fontTitle || "Aptos Display"),
      fontBody: String(theme.fontBody || "Aptos"),
    },
    slides: parsed.slides.slice(0, 20).map((slide, index) => ({
      slideNumber: Number(slide.slideNumber || index + 1),
      type: String(slide.type || (index === 0 ? "title_slide" : "bullets")),
      title: String(slide.title || `Slide ${index + 1}`),
      subtitle: slide.subtitle ? String(slide.subtitle) : "",
      bullets: Array.isArray(slide.bullets) ? slide.bullets.map(String).slice(0, 8) : [],
      columns: Array.isArray(slide.columns) ? slide.columns.slice(0, 3).map((col) => ({ header: String(col.header || ""), content: String(col.content || "") })) : [],
      tableData: slide.tableData && Array.isArray(slide.tableData.headers) ? slide.tableData : null,
      bigNumbers: Array.isArray(slide.bigNumbers) ? slide.bigNumbers.slice(0, 3) : [],
      timelineItems: Array.isArray(slide.timelineItems) ? slide.timelineItems.slice(0, 6) : [],
      actionItems: Array.isArray(slide.actionItems) ? slide.actionItems.slice(0, 8) : [],
      quote: slide.quote ? String(slide.quote) : "",
      speakerNotes: String(slide.speakerNotes || ""),
      visualSuggestion: String(slide.visualSuggestion || ""),
      backgroundColor: slide.backgroundColor ? cleanHex(slide.backgroundColor, "") : "",
    })),
  };
}

function normalizeCalculationWorkbook(parsed, payload) {
  parsed = coerceCalculationParsedShape(parsed, payload);
  const sheets = [];
  const summaryRows = [["Calculation", parsed.calculationTitle || payload.calculationTitle || "Misc Calculation"], ["Client", parsed.clientName || payload.clientName || ""], ["Generated", parsed.dateGenerated || new Date().toISOString().slice(0, 10)], [], ["Executive Summary"], [parsed.executiveSummary || ""]];
  if (payload.outputFormat?.includeSummarySheet !== false) sheets.push({ name: "Summary", rows: summaryRows, cols: [{ wch: 22 }, { wch: 80 }], styles: [{ r: 0, c: 0, bold: true }, { r: 4, c: 0, bold: true }] });
  for (const sheet of Array.isArray(parsed.sheets) ? parsed.sheets : []) {
    const rows = [];
    if (Array.isArray(sheet.rows) && sheet.rows.length) {
      for (const row of sheet.rows) rows.push(Array.isArray(row) ? row.map(normalizeCellValue) : Object.values(row).map(normalizeCellValue));
    }
    for (const section of Array.isArray(sheet.sections) ? sheet.sections : []) {
      if (section.sectionTitle) rows.push([String(section.sectionTitle)]);
      const headers = Array.isArray(section.columns) ? section.columns.map((col) => String(col.header || "")) : [];
      if (headers.length) rows.push(headers);
      for (const row of Array.isArray(section.rows) ? section.rows : []) {
        rows.push(Array.isArray(row.cells) ? row.cells.map(normalizeCellValue) : Object.values(row).map(normalizeCellValue));
      }
      for (const total of Array.isArray(section.totals) ? section.totals : []) rows.push([String(total.label || "Total"), normalizeCellValue(total.value)]);
      rows.push([]);
    }
    if (rows.length) sheets.push({ name: String(sheet.sheetName || sheet.name || "Detail").slice(0, 31), rows, cols: [{ wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 16 }] });
  }
  const flags = Array.isArray(parsed.flags) ? parsed.flags : [];
  if (flags.length) sheets.push({ name: "Flags", rows: [["Severity", "Message", "Sheet", "Row"], ...flags.map((f) => [f.severity || "", f.message || "", f.sheet || "", f.row || ""])], cols: [{ wch: 12 }, { wch: 70 }, { wch: 22 }, { wch: 16 }] });
  if (!sheets.length) throw new Error("Calculation JSON did not contain usable sheets.");
  return normalizeWorkbook({ sheets }, "", payload);
}

function coerceCalculationParsedShape(parsed, payload) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  if (source.workbook?.sheets && !source.sheets) source.sheets = source.workbook.sheets;
  if (Array.isArray(source.tables) && !source.sheets) {
    source.sheets = source.tables.map((table, index) => ({
      sheetName: table.name || table.title || `Table ${index + 1}`,
      sheetType: "detail",
      sections: [{
        sectionTitle: table.title || table.name || `Table ${index + 1}`,
        sectionDescription: table.description || "",
        columns: Array.isArray(table.headers) ? table.headers.map((header) => ({ header: String(header), dataType: "text", width: 18 })) : [],
        rows: Array.isArray(table.rows) ? table.rows.map((row) => ({ cells: Array.isArray(row) ? row : Object.values(row || {}) })) : [],
        totals: Array.isArray(table.totals) ? table.totals : [],
      }],
    }));
  }
  if (Array.isArray(source.sections) && !source.sheets) {
    source.sheets = [{ sheetName: "Calculation", sheetType: "detail", sections: source.sections }];
  }
  if (Array.isArray(source.rows) && !source.sheets) {
    source.sheets = [{ sheetName: "Calculation", sheetType: "detail", rows: source.rows }];
  }
  source.calculationTitle = source.calculationTitle || source.title || payload.calculationTitle || "Misc Calculation";
  source.clientName = source.clientName || payload.clientName || "";
  source.executiveSummary = source.executiveSummary || source.summary || source.analysisSummary || "";
  source.flags = Array.isArray(source.flags) ? source.flags : [];
  return source;
}

function normalizeCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function countCalculationFlags(parsed) {
  return Array.isArray(parsed.flags) ? parsed.flags.length : 0;
}

function presentationTheme(style) {
  const themes = {
    modern: { primaryColor: "1D4ED8", secondaryColor: "0F172A", accentColor: "38BDF8", backgroundColor: "FFFFFF", textColor: "0F172A" },
    minimal: { primaryColor: "0F172A", secondaryColor: "475569", accentColor: "2563EB", backgroundColor: "FFFFFF", textColor: "111827" },
    bold: { primaryColor: "0B1220", secondaryColor: "2563EB", accentColor: "60A5FA", backgroundColor: "FFFFFF", textColor: "0F172A" },
    professional: { primaryColor: "1B3A6B", secondaryColor: "2563EB", accentColor: "60A5FA", backgroundColor: "FFFFFF", textColor: "0F172A" },
  };
  return themes[String(style || "").toLowerCase()] || themes.professional;
}

function cleanHex(value, fallback) {
  const hex = String(value || "").replace("#", "").trim();
  return /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : fallback;
}

function buildSimpleXlsx(workbook) {
  const sheets = uniqueWorkbookSheetNames(workbook.sheets.slice(0, 30));
  const sharedStrings = [];
  const sharedStringMap = new Map();
  const shared = {
    get(value) {
      const text = sanitizeXmlText(String(value ?? ""));
      if (!sharedStringMap.has(text)) {
        sharedStringMap.set(text, sharedStrings.length);
        sharedStrings.push(text);
      }
      return sharedStringMap.get(text);
    },
  };
  const sheetXml = {};
  sheets.forEach((sheet, index) => { sheetXml[`xl/worksheets/sheet${index + 1}.xml`] = worksheetXml(sheet, shared); });
  const sheetDefs = sheets.map((sheet, index) => `<sheet name="${escapeXml(safeSheetName(sheet.name || `Sheet ${index + 1}`))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const rels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const sharedStringXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings.map((text) => `<si><t${/^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : ""}>${escapeXml(text)}</t></si>`).join("")}</sst>`;
  const created = new Date().toISOString();
  return createZipStore({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>${overrides}</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>RAG Tax AI</dc:creator><cp:lastModifiedBy>RAG Tax AI</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`,
    "docProps/app.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>RAG Tax AI</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map((sheet) => `<vt:lpstr>${escapeXml(safeSheetName(sheet.name))}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="24822"/><workbookPr defaultThemeVersion="164011"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="25600" windowHeight="19020"/></bookViews><sheets>${sheetDefs}</sheets><calcPr calcId="191029"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/><Relationship Id="rId${sheets.length + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/styles.xml": defaultXlsxStylesXml(),
    "xl/theme/theme1.xml": defaultXlsxThemeXml(),
    "xl/sharedStrings.xml": sharedStringXml,
    ...sheetXml,
  });
}

function worksheetXml(sheet, shared) {
  const rows = normalizeRows(sheet.rows).slice(0, 5000);
  const xmlRows = rows.map((row, rIdx) => `<row r="${rIdx + 1}">${row.map((cell, cIdx) => cellXml(cell, rIdx + 1, cIdx + 1, rIdx === 0 ? 1 : 0, shared)).join("")}</row>`).join("");
  const cols = Array.isArray(sheet.cols) && sheet.cols.length ? `<cols>${sheet.cols.slice(0, 50).map((col, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${Math.max(4, Math.min(80, Number(col.wch || col.width || 14) || 14))}" customWidth="1"/>`).join("")}</cols>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${xmlRows}</sheetData></worksheet>`;
}

function cellXml(value, row, col, style, shared) {
  const ref = `${columnName(col)}${row}`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${ref}" t="b"${style ? ` s="${style}"` : ""}><v>${value ? 1 : 0}</v></c>`;
  const text = sanitizeXmlText(String(value ?? ""));
  if (/^=[A-Z0-9_.$()[\]+\-*/,: <>=&"']+$/i.test(text)) {
    return `<c r="${ref}"${style ? ` s="${style}"` : ""}><f>${escapeXml(text.slice(1))}</f></c>`;
  }
  return `<c r="${ref}" t="s"${style ? ` s="${style}"` : ""}><v>${shared.get(text)}</v></c>`;
}

function columnName(number) {
  let name = "";
  let n = number;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function safeSheetName(name) {
  return String(name || "Sheet").replace(/[\\/?*\[\]:]/g, " ").slice(0, 31).trim() || "Sheet";
}

function uniqueWorkbookSheetNames(sheets) {
  const seen = new Map();
  return sheets.map((sheet, index) => {
    const base = safeSheetName(sheet?.name || `Sheet ${index + 1}`).slice(0, 31);
    const count = seen.get(base.toLowerCase()) || 0;
    seen.set(base.toLowerCase(), count + 1);
    if (!count) return { ...sheet, name: base };
    const suffix = ` ${count + 1}`;
    return { ...sheet, name: `${base.slice(0, 31 - suffix.length)}${suffix}` };
  });
}

function sanitizeXmlText(value) {
  return String(value ?? "").replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g, "");
}

function defaultXlsxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Aptos"/><family val="2"/></font><font><b/><sz val="11"/><color theme="1"/><name val="Aptos"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
}

function defaultXlsxThemeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

function safeFileName(name) {
  return String(name || "download").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
}

function escapeXml(value) {
  return sanitizeXmlText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function createZipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  Object.entries(files).forEach(([name, value]) => {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  });
  const centralStart = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

let CRC32_TABLE = null;
function crc32(buffer) {
  if (!CRC32_TABLE) {
    CRC32_TABLE = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function handlePrepareWorkpaper(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();

  if (!apiKey) {
    sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." });
    return;
  }
  if (!String(payload.metadata?.instructions || "").trim()) {
    sendJson(res, 400, { error: "Write preparer instructions before generating the workbook." });
    return;
  }
  if (!Array.isArray(payload.files) || payload.files.length === 0) {
    sendJson(res, 400, { error: "Upload at least one preparation file before generating the workbook." });
    return;
  }

  const taxSoftware = resolveTaxSoftwareFromPayload(payload);
  const returnType = resolveReturnTypeFromPayload(payload);
  const rawTaxYear = String(payload.metadata?.taxYear || payload.taxYear || "").trim();
  // The frontend can send a stale preparation year (a hidden field default), so
  // reconcile it against the years that actually appear in the uploaded filenames.
  // Current-year financials carry the most recent year, so the latest filename year
  // is the authoritative preparation year when it is newer than the metadata year.
  const taxYear = reconcilePreparationYear(rawTaxYear, payload.files);
  payload.metadata = { ...(payload.metadata || {}), taxSoftware, returnType, taxYear };

  // Season roll-forward: attach the client's newest ARCHIVED prior-season workpaper as a
  // regular file, so the existing prior_workpaper pipeline (structure mirroring + amount
  // stripping) applies to it unchanged. Opt-in via checkbox; silently noted when empty.
  const prepClientId = String(payload.clientId || payload.metadata?.clientId || "").trim();
  let archiveNote = "";
  if (payload.useArchivedPriorWorkpaper && prepClientId) {
    try {
      const prior = loadNewestPriorWorkpaper(CLIENT_FILES_DIR, prepClientId, taxYear);
      if (prior) {
        const template = await xlsxBufferToTemplate(prior.buffer, prior.file);
        payload.files = [
          { name: prior.file, type: "preparationPackage", text: templateToText(template), workbookTemplate: template, workbookTemplates: [template] },
          ...(payload.files || []),
        ];
        archiveNote = `Roll-forward: archived TY${prior.taxYear} workpaper (${prior.file}) attached as the prior workpaper.`;
      } else {
        archiveNote = "Roll-forward was requested but no archived prior-season workpaper exists for this client yet.";
      }
    } catch (error) {
      archiveNote = `Roll-forward failed to load the archived workpaper: ${error?.message || error}`;
    }
  }

  payload.files = annotatePreparationFileRoles(payload.files || [], payload);
  const content = buildPreparerContent(payload);
  const softwareContext = buildSoftwareContext(taxSoftware, returnType, taxYear);
  const entryGuideSystem = buildDataEntryGuideSystemPrompt(returnType, taxYear, taxSoftware)
    .replace(
      "OUTPUT FORMAT: respond ONLY with valid JSON inside ```json fences using this schema:",
      "ENTRY GUIDE PROPERTY FORMAT: inside the workbook JSON, the entryGuide property must use this schema:"
    );
  const startedAt = Date.now();
  // Keep the proxy connection alive during the long model call to avoid a 504.
  startHeartbeatResponse(res);
  // A full multi-sheet workpaper plus the embedded data-entry guide does not fit in
  // 10k output tokens (20k max minus 10k thinking). When it overflows, Claude's JSON is
  // truncated, no usable sheets parse, and normalizeWorkbook silently falls back to
  // copying the prior-year template — which is why prior-year numbers were appearing.
  // Give the response far more room and a smaller thinking budget.
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 48000,
    models: [...MODEL_FALLBACKS, "claude-sonnet-4-5-20250929"],
    thinking: { type: "enabled", budget_tokens: 6000 },
    webSearch: false,
    system: [{
      type: "text",
      text: withDatabaseContext(`${softwareContext}\n\n${entryGuideSystem}\n\nYou create Excel-ready tax workpapers for preparers from uploaded source files and user instructions. Be precise, do not invent values, and return only valid JSON for workbook generation. Adapt all guidance, AI Notes, and entry-related instructions to the selected tax software. Keep the workbook complete but compact enough to fit in one response: include the needed sheets and rows, avoid narrative prose, and do not repeat source text inside cells unless it belongs in the workpaper. The data entry guide must be generated in this same response so the app does not make a second Claude call.\n\nABSOLUTE PREPARATION RULES:\n- Files labeled current_financials are the only source of truth for current-year P&L, balance sheet, and GL amounts.\n- Files labeled prior_workpaper provide structure, sheet order, labels, prior adjustment categories, and formatting only. Prior-year amounts are reference only and must never be copied as current-year amounts.\n- Files labeled prior_return provide beginning balances, carryforwards, depreciation/tax basis support, Schedule A/Schedule 2 style support where relevant, and prior tax positions only.\n- Replace every prior-year amount when producing the current-year workpaper. If a current-year amount is not found, use 0 or blank and flag it; never silently carry forward a prior-year value.\n- Book-to-tax reconciliation starts from current-year net income per books from current_financials, then applies supported tax adjustments. M-1/M-3, taxable income, M-2, and retained earnings must foot or clearly flag the unreconciled difference.\n- The Data Entry Guide must include tie-out checks against current-year P&L, current-year balance sheet, and book-to-tax reconciliation.`, payload, "preparation"),
    }],
  });
  if (!result.ok) { endHeartbeatResponse(res, { error: result.error }); return; }
  logClaudeCost(req, result, "preparation", "preparation", payload, startedAt);

  const raw = extractText(result.data);
  const parsed = parseWorkpaperJson(raw);
  if (!parsed) {
    endHeartbeatResponse(res, {
      error: "Claude did not return valid workbook JSON. No Excel file was generated because raw JSON/text is not an acceptable workpaper output.",
      raw,
    });
    return;
  }
  let workbook;
  try {
    workbook = normalizeWorkbook(parsed, raw, payload);

    // Entity gate for the fixed-structure reconciliation sheet:
    //   • 1065 / 1120 / 1120-S / blank return type → Schedule M-1 (blank must never silently
    //     disable the deterministic M-1 — that was the 56/57 bug).
    //   • 1040 → "Book to Tax (Sch C-E)" business reconciliation, but ONLY when the model
    //     returned a reconciliation (i.e. business financials were uploaded). A personal
    //     organizer 1040 legitimately has none, so no fallback call and no warning for it.
    //   • 990 / 1041 → excluded entirely (no book-to-tax template applies).
    const entityType = String(payload.metadata?.returnType || payload.returnType || "").trim();
    const normalizedEntity = entityType.replace(/\s+/g, "");
    const isNoReconEntity = /^(990|1041)$/i.test(normalizedEntity);
    const is1040 = /^1040$/i.test(normalizedEntity);
    let m1Status = "";

    // GUARANTEE PATH: an M-1 entity whose main response lacked the structured object gets a
    // dedicated small second call that asks for just the reconciliation. Cost only on failure.
    if (!hasReconciliation(parsed.reconciliation) && !isNoReconEntity && !is1040) {
      const fallback = await requestReconciliationFallback(apiKey, workbook, entityType, { userId: req.user?.email || req.user?.id || "unknown" });
      if (fallback) {
        parsed.reconciliation = fallback.reconciliation;
        logClaudeCost(req, fallback.result, "preparation", "preparation_recon_fallback", payload, startedAt);
        m1Status = "Book-to-Tax (M-1): the main response was missing the structured reconciliation, so a dedicated follow-up call rebuilt it. ";
      }
    }

    if (hasReconciliation(parsed.reconciliation) && !isNoReconEntity) {
      const m1Sheet = buildM1Sheet(parsed.reconciliation, entityType);
      const withoutOldRecon = workbook.sheets.filter((s) => !/book.?to.?tax|reconciliation|\bm-?1\b/i.test(String(s.name || "")));
      // Insert the M-1 near the front (after any Lead Sheet), before the detail tabs.
      const insertAt = withoutOldRecon.findIndex((s) => !/lead\s*sheet|summary/i.test(String(s.name || "")));
      withoutOldRecon.splice(insertAt < 0 ? 0 : insertAt, 0, m1Sheet);
      workbook.sheets = withoutOldRecon;
      m1Status = `${m1Status}${m1Sheet.name}: rebuilt in code from the structured reconciliation object (fixed lines + live formulas — deterministic across runs)${entityType ? ` [return type: ${entityType}]` : " [return type not set — assumed a Schedule M-1 entity; set the Return Type field to be explicit]"}.`;

      // K-1 bridge: for 1065 / 1120-S, allocate the M-1 result to each owner on a
      // "Schedule K-1 Allocation" tab whose Total column references the M-1 by LIVE
      // formula and whose owner columns are Total × an editable % cell. The AI's own
      // free-form K-1 tabs are replaced so two runs can't diverge on the allocation.
      const k1Sheet = buildK1Sheet(m1Sheet, parsed.owners, entityType);
      if (k1Sheet) {
        workbook.sheets = workbook.sheets.filter((s) => s.verbatim
          || !/schedule\s*k-?1|k-?1\s*(allocation|summary|placeholder)/i.test(String(s.name || "")));
        const m1Index = workbook.sheets.indexOf(m1Sheet);
        workbook.sheets.splice(m1Index + 1, 0, k1Sheet);
        const ownerCount = Math.max(1, (Array.isArray(parsed.owners) ? parsed.owners : []).filter((o) => o && o.name).length);
        m1Status += ` Schedule K-1 Allocation built for ${ownerCount} owner(s), formula-linked to the M-1.`;
      }
    } else if (!isNoReconEntity && !is1040) {
      // Even the dedicated fallback failed — flag it LOUDLY so the preparer re-runs instead
      // of trusting a free-form (divergent) reconciliation.
      m1Status = "⚠ NEEDS REVIEW — the AI did NOT return the structured reconciliation object (and the dedicated follow-up call also failed), so the deterministic Book-to-Tax (M-1) could not be built. Re-run the preparation; if this persists, set the Return Type field explicitly (1065 / 1120 / 1120-S).";
    }

    // Diagnostics: surface, inside the workbook itself, exactly which code path ran.
    // This makes it possible to confirm a deploy is live and to see whether the AI
    // actually produced the workbook or the safety fallback had to be used.
    const wasTruncated = result.data?.stop_reason === "max_tokens";
    const claudeSheetCount = Array.isArray(parsed?.sheets) ? parsed.sheets.length : 0;
    const roleSummary = (payload.files || [])
      .map((f) => `${f.name} -> ${f.preparationRole || "?"}`)
      .join("; ");
    const diagnostics = [
      `[workpaper engine v4 | ${new Date().toISOString()}]`,
      `Preparation year: ${payload.metadata?.taxYear || "(none)"}`,
      `AI returned ${claudeSheetCount} sheet(s); ${workbook.usedTemplateFallback ? "TEMPLATE FALLBACK USED (AI output unusable)" : "AI-generated workbook used"}.`,
      wasTruncated ? "WARNING: AI response hit the max_tokens limit and was truncated. Re-run; if it persists the workbook is too large." : "AI response completed (not truncated).",
      `File roles: ${roleSummary || "(none)"}`,
      ...(m1Status ? [m1Status] : []),
      ...(archiveNote ? [archiveNote] : []),
    ];
    if (workbook.usedTemplateFallback) {
      diagnostics.push("ACTION REQUIRED: The AI did not return a usable workbook, so only the empty prior-year structure was provided (all amounts blank). Re-run the preparation to get populated current-year numbers.");
    }
    workbook.aiNotes = [...diagnostics, ...(Array.isArray(workbook.aiNotes) ? workbook.aiNotes : [])];
    // Refresh the AI Notes sheet so the diagnostics are visible in the downloaded file.
    const aiNotesSheet = workbook.sheets.find((s) => String(s.name || "").trim().toLowerCase() === "ai notes");
    if (aiNotesSheet) {
      aiNotesSheet.rows = [["AI Notes"], ...workbook.aiNotes.map((note) => [String(note)])];
    }

    const entryGuide = normalizeOrBuildEntryGuide(parsed, workbook, payload);

    // NOTE: a naive code recompute of the book-to-tax running subtotals was tried and
    // reverted — the reconciliation structure varies too much run to run (differently
    // worded subtotal labels, "separately stated" sections that must not be summed into
    // ordinary income, duplicated lines), so summing the model's free-form rows produced
    // a confident but WRONG taxable income. The real fix is a fixed reconciliation template
    // (a set order of adjustment lines the model fills, then code sums that fixed shape).
    // Until then, completeness/consistency is pushed via prompt rules 5a/5b.

    appendEntryGuideSheetToWorkbook(workbook, entryGuide);

    // Append every uploaded financial report (P&L, Balance Sheet, asset detail, etc.) as
    // its own verbatim tab, so the preparer always has the original source alongside the
    // tax workpaper and nothing that was uploaded is lost.
    appendSourceReportSheets(workbook, payload.files || []);

    // Canonical tab names + fixed order (must run BEFORE formula linking, which references
    // sheets by name inside the generated formulas).
    canonicalizeWorkbookSheets(workbook);

    // Section totals as live SUM chains on EVERY sheet (nested-aware: "Total Expenses" =
    // loose accounts + inner section totals), then the statement-level arithmetic (Net
    // Income = Income − COGS − Expenses ± Other, Total L&E = Liabilities + Equity, BS Net
    // Income → P&L). This is the middle link that makes human edits propagate: detail edit
    // → section total → statement total → M-1 → Data Entry Guide.
    injectSectionTotalFormulas(workbook);
    injectFinancialStatementFormulas(workbook);

    // Cross-tab formula chain (unique-match only, IFERROR-wrapped): P&L net income → M-1,
    // AJE Worksheet → M-1 AJE rows, M-1 → Data Entry Guide fields, and LIVE tie-out checks
    // (difference = guide − financial as a real formula). Editing the P&L reflows the M-1,
    // the entry guide, and the tie-outs automatically.
    linkEntryGuideToWorkpaper(workbook);

    // Pass through Drake-specific extraction arrays (optional, omitted when empty)
    const transactions8949 = normalizeTransactions8949(parsed.transactions8949);
    const assets4562        = normalizeAssets4562(parsed.assets4562);
    const w2s        = normalizeW2s(parsed.w2s);
    const int_1099s  = normalize1099s(parsed.int_1099s,  ["tsj","payer","ein","box1","box2","box3","box4"]);
    const div_1099s  = normalize1099s(parsed.div_1099s,  ["tsj","payer","ein","box1a","box1b","box2a","box4"]);
    const ret_1099rs = normalize1099s(parsed.ret_1099rs, ["tsj","payer","ein","box1","box2a","box4","box7","box7_ira"]);
    const ssa_1099s  = normalize1099s(parsed.ssa_1099s,  ["tsj","box3","box4"]);
    const nec_1099s  = normalize1099s(parsed.nec_1099s,  ["tsj","payer","ein","box1","box4"]);
    const misc_1099s = normalize1099s(parsed.misc_1099s, ["tsj","payer","ein","box3","box7","box4"]);

    // Render a fully-styled .xlsx server-side (real numbers, currency formatting, navy
    // headers, shaded totals, and code-verified SUM formulas). Best-effort: if generation
    // fails for any reason, the response still ships the JSON workbook so the browser can
    // fall back to the legacy SheetJS build — the download never breaks.
    let xlsxBase64 = "";
    try {
      const buffer = await buildStyledWorkpaperXlsx(workbook);
      xlsxBase64 = Buffer.from(buffer).toString("base64");
      // Archive every generated workpaper under the client's folder so next season's
      // roll-forward has it available. Best-effort: never blocks the response.
      if (prepClientId) {
        try {
          const saved = saveWorkpaperToArchive(CLIENT_FILES_DIR, prepClientId, taxYear, Buffer.from(buffer));
          if (saved) workbook.aiNotes.push(`Workpaper archived for next-season roll-forward as ${saved.file}.`);
        } catch (archiveError) {
          console.warn("[Preparation] archive save failed:", archiveError?.message || archiveError);
        }
      }
    } catch (xlsxError) {
      console.warn("[Preparation] styled xlsx generation failed, falling back to client build:", xlsxError?.message || xlsxError);
    }

    endHeartbeatResponse(res, {
      workbook,
      entryGuide,
      ...(xlsxBase64 ? { xlsxBase64 } : {}),
      ...(transactions8949.length ? { transactions8949 } : {}),
      ...(assets4562.length        ? { assets4562 }        : {}),
      ...(w2s.length               ? { w2s }               : {}),
      ...(int_1099s.length         ? { int_1099s }         : {}),
      ...(div_1099s.length         ? { div_1099s }         : {}),
      ...(ret_1099rs.length        ? { ret_1099rs }        : {}),
      ...(ssa_1099s.length         ? { ssa_1099s }         : {}),
      ...(nec_1099s.length         ? { nec_1099s }         : {}),
      ...(misc_1099s.length        ? { misc_1099s }        : {}),
      raw,
      model: result.data.model || result.model,
      usage: result.data.usage || null,
      costEstimate: estimateClaudeCost(result.data.usage || null),
    });
  } catch (error) {
    endHeartbeatResponse(res, {
      error: error.message || "Claude did not return usable workbook sheets. No Excel file was generated.",
      raw,
    });
    return;
  }
}

function normalizeTransactions8949(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.map((tx) => ({
    description:  String(tx.description  || ""),
    dateAcquired: String(tx.dateAcquired || ""),
    dateSold:     String(tx.dateSold     || ""),
    proceeds:     Number(tx.proceeds)    || 0,
    basis:        Number(tx.basis)       || 0,
    form8949Box:  String(tx.form8949Box  || "A").toUpperCase(),
    adjCode:      String(tx.adjCode      || ""),
    adjAmount:    tx.adjAmount != null ? Number(tx.adjAmount) : null,
    washSaleLoss: tx.washSaleLoss != null ? Number(tx.washSaleLoss) : null,
    tsj:          String(tx.tsj || "T").toUpperCase(),
  })).filter((tx) => tx.description || tx.proceeds || tx.basis);
}

function normalizeAssets4562(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.map((a) => ({
    description:       String(a.description       || ""),
    dateInService:     String(a.dateInService      || a.dateInservice || ""),
    cost:              Number(a.cost)              || 0,
    method:            String(a.method             || "SL").toUpperCase(),
    life:              Number(a.life)              || 5,
    priorDepreciation: Number(a.priorDepreciation) || 0,
    section179:        a.section179       != null ? Number(a.section179)       : null,
    bonusDepreciation: a.bonusDepreciation != null ? Number(a.bonusDepreciation): null,
    businessUsePct:    a.businessUsePct   != null ? Number(a.businessUsePct)   : 100,
  })).filter((a) => a.description || a.cost);
}

function normalizeW2s(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const n = (v) => (v != null && v !== "" ? Number(v) || 0 : null);
  return raw.map((w) => ({
    tsj:               String(w.tsj || w.ts || "T").toUpperCase().charAt(0),
    employer:          String(w.employer || w.employer_name || w.Employer_Name || ""),
    ein:               String(w.ein || w.employer_ein || w.EIN || ""),
    box1:              n(w.box1 ?? w.wages ?? w.box1_wages),
    box2:              n(w.box2 ?? w.fedWH ?? w.box2_federal_wh ?? w.box2_fedWH),
    box3:              n(w.box3 ?? w.ssWages ?? w.box3_ss_wages),
    box4:              n(w.box4 ?? w.ssWH ?? w.box4_ss_wh),
    box5:              n(w.box5 ?? w.medWages ?? w.box5_medicare_wages),
    box6:              n(w.box6 ?? w.medWH ?? w.box6_medicare_wh),
    box12_code:        w.box12_code || w.box12Code || null,
    box12_amount:      n(w.box12_amount ?? w.box12Amount),
    box13_retirement:  !!(w.box13_retirement || w.box13Retirement || w.retirement_plan),
    box15_state:       String(w.box15_state || w.box15State || w.state || ""),
    box16_state_wages: n(w.box16_state_wages ?? w.box16StateWages ?? w.stateWages),
    box17_state_wh:    n(w.box17_state_wh   ?? w.box17StateWH    ?? w.stateWH),
  })).filter((w) => w.employer || w.ein || w.box1);
}

function normalize1099s(raw, fields) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const n = (v) => (v != null && v !== "" ? Number(v) : null);
  return raw.map((item) => {
    const out = { tsj: String(item.tsj || item.ts || "T").toUpperCase().charAt(0) };
    for (const f of fields) {
      if (f === "tsj") continue;
      if (f.startsWith("box")) out[f] = n(item[f]);
      else out[f] = item[f] != null ? String(item[f]) : "";
    }
    return out;
  }).filter((item) => {
    const vals = Object.values(item).filter((v) => v !== "" && v !== null && v !== "T" && v !== "S");
    return vals.length > 0;
  });
}

const DRAKE_EXPORT_PATTERNS = [
  { key: "tax.total_tax", pattern: /\b(total\s+tax|tax\s+liability)\b/i },
  { key: "tax.taxable_income", pattern: /\b(taxable\s+income|income\s+subject\s+to\s+tax)\b/i },
  { key: "m1.net_income_book", pattern: /\b(net\s+income\s+per\s+books?|book\s+income|income\s+per\s+books?)\b/i },
  { key: "income.returns_allowances", pattern: /\b(returns?\s+and\s+allowances?|allowances?\s+and\s+returns?)\b/i },
  { key: "income.cogs", pattern: /\b(cost\s+of\s+goods\s+sold|cogs|cost\s+of\s+sales|total\s+purchases)\b/i },
  { key: "income.dividends", pattern: /\b(dividend\s+(income|revenue)|dividends\s+received)\b/i },
  { key: "income.interest", pattern: /\b(interest\s+(income|revenue)|taxable\s+interest)\b/i },
  { key: "income.capital_gain", pattern: /\b(capital\s+gain|schedule\s+d|gain\s+on\s+sale|loss\s+on\s+sale)\b/i },
  { key: "income.other_income", pattern: /\b(other\s+income|miscellaneous\s+income|nonoperating\s+income)\b/i },
  { key: "income.gross_receipts", pattern: /\b(gross\s+(receipts|sales)|receipts?\s+or\s+sales|sales\s+revenue|total\s+revenue|gross\s+revenue)\b/i },
  { key: "deductions.officer_comp", pattern: /\b(officer\s+compensation|compensation\s+of\s+officers?|shareholder\s+wages?)\b/i },
  { key: "deductions.salaries_wages", pattern: /\b(salaries?\s+and\s+wages?|wages?|payroll\s+expense|salary\s+expense)\b/i },
  { key: "deductions.repairs", pattern: /\b(repairs?\s+and\s+maintenance|repairs?|maintenance)\b/i },
  { key: "deductions.rents", pattern: /\b(rent|rental\s+expense|lease\s+expense)\b/i },
  { key: "deductions.taxes_licenses", pattern: /\b(taxes?\s+and\s+licenses?|licenses?|payroll\s+tax|property\s+tax|state\s+tax)\b/i },
  { key: "deductions.interest", pattern: /\b(interest\s+expense|loan\s+interest|bank\s+interest)\b/i },
  { key: "deductions.depreciation", pattern: /\b(depreciation|amortization|section\s+179|4562)\b/i },
  { key: "deductions.advertising", pattern: /\b(advertising|marketing|promotion)\b/i },
  { key: "deductions.pension", pattern: /\b(pension|profit.?sharing|retirement\s+plan|401k)\b/i },
  { key: "deductions.employee_benefits", pattern: /\b(employee\s+benefits?|health\s+insurance|benefit\s+program)\b/i },
  { key: "deductions.meals_50", pattern: /\b(meals?|entertainment|travel\s+meals?)\b/i },
  { key: "deductions.charitable", pattern: /\b(charitable|contribution|donation)\b/i },
  { key: "deductions.other", pattern: /\b(other\s+(deductions?|expenses?)|miscellaneous\s+expense|office\s+expense|professional\s+fees?)\b/i },
  { key: "balance.cash", pattern: /\b(cash|checking|savings|bank\s+account)\b/i },
  { key: "balance.ar", pattern: /\b(accounts?\s+receivable|trade\s+receivables?|a\/r)\b/i },
  { key: "balance.inventory", pattern: /\b(inventor(y|ies)|ending\s+inventory)\b/i },
  { key: "balance.fixed_assets", pattern: /\b(fixed\s+assets?|depreciable\s+assets?|buildings?|equipment|furniture|vehicles?)\b/i },
  { key: "balance.accum_depr", pattern: /\b(accumulated\s+depreciation|accum\s+depr|contra\s+asset)\b/i },
  { key: "balance.ap", pattern: /\b(accounts?\s+payable|trade\s+payables?|a\/p)\b/i },
  { key: "balance.retained_earnings", pattern: /\b(retained\s+earnings|partners?'?\s+capital|capital\s+account|equity)\b/i },
  { key: "m1.meals_disallowed", pattern: /\b(meals?\s+disallowed|50%\s+meals?|nondeductible\s+meals?)\b/i },
  { key: "m1.depreciation_diff", pattern: /\b(depreciation\s+(difference|adjustment)|book\s+depr|tax\s+depr)\b/i },
  { key: "m1.tax_exempt_interest", pattern: /\b(tax.?exempt\s+interest|municipal\s+interest)\b/i },
  { key: "schK.ordinary_income", pattern: /\b(schedule\s+k.*ordinary|ordinary\s+business\s+income)\b/i },
  { key: "schK.guaranteed_payments", pattern: /\b(guaranteed\s+payments?)\b/i },
  { key: "schK.interest_income", pattern: /\b(schedule\s+k.*interest|k-1.*interest)\b/i },
  { key: "schK.net_rental", pattern: /\b(net\s+rental|rental\s+real\s+estate)\b/i },
  { key: "schK.section179", pattern: /\b(schedule\s+k.*179|section\s+179)\b/i },
  { key: "schK.distributions", pattern: /\b(distributions?|draws?)\b/i },
  { key: "capital.beginning", pattern: /\b(beginning\s+capital|capital\s+beginning)\b/i },
  { key: "capital.ending", pattern: /\b(ending\s+capital|capital\s+ending)\b/i },
  { key: "m2.retained_beginning", pattern: /\b(beginning\s+retained|retained\s+earnings\s+beginning)\b/i },
  { key: "m2.retained_ending", pattern: /\b(ending\s+retained|retained\s+earnings\s+ending)\b/i },
  { key: "m2.aaa_beginning", pattern: /\b(aaa\s+beginning|beginning\s+aaa)\b/i },
  { key: "m2.aaa_ending", pattern: /\b(aaa\s+ending|ending\s+aaa)\b/i },
];

function normalizeDrakeEntityType(value) {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (text.includes("1120S")) return "1120S";
  if (text.includes("1065")) return "1065";
  if (text.includes("1120")) return "1120";
  if (text.includes("1040")) return "1040";
  return "";
}

function parseDrakeAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim();
  if (!raw || /%$/.test(raw)) return null;
  if (/^\d{4}$/.test(raw) && Number(raw) >= 1900 && Number(raw) <= 2035) return null;
  const negative = /^\(.*\)$/.test(raw) || /^-/.test(raw);
  const cleaned = raw.replace(/[()$,]/g, "").replace(/[^\d.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function drakeTextFromValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return [value.label, value.name, value.title, value.description, value.value, value.amount].filter(Boolean).join(" ");
  return String(value);
}

function identifyDrakeCanonicalKey(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value || value.length > 500) return "";
  const match = DRAKE_EXPORT_PATTERNS.find((item) => item.pattern.test(value));
  return match?.key || "";
}

function addDrakeField(fieldMap, canonicalKey, amount, source, note = "") {
  if (!canonicalKey || amount === null || amount === undefined || !Number.isFinite(Number(amount))) return;
  const value = Number(amount);
  const existing = fieldMap.get(canonicalKey);
  if (!existing || source === "entryGuide") {
    fieldMap.set(canonicalKey, {
      canonicalKey,
      value,
      flag: "ok",
      note: [source, note].filter(Boolean).join(": "),
    });
  }
}

function extractDrakeFieldsFromEntryGuide(entryGuide, fieldMap) {
  for (const screen of entryGuide?.screens || []) {
    for (const field of screen.fields || []) {
      const status = String(field.status || "").toLowerCase();
      if (status === "not_applicable") continue;
      const text = [
        screen.screenPath,
        screen.screenDescription,
        field.fieldName,
        field.fieldDescription,
        field.lineReference,
        field.valueSource,
      ].map(drakeTextFromValue).filter(Boolean).join(" ");
      const key = identifyDrakeCanonicalKey(text);
      const amount = parseDrakeAmount(field.amount ?? field.value);
      addDrakeField(fieldMap, key, amount, "entryGuide", field.lineReference || field.fieldName || "");
    }
  }
}

function shouldSkipDrakeWorkbookSheet(sheetName) {
  return /\b(prior|template|source|raw|input|ai notes|data entry guide|entry guide|instructions?)\b/i.test(String(sheetName || ""));
}

function extractDrakeFieldsFromWorkbook(workbook, fieldMap) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  for (const sheet of sheets) {
    const sheetName = String(sheet?.name || "Workpaper");
    if (shouldSkipDrakeWorkbookSheet(sheetName)) continue;
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const cells = row.map((cell) => drakeTextFromValue(cell).trim()).filter(Boolean);
      if (!cells.length) continue;
      const labelText = cells.filter((cell) => parseDrakeAmount(cell) === null).join(" ");
      const key = identifyDrakeCanonicalKey(`${sheetName} ${labelText}`);
      if (!key) continue;
      const amounts = row.map(parseDrakeAmount).filter((amount) => amount !== null);
      const amount = amounts.length ? amounts[amounts.length - 1] : null;
      addDrakeField(fieldMap, key, amount, "workbook", sheetName);
    }
  }
}

function buildDrakeExportData(payload) {
  const workbook = payload.workbook || payload.response?.workbook || {};
  const entryGuide = payload.entryGuide || payload.response?.entryGuide || {};
  const metadata = payload.metadata || payload.payload?.metadata || {};
  const db = readDb();
  const clientId = payload.clientId || metadata.clientId || payload.client?.id || "";
  const dbClient = clientId ? db.clients?.[clientId] : null;
  const client = {
    name: String(payload.client?.name || metadata.clientName || dbClient?.name || "Client").trim(),
    ein: String(payload.client?.ein || metadata.ein || dbClient?.ein || "").trim(),
    // Fallback chain: explicit client field → metadata → entryGuide (AI-set) → database client → top-level payload
    entityType: normalizeDrakeEntityType(
      payload.client?.entityType ||
      metadata.returnType ||
      entryGuide?.returnType ||
      dbClient?.returnType ||
      dbClient?.entityType ||
      payload.returnType
    ),
  };
  const taxYear = String(metadata.taxYear || payload.taxYear || entryGuide.taxYear || "").trim();
  const fieldMap = new Map();
  extractDrakeFieldsFromEntryGuide(entryGuide, fieldMap);
  extractDrakeFieldsFromWorkbook(workbook, fieldMap);
  return {
    client,
    taxYear,
    fields: [...fieldMap.values()],
  };
}

async function handlePreparationExportDrake(req, res) {
  const payload = await readJsonBody(req);
  const taxSoftware = String(payload.taxSoftware || payload.metadata?.taxSoftware || "").toLowerCase();
  if (taxSoftware && taxSoftware !== "drake") {
    sendJson(res, 400, { error: "Select Drake Tax as the tax software before exporting to Drake." });
    return;
  }

  const data = buildDrakeExportData(payload);
  if (!data.client.entityType) {
    sendJson(res, 400, { error: "Could not identify a Drake-supported return type. Use 1040, 1065, 1120, or 1120S." });
    return;
  }
  if (!data.taxYear) {
    sendJson(res, 400, { error: "Tax year is required before exporting to Drake." });
    return;
  }
  if (!data.fields.length) {
    sendJson(res, 400, { error: "No Drake-loadable fields were found in the generated workbook. Review the Data Entry Guide and rerun with Drake selected as the tax software." });
    return;
  }

  try {
    const { DrakeAdapter } = require("./tax-loader/adapters/drakeAdapter");
    const { writeArtifact } = require("./tax-loader/companion/companion");
    const adapter = new DrakeAdapter({});
    const artifact = await adapter.prepare(data);
    const written = writeArtifact({
      software: "drake",
      kind: artifact.kind,
      filename: artifact.filename,
      content: artifact.content,
      contentBase64: artifact.contentBase64,
      meta: artifact.meta,
    });
    sendJson(res, 200, {
      ok: true,
      ...written,
      filename: artifact.filename,
      fieldsLoaded: artifact.meta?.fieldCount || data.fields.length,
      skipped: artifact.meta?.skipped || [],
      extractedFields: data.fields.map((field) => ({ canonicalKey: field.canonicalKey, value: field.value })),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Drake export failed.",
      hint: "Run this from the local Windows app with Drake/Excel installed and confirm the Drake trial balance template exists in C:\\DRAKE25\\TB\\.",
    });
  }
}

// ── Drake Generate — download Schedule C, Form 8949, Form 4562 ─
// POST /api/preparation/drake-generate
// { fileType: "schedule_c" | "form_8949" | "form_4562",
//   workbook, entryGuide, metadata, client, transactions8949, assets4562, ... }
// → { ok, filename, contentBase64, mimeType, meta }
async function handleDrakeGenerate(req, res) {
  const payload = await readJsonBody(req);
  const fileType = String(payload.fileType || "").trim();
  if (!fileType) {
    sendJson(res, 400, { error: "fileType is required (schedule_c | form_8949 | form_4562)." });
    return;
  }

  const data = buildDrakeExportData(payload);
  if (!data.client.entityType) {
    sendJson(res, 400, { error: "Could not identify a Drake-supported return type. Use 1040, 1065, 1120, or 1120S." });
    return;
  }

  try {
    if (fileType === "schedule_c") {
      if (data.client.entityType !== "1040") {
        sendJson(res, 400, { error: "Schedule C is only available for 1040 returns." });
        return;
      }
      const { buildArtifact: buildSchC } = require("./tax-loader/generators/scheduleCGenerator");
      const artifact = buildSchC(data);
      const contentBase64 = Buffer.from(artifact.content, "utf8").toString("base64");
      sendJson(res, 200, {
        ok: true,
        filename: artifact.filename,
        contentBase64,
        mimeType: "text/csv",
        meta: artifact.meta || {},
      });
      return;
    }

    if (fileType === "form_8949") {
      const txRaw = payload.transactions8949;
      if (!Array.isArray(txRaw) || !txRaw.length) {
        sendJson(res, 400, { error: "No capital gain transactions found. Upload a 1099-B or brokerage statement and regenerate the workpaper." });
        return;
      }
      const transactions = normalizeTransactions8949(txRaw);
      const { buildArtifact: build8949 } = require("./tax-loader/generators/form8949Generator");
      const artifact = build8949(transactions, data.client.name || "client");
      const contentBase64 = Buffer.from(artifact.content, "utf8").toString("base64");
      sendJson(res, 200, {
        ok: true,
        filename: artifact.filename,
        contentBase64,
        mimeType: "text/csv",
        meta: artifact.meta || {},
      });
      return;
    }

    if (fileType === "form_4562") {
      const assetsRaw = payload.assets4562;
      if (!Array.isArray(assetsRaw) || !assetsRaw.length) {
        sendJson(res, 400, { error: "No depreciable assets found. Upload a depreciation schedule or prior-year Form 4562 and regenerate the workpaper." });
        return;
      }
      const assets = normalizeAssets4562(assetsRaw);
      const { buildArtifact: build4562 } = require("./tax-loader/generators/form4562Generator");
      const artifact = await build4562(assets, data.client.name || "client");
      const contentBase64 = artifact.buffer.toString("base64");
      sendJson(res, 200, {
        ok: true,
        filename: artifact.filename,
        contentBase64,
        mimeType: artifact.mimetype,
        meta: artifact.meta || {},
      });
      return;
    }

    sendJson(res, 400, { error: `Unknown fileType: ${fileType}. Use schedule_c, form_8949, or form_4562.` });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Drake generate failed." });
  }
}

async function handlePreparationDataEntryGuide(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();

  if (!apiKey) {
    sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." });
    return;
  }

  const returnType = String(payload.returnType || "1120").trim();
  const taxYear = String(payload.taxYear || new Date().getFullYear()).trim();
  const taxSoftware = String(payload.taxSoftware || "proconnect").trim();
  const content = [{
    type: "text",
    text: buildDataEntryGuidePrompt({
      ...payload,
      returnType,
      taxYear,
      taxSoftware,
      highReviewIssues: highReviewIssuesForEntryGuide(payload.reviewResult),
    }),
  }];

  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 6500,
    webSearch: false,
    system: [{ type: "text", text: withDatabaseContext(buildDataEntryGuideSystemPrompt(returnType, taxYear, taxSoftware), payload, "preparation") }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "data_entry_guide", "preparation", payload, startedAt);

  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  if (!parsed) {
    sendJson(res, 502, { error: "Claude did not return valid entry guide JSON.", raw });
    return;
  }

  const guide = normalizeEntryGuide(parsed, { ...payload, returnType, taxYear, taxSoftware });
  sendJson(res, 200, {
    guide,
    raw,
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

// ── Drake 1040 UI Load ────────────────────────────────────────────────────────
// POST /api/preparation/drake-ui-load
//
// Accepts either:
//   A) Pre-extracted uiPayload { client, spouse, w2s, int_1099s, ... }
//   B) Raw workpaper context { workbook, entryGuide, metadata } → Claude extracts
//
// Then POSTs the structured JSON to companion /ui-load which spawns drake_ui.py.

const DRAKE_UI_SYSTEM_PROMPT = `You are a U.S. tax-data extraction assistant.
Your only job is to read the provided 1040 workpaper / data-entry-guide content and
return a single JSON object that exactly matches the schema below.
Return ONLY the JSON object — no markdown, no explanation.

Schema:
{
  "client": {
    "ssn": "XXX-XX-XXXX",
    "first_name": "",
    "last_name": "",
    "middle_initial": "",
    "dob": "YYYY-MM-DD",
    "filing_status": "1",
    "address_street": "",
    "address_city": "",
    "address_state": "XX",
    "address_zip": ""
  },
  "spouse": {
    "ssn": "",
    "first_name": "",
    "last_name": "",
    "dob": "YYYY-MM-DD"
  },
  "w2s": [{
    "ts": "T",
    "employer_ein": "",
    "employer_name": "",
    "employer_street": "",
    "employer_city": "",
    "employer_state": "",
    "employer_zip": "",
    "box1_wages": 0,
    "box2_federal_wh": 0,
    "box3_ss_wages": 0,
    "box4_ss_wh": 0,
    "box5_medicare_wages": 0,
    "box6_medicare_wh": 0,
    "box16_state_wages": 0,
    "box17_state_tax": 0,
    "box15_state": ""
  }],
  "int_1099s":  [{ "payer_name": "", "payer_ein": "", "box1_interest": 0, "box4_federal_wh": 0 }],
  "div_1099s":  [{ "payer_name": "", "payer_ein": "", "box1a_total_dividends": 0, "box1b_qualified_dividends": 0, "box4_federal_wh": 0 }],
  "nec_1099s":  [{ "payer_name": "", "payer_ein": "", "box1_nec": 0, "box4_federal_wh": 0 }],
  "misc_1099s": [{ "payer_name": "", "payer_ein": "", "box3_other_income": 0, "box4_federal_wh": 0 }],
  "ssa_1099s":  [{ "ts": "T", "box5_net_benefits": 0 }]
}

Rules:
- Use empty string "" for unknown text fields.
- Use 0 for unknown numeric fields.
- "ts" must be "T" (taxpayer) or "S" (spouse).
- "filing_status": 1=Single, 2=MFJ, 3=MFS, 4=HOH, 5=QW.
- Omit any top-level array entirely if there are no records for it.
- "spouse" object is required even if empty.`;

async function handleDrakeUiLoad(req, res) {
  const payload = await readJsonBody(req);
  const apiKey  = String(process.env.ANTHROPIC_API_KEY || "").trim();
  const companionUrl   = String(payload.companionUrl   || process.env.COMPANION_URL   || "http://127.0.0.1:7777").trim();
  const companionToken = String(payload.companionToken || process.env.COMPANION_TOKEN || "cambiar-este-token").trim();
  const taxYear = String(payload.metadata?.taxYear || payload.taxYear || "").trim();

  // ── A) Payload already has pre-extracted uiPayload (skip Claude) ──
  if (payload.uiPayload?.client) {
    return _dispatchUiLoad(res, payload.uiPayload, companionUrl, companionToken, taxYear);
  }

  // ── B) Extract structured data from workpaper via Claude ──
  if (!apiKey) {
    sendJson(res, 400, { error: "Missing Claude API key (ANTHROPIC_API_KEY). Required to extract 1040 data from workpapers." });
    return;
  }

  const workbook    = payload.workbook    || payload.response?.workbook    || {};
  const entryGuide  = payload.entryGuide  || payload.response?.entryGuide  || {};
  const metadata    = payload.metadata    || payload.payload?.metadata     || {};
  const clientName  = payload.client?.name || metadata.clientName || "";
  const clientSSN   = payload.client?.ssn  || metadata.ssn        || payload.client?.ein || metadata.ein || "";

  const workpaperText = typeof workbook === "string"
    ? workbook
    : JSON.stringify(workbook, null, 2);
  const guideText = typeof entryGuide === "string"
    ? entryGuide
    : JSON.stringify(entryGuide, null, 2);

  const userContent = `Client: ${clientName || "(unknown)"}  SSN/EIN: ${clientSSN || "(unknown)"}  Tax Year: ${taxYear || "(unknown)"}

ENTRY GUIDE:
${guideText.slice(0, 12000)}

WORKPAPER DATA:
${workpaperText.slice(0, 8000)}

Extract all 1040 taxpayer data and return the JSON object.`;

  const content = [{ type: "text", text: userContent }];
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(
    apiKey,
    content,
    { knowledgeBase: [], reviewExamples: [] },
    { maxTokens: 4000, webSearch: false, system: [{ type: "text", text: DRAKE_UI_SYSTEM_PROMPT }] },
  );

  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "drake_ui_extract", "preparation", payload, startedAt);

  const raw = extractText(result.data);
  const uiPayload = parseClaudeJson(raw);
  if (!uiPayload || !uiPayload.client) {
    sendJson(res, 502, { error: "Claude did not return a valid 1040 UI payload.", raw });
    return;
  }

  // Overlay SSN if Claude missed it but we had it in metadata
  if (!uiPayload.client.ssn && clientSSN) uiPayload.client.ssn = clientSSN;

  return _dispatchUiLoad(res, uiPayload, companionUrl, companionToken, taxYear, {
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

async function _dispatchUiLoad(res, uiPayload, companionUrl, companionToken, taxYear, claudeMeta) {
  try {
    const response = await fetch(`${companionUrl}/ui-load`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Companion-Token": companionToken },
      body: JSON.stringify(uiPayload),
    });
    const companionResult = await response.json().catch(() => ({}));
    sendJson(res, response.ok ? 200 : 500, {
      ok:            companionResult.ok ?? response.ok,
      clientCreated: companionResult.client_created ?? false,
      identifier:    companionResult.identifier || uiPayload.client?.ssn || "",
      screensFilled: companionResult.screens_filled || [],
      warnings:      companionResult.warnings || [],
      errors:        companionResult.errors   || [],
      taxYear,
      ...claudeMeta,
    });
  } catch (err) {
    sendJson(res, 502, { error: `Companion /ui-load unreachable: ${err.message}. Make sure companion.js is running on the local CPA workstation.` });
  }
}

async function handleNotices(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();

  if (!apiKey) {
    sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." });
    return;
  }
  if (!payload.noticeFile || !payload.noticeFile.content) {
    sendJson(res, 400, { error: "Upload a notice document before analysis." });
    return;
  }

  const content = buildNoticeContent(payload);
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 5000,
    webSearch: false,
    system: [{ type: "text", text: withDatabaseContext(buildNoticeSystemPrompt(), payload, "notices") }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "notices", "notices", payload, startedAt);

  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  sendJson(res, 200, {
    notice: parsed || { internalNotes: raw },
    raw,
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

async function handleDiagnostics(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();

  if (!apiKey) {
    sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." });
    return;
  }
  const hasText = Boolean(String(payload.errorInput || "").trim());
  const hasImage = Boolean(payload.errorImage?.contentBase64 && payload.errorImage?.mimeType);
  if (!payload.taxSoftware) {
    sendJson(res, 400, { error: "Select tax software before analyzing diagnostics." });
    return;
  }
  if (!hasText && !hasImage) {
    sendJson(res, 400, { error: "Paste diagnostic text or upload an error screenshot." });
    return;
  }

  const content = buildDiagnosticsContent(payload);
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 6000,
    webSearch: true,
    models: [...MODEL_FALLBACKS, "claude-sonnet-4-5-20250929"],
    system: [{ type: "text", text: withDatabaseContext(buildDiagnosticsSystemPrompt(), payload, "diagnostics") }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "diagnostics", "diagnostics", payload, startedAt);

  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  sendJson(res, 200, {
    diagnostics: normalizeDiagnostics(parsed, raw, payload),
    raw,
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

async function handleOrganizer(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();

  if (!apiKey) {
    sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." });
    return;
  }
  if (!payload.priorYearReturn || !payload.priorYearReturn.content) {
    sendJson(res, 400, { error: "Upload a prior year return before generating the organizer." });
    return;
  }

  const content = buildOrganizerContent(payload);
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 7000,
    webSearch: false,
    system: [{ type: "text", text: withDatabaseContext(buildOrganizerSystemPrompt(), payload, "database") }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "organizer", "database", payload, startedAt);

  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  sendJson(res, 200, {
    organizer: normalizeOrganizer(parsed, raw, payload),
    raw,
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

async function handleDeliverable(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();

  if (!apiKey) {
    sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." });
    return;
  }
  if (!payload.reviewResult || typeof payload.reviewResult !== "object") {
    sendJson(res, 400, { error: "Run a Senior Review first, then generate deliverables." });
    return;
  }

  const content = buildDeliverableContent(payload);
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 6000,
    webSearch: false,
    system: [{ type: "text", text: withDatabaseContext(buildDeliverableSystemPrompt(), payload, "deliverable") }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "deliverable", "deliverable", payload, startedAt);

  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  sendJson(res, 200, {
    deliverable: normalizeDeliverable(parsed, raw),
    raw,
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

async function handleDeliverableEmailDraft(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();

  if (!apiKey) {
    sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." });
    return;
  }
  if (!payload.reviewResult || typeof payload.reviewResult !== "object") {
    sendJson(res, 400, { error: "Run a Senior Review first, then draft the client email." });
    return;
  }

  const content = buildDeliverableContent({ ...payload, deliverableType: "email" });
  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 3500,
    webSearch: false,
    system: [{ type: "text", text: withDatabaseContext(buildDeliverableSystemPrompt(), payload, "deliverable") }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "deliverable", "deliverable", payload, startedAt);

  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  sendJson(res, 200, {
    deliverable: normalizeDeliverable(parsed, raw),
    raw,
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

async function handleDeliverableLoadClientFolder(req, res) {
  const username = req.user?.username || "default";
  const payload = await readJsonBody(req);
  const folderId = String(payload.folderId || "").trim();
  const fileId = String(payload.fileId || payload.file?.driveFileId || "").trim();
  const filePayload = payload.file || null;
  if (!folderId && !fileId && !filePayload?.contentBase64) { sendJson(res, 400, { error: "Select a Google Drive folder or client info file first." }); return; }
  try {
    if (fileId || filePayload?.contentBase64) {
      sendJson(res, 200, await loadClientDataFromDriveFile({
        ...(filePayload || {}),
        fileId,
        mimeType: filePayload?.mimeType || filePayload?.type || payload.mimeType,
        name: filePayload?.name || payload.fileName,
      }, username));
      return;
    }
    sendJson(res, 200, await loadClientDataFromDriveFolder(folderId, username));
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.expose ? error.message : "Could not read the client info source." });
  }
}

async function handleDeliverableGenerateDraft(req, res) {
  const payload = await readJsonBody(req);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
  if (!apiKey) { sendJson(res, 400, { error: "Missing Claude API key. Set ANTHROPIC_API_KEY before starting the server." }); return; }
  if (!payload.client?.email) { sendJson(res, 400, { error: "Client email is required before generating a deliverable email." }); return; }

  const startedAt = Date.now();
  const result = await callClaudeContentWithFallbacks(apiKey, [{ type: "text", text: buildDeliverableDraftPrompt(payload) }], { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 3500,
    webSearch: false,
    system: [{ type: "text", text: withDatabaseContext(buildDeliverableDraftSystemPrompt(), payload, "deliverable") }],
  });
  if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
  logClaudeCost(req, result, "deliverable", "deliverable", payload, startedAt);
  const raw = extractText(result.data);
  const parsed = parseClaudeJson(raw);
  sendJson(res, 200, {
    draft: normalizeEmailDraft(parsed, raw),
    raw,
    model: result.data.model || result.model,
    usage: result.data.usage || null,
    costEstimate: estimateClaudeCost(result.data.usage || null),
  });
}

async function handleDeliverableGmailStatus(req, res) {
  const status = await gmailAuthorizationStatus(req.user?.username || "default");
  sendJson(res, 200, { ...status, enabled: isGoogleDriveEnabled() });
}

async function handleDeliverableSendGmail(req, res) {
  if (!GMAIL_SEND_ENABLED || !GOOGLE_OAUTH_SCOPE.includes(GOOGLE_GMAIL_SEND_SCOPE)) {
    sendJson(res, 403, { error: "Direct Gmail sending is disabled. Create a Gmail draft, review it in Gmail, and send it from there." });
    return;
  }
  const payload = await readJsonBody(req);
  if (!payload.to || !payload.subject || (!payload.bodyHtml && !payload.bodyText)) {
    sendJson(res, 400, { error: "Recipient, subject, and email body are required." });
    return;
  }
  const totalSize = (payload.attachments || []).reduce((sum, item) => sum + Buffer.byteLength(String(item.contentBase64 || ""), "base64"), 0);
  if (totalSize > 25 * 1024 * 1024) {
    sendJson(res, 400, { error: "Total attachments exceed Gmail's 25MB limit. Consider sending Drive links instead." });
    return;
  }
  const username = req.user?.username || "default";
  const gmailStatus = await gmailAuthorizationStatus(username);
  if (!gmailStatus.authorized) {
    sendJson(res, 403, { error: "Gmail send permission is not authorized. Reconnect Google and grant Gmail permission." });
    return;
  }
  const rawEmail = buildMimeEmail({
    to: payload.to,
    cc: [payload.ccPreparer ? payload.preparerEmail : "", payload.cc].filter(Boolean).join(", "),
    subject: payload.subject,
    bodyText: payload.bodyText || htmlToPlainText(payload.bodyHtml || ""),
    bodyHtml: payload.bodyHtml || plainTextToHtml(payload.bodyText || ""),
    attachments: payload.attachments || [],
  });
  const encodedEmail = Buffer.from(rawEmail).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const response = await googleApiFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raw: encodedEmail }),
  }, username);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    sendJson(res, response.status, { error: data.error?.message || "Gmail could not send the email." });
    return;
  }
  appendAuditLog(req, "gmail.sent", { to: payload.to, attachmentCount: (payload.attachments || []).length });
  sendJson(res, 200, { ok: true, messageId: data.id, threadId: data.threadId });
}

async function handleDeliverableCreateGmailDraft(req, res) {
  const payload = await readJsonBody(req);
  if (!payload.to || !payload.subject || (!payload.bodyHtml && !payload.bodyText)) {
    sendJson(res, 400, { error: "Recipient, subject, and email body are required before creating a Gmail draft." });
    return;
  }
  const totalSize = (payload.attachments || []).reduce((sum, item) => sum + Buffer.byteLength(String(item.contentBase64 || ""), "base64"), 0);
  if (totalSize > 25 * 1024 * 1024) {
    sendJson(res, 400, { error: "Total attachments exceed Gmail's 25MB limit. Consider sending Drive links instead." });
    return;
  }
  const username = req.user?.username || "default";
  const gmailStatus = await gmailAuthorizationStatus(username);
  if (!gmailStatus.authorized) {
    sendJson(res, 403, { error: "Gmail permission is not authorized. Reconnect Google and grant Gmail permission." });
    return;
  }
  const rawEmail = buildMimeEmail({
    to: payload.to,
    cc: [payload.ccPreparer ? payload.preparerEmail : "", payload.cc].filter(Boolean).join(", "),
    subject: payload.subject,
    bodyText: payload.bodyText || htmlToPlainText(payload.bodyHtml || ""),
    bodyHtml: payload.bodyHtml || plainTextToHtml(payload.bodyText || ""),
    attachments: payload.attachments || [],
  });
  const encodedEmail = Buffer.from(rawEmail).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const response = await googleApiFetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { raw: encodedEmail } }),
  }, username);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    sendJson(res, response.status, { error: data.error?.message || "Gmail could not create the draft." });
    return;
  }
  const draftId = data.id || "";
  appendAuditLog(req, "gmail.draft_created", { to: payload.to, attachmentCount: (payload.attachments || []).length });
  sendJson(res, 200, {
    ok: true,
    draftId,
    messageId: data.message?.id || "",
    gmailUrl: "https://mail.google.com/mail/u/0/#drafts",
  });
}

async function handleResearchChat(req, res) {
  const startedAt = Date.now();
  const payload = await readJsonBody(req);
  const question = String(payload.question || "").trim();
  if (!question) {
    sendJson(res, 400, { error: "Question is required." });
    return;
  }
  if (!ANTHROPIC_API_KEY) {
    sendJson(res, 503, { error: "Claude API key is not configured." });
    return;
  }

  const username = req.user?.username || getSession(req)?.username || "anonymous";
  const suppliedHistory = Array.isArray(payload.messages) ? payload.messages : [];
  const savedHistory = researchHistories.get(username) || [];
  const history = normalizeResearchHistory(suppliedHistory.length ? suppliedHistory : savedHistory);
  const result = await callResearchClaude({
    question,
    history,
    context: payload.context || {},
    useThinking: payload.useThinking !== false,
    webSearch: payload.webSearch !== false,
  });

  if (!result.ok) {
    sendJson(res, result.status || 502, { error: result.error || "Tax research failed." });
    return;
  }

  const answer = extractResearchText(result.data);
  const thinking = extractResearchThinking(result.data);
  const sources = extractResearchSources(result.data, answer);
  const webSearchUsed = (result.data.content || []).some((block) =>
    block?.type === "web_search_tool_result" ||
    (block?.type === "server_tool_use" && block?.name === "web_search") ||
    (Array.isArray(block?.citations) && block.citations.some((citation) => citation?.url))
  );
  const nextHistory = [...history, { role: "user", content: question }, { role: "assistant", content: answer }].slice(-20);
  researchHistories.set(username, nextHistory);
  logClaudeCost(req, result, "research", "research", { context: payload.context || {}, question }, startedAt);
  const usage = result.data.usage || {};
  const cost = calculateCost(usage, result.data.model || result.model);
  sendJson(res, 200, {
    answer,
    thinking,
    sources,
    model: result.data.model || result.model,
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    thinkingTokens: Number(usage.output_tokens || 0),
    totalCost: cost.totalCost,
    webSearchUsed,
  });
}

async function handleResearchClear(req, res) {
  const username = req.user?.username || getSession(req)?.username || "anonymous";
  researchHistories.set(username, []);
  sendJson(res, 200, { ok: true });
}

function normalizeResearchHistory(messages) {
  return messages
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .map((message) => ({ role: message.role, content: String(message.content || "").slice(0, 8000) }))
    .filter((message) => message.content.trim())
    .slice(-10);
}

async function callResearchClaude({ question, history, context, useThinking, webSearch }) {
  const model = "claude-sonnet-4-6";
  // cache_control on the system block tells Anthropic to cache the static instructions.
  // User context travels in buildResearchQuestion (already there), so the system prompt
  // is fully static and cache hits on every question in the same session.
  const system = [{ type: "text", text: buildResearchSystemPrompt(), cache_control: { type: "ephemeral" } }];
  // Cache the conversation history so subsequent questions in a session only pay
  // for new content. cache_control on the last historical message tells Anthropic
  // to cache everything up to that point (system + all prior turns) at $0.30/MTok
  // instead of $3/MTok on re-reads. First question has no history so no marker needed.
  const historyMessages = history.map((msg, i) =>
    i === history.length - 1
      ? { role: msg.role, content: [{ type: "text", text: String(msg.content || ""), cache_control: { type: "ephemeral" } }] }
      : msg
  );
  const messages = [...historyMessages, { role: "user", content: buildResearchQuestion(question, context) }];
  const baseBody = {
    model,
    max_tokens: 8000,
    system,
    messages,
  };
  if (useThinking) baseBody.thinking = { type: "enabled", budget_tokens: 5000 };
  if (WEB_SEARCH_ENABLED && webSearch) {
    baseBody.tools = [buildWebSearchTool()];
    baseBody.tool_choice = { type: "auto" };
  }

  const first = await postClaudeResearchBody(baseBody);
  if (first.ok) return { ok: true, data: first.data, model };
  const errorText = String(first.error || "").toLowerCase();
  const fallbackBody = {
    model: MODEL_FALLBACKS[0] || "claude-sonnet-4-6",
    max_tokens: 8000,
    system,
    messages,
  };
  if (WEB_SEARCH_ENABLED && webSearch && !errorText.includes("tool")) {
    fallbackBody.tools = [buildWebSearchTool()];
    fallbackBody.tool_choice = { type: "auto" };
  }
  const fallback = await postClaudeResearchBody(fallbackBody);
  if (fallback.ok) return { ok: true, data: fallback.data, model: fallbackBody.model };
  return { ok: false, status: fallback.status || first.status, error: `${first.error || "Research model failed."} Fallback: ${fallback.error || "failed."}` };
}

async function postClaudeResearchBody(body) {
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok) return { ok: true, data };
  return { ok: false, status: response.status, error: data.error?.message || data.message || "Claude API request failed." };
}

function extractResearchText(data) {
  return (data.content || []).filter((block) => block.type === "text" && block.text).map((block) => block.text).join("\n\n").trim() || "Claude returned no answer text.";
}

function extractResearchThinking(data) {
  return (data.content || []).filter((block) => block.type === "thinking" && block.thinking).map((block) => block.thinking).join("\n\n").trim();
}

function parseSourcesFromAnswer(answerText) {
  const sources = [];
  const sourcePattern = /\[(\d+)\]\s+(.+?)(?:\s+[\u2013\u2014-]\s+(.+?))?\n\s+URL:\s+(https?:\/\/\S+)\n\s+Relevance:\s+(.+?)(?=\n\[\d+\]|\n\*\*|$)/gs;
  let match;
  while ((match = sourcePattern.exec(String(answerText || ""))) !== null) {
    sources.push({
      index: Number(match[1]),
      title: match[2].trim(),
      section: (match[3] || "").trim(),
      url: match[4].trim().replace(/[),.]+$/, ""),
      relevance: match[5].trim(),
    });
  }
  return sources;
}

function extractResearchSources(data, answerText) {
  const sources = parseSourcesFromAnswer(answerText);
  const seen = new Set(sources.map((source) => source.url));

  function addSource(candidate = {}) {
    const url = String(candidate.url || "").trim().replace(/[),.]+$/, "");
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    sources.push({
      index: sources.length + 1,
      title: String(candidate.title || candidate.name || new URL(url).hostname).trim(),
      section: String(candidate.section || "").trim(),
      url,
      relevance: String(candidate.relevance || candidate.cited_text || "Primary source consulted during web research.").trim(),
    });
  }

  for (const block of data?.content || []) {
    for (const citation of block?.citations || []) addSource(citation);
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const result of block.content) addSource(result);
    }
  }

  return sources.map((source, index) => ({ ...source, index: index + 1 }));
}

function buildResearchQuestion(question, context = {}) {
  const contextLines = [
    context.returnType ? `Return type: ${context.returnType}` : "",
    context.taxYear ? `Tax year: ${context.taxYear}` : "",
    context.state ? `State: ${context.state}` : "",
    context.clientType ? `Client type: ${context.clientType}` : "",
  ].filter(Boolean);
  return `${contextLines.length ? `Context:\n${contextLines.join("\n")}\n\n` : ""}Question:\n${question}`;
}

function buildResearchSystemPrompt() {
  return `You are a senior US tax research specialist at a CPA firm with expertise across federal and all 50 state tax jurisdictions.

YOUR PRIMARY JOB:
Answer tax questions with precision, citing the specific IRS publication, IRC section, Treasury Regulation, revenue procedure, revenue ruling, court authority, or state tax authority that supports each statement you make.

RESEARCH APPROACH:
For every question, identify relevant IRC sections, Treasury Regulations, IRS publications or form instructions, Revenue Rulings or Procedures, state authority if a state is mentioned, and recent changes affecting the answer.

CITATION REQUIREMENTS:
- Every factual claim must be tied to a citation.
- Citations must include source name, direct URL, and specific section, page, line, chapter, or paragraph.
- Use current-year IRS sources unless the user asks about a prior year.
- If you cannot find a source for a claim, say so explicitly.

IRS URL PATTERNS:
Publications: https://www.irs.gov/publications/p[N]
Instructions: https://www.irs.gov/instructions/i[form]
Forms: https://www.irs.gov/pub/irs-pdf/f[form].pdf
IRC sections: https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title26-section[N]
Regulations: https://www.ecfr.gov/current/title-26/chapter-I/subchapter-A/part-1/section-1.[N]

STATE SOURCES:
Use the official state revenue department website for any state-specific answer. Prefer irs.gov, uscode.house.gov, ecfr.gov, and official state tax authority domains over secondary commentary.

OUTPUT FORMAT:
**Answer:**
[Direct answer in 1-3 paragraphs]

**Key Rules & Requirements:**
- [Rule] â€” [IRC section / regulation / publication]

**Sources & Citations:**
[1] [Document name] â€” [specific section]
    URL: [direct link]
    Relevance: [why this source applies]

[2] [Document name] â€” [specific section]
    URL: [direct link]
    Relevance: [why this source applies]

**Important Caveats:**
[Exceptions, limitations, uncertainty, or recent changes]

**Related Questions to Consider:**
[1-3 follow-up questions]

Tone: Professional, precise, direct, and suitable for licensed CPAs. If uncertain, say what must be verified and where.`;
}

function parseClaudeJson(raw) {
  const text = String(raw || "").trim();
  const candidates = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(match[1]);
  candidates.push(text);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  candidates.push(...extractBalancedJsonObjects(text));

  for (const candidate of candidates) {
    const cleaned = String(candidate || "")
      .trim()
      .replace(/^json\s*/i, "")
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (_) {}
    try {
      const repaired = repairJsonTextForParsing(cleaned);
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (error) {
      console.error("Review JSON parse failed:", error.message);
    }
  }
  return null;
}

// Like parseClaudeJson, but when the response contains several JSON-ish blocks (common when
// the model adds a small example, or when thinking text leaks a fragment), prefer the block
// that actually contains usable workbook sheets instead of just the first object that parses.
// This is what was causing intermittent "0 sheets -> template fallback" results: a small
// fragment parsed first and won, so the real workbook was ignored.
// Dedicated fallback: when the main preparation call did not return the structured
// reconciliation object, ask for JUST that object in a small second call. The context is
// the sheets the AI itself just generated (current-year P&L / Balance Sheet / AJE rows) —
// compact and already role-filtered, so the uploaded files are not resent. Best-effort:
// any failure returns null and the caller falls back to the NEEDS REVIEW flag.
async function requestReconciliationFallback(apiKey, workbook, entityType, options = {}) {
  try {
    const wanted = (workbook.sheets || [])
      .filter((s) => !s.verbatim && /profit|p&l|income statement|balance sheet|aje|adjusting|fixed asset/i.test(String(s.name || "")))
      .slice(0, 5);
    if (!wanted.length) return null;
    const sheetText = wanted
      .map((s) => `--- ${s.name} ---\n${(s.rows || []).map((row) => (Array.isArray(row) ? row : [row]).map((c) => String(c ?? "")).join(" | ")).join("\n")}`)
      .join("\n\n")
      .slice(0, 60000);
    const content = [{
      type: "text",
      text: [
        `Return type: ${entityType || "business entity (assume partnership Form 1065 unless the data indicates otherwise)"}.`,
        "From the current-year workpaper data below, produce ONLY the structured book-to-tax reconciliation.",
        ...RECONCILIATION_PROMPT_LINES,
        "",
        'Respond with ONLY this JSON inside ```json``` fences and nothing else: {"reconciliation":{ ... }}',
        "",
        "=== CURRENT-YEAR WORKPAPER DATA (generated from the client's current-year financials) ===",
        sheetText,
      ].join("\n"),
    }];
    const result = await callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
      maxTokens: 3500,
      models: [...MODEL_FALLBACKS, "claude-sonnet-4-5-20250929"],
      webSearch: false,
      feature: "preparation_recon_fallback",
      userId: options.userId,
      system: [{ type: "text", text: "You are a senior US tax preparer. Be precise, use only amounts present in the provided data, never invent values, and return ONLY valid JSON." }],
    });
    if (!result.ok) return null;
    const raw = extractText(result.data);
    const parsed = parseClaudeJson(raw);
    const rec = parsed && typeof parsed === "object" ? (parsed.reconciliation || parsed) : null;
    return hasReconciliation(rec) ? { reconciliation: rec, result } : null;
  } catch (err) {
    console.warn("[Preparation] reconciliation fallback failed:", err?.message || err);
    return null;
  }
}

function parseWorkpaperJson(raw) {
  const text = String(raw || "").trim();
  const rawCandidates = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) rawCandidates.push(match[1]);
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) rawCandidates.push(text.slice(firstBrace, lastBrace + 1));
  rawCandidates.push(...extractBalancedJsonObjects(text));
  rawCandidates.push(text);

  const parsedObjects = [];
  for (const candidate of rawCandidates) {
    const cleaned = String(candidate || "").trim().replace(/^json\s*/i, "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    if (!cleaned) continue;
    let obj = null;
    try { obj = JSON.parse(cleaned); } catch (_) {
      try { obj = JSON.parse(repairJsonTextForParsing(cleaned)); } catch (_) {}
    }
    if (obj && typeof obj === "object") parsedObjects.push(obj);
  }
  // Prefer a parsed object that yields usable sheets.
  for (const obj of parsedObjects) {
    try {
      const candidate = workbookCandidateFromParsed(obj);
      if (Array.isArray(candidate.sheets) && candidate.sheets.some((sheet) => normalizeSheetRows(sheet).length)) return obj;
    } catch (_) {}
  }
  // Otherwise fall back to the first parseable object, then the shared parser.
  return parsedObjects[0] || parseClaudeJson(raw);
}

function repairJsonTextForParsing(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (const char of String(text || "")) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      output += char;
      continue;
    }
    if (inString && char === "\n") {
      output += "\\n";
      continue;
    }
    if (inString && char === "\r") continue;
    if (inString && char === "\t") {
      output += "\\t";
      continue;
    }
    output += char;
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function extractBalancedJsonObjects(text) {
  const output = [];
  const value = String(text || "");
  for (let start = 0; start < value.length; start += 1) {
    if (value[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const char = value[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        output.push(value.slice(start, index + 1));
        break;
      }
    }
  }
  return output.sort((a, b) => b.length - a.length).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Claude API
// ---------------------------------------------------------------------------
async function callClaudeWithFallbacks(apiKey, payload) {
  const context = await loadReviewContext();
  context.databaseContext = buildDatabaseContext(resolveClientIdFromPayload(payload), resolveReturnTypeFromPayload(payload), "review");
  context.reviewFeedback = getReviewFeedbackForPayload(payload);
  const content = buildClaudeContent(payload, context);
  return callClaudeContentWithFallbacks(apiKey, content, context, {
    maxTokens: 16000,
    models: [...MODEL_FALLBACKS, "claude-sonnet-4-5-20250929"],
    thinking: { type: "enabled", budget_tokens: 12000 },
    webSearch: false,
  });
}

async function structureReviewTextWithClaude(apiKey, payload, reviewText) {
  const raw = String(reviewText || "").trim();
  if (!raw || /^Claude returned no review text\./i.test(raw)) {
    return { ok: false, status: 422, error: "No raw review text to structure." };
  }
  const metadata = payload.metadata || {};
  const content = [{
    type: "text",
    text: [
      "Convert the following senior tax review response into ONE complete valid JSON object.",
      "Return only JSON. Do not include markdown fences or prose outside JSON.",
      "Preserve every finding, amount, risk analysis, proposed solution, document name, open question, and conclusion from the raw review.",
      "If the raw review says a document was unreadable, include a MEDIUM or HIGH issue and missingDocuments entry for that document.",
      "If the raw text includes evidence of Schedule L imbalance, EIN mismatch, officer compensation/Form 1125-E, shareholder loans, or M-1/M-2 problems, those must appear as issues.",
      "",
      `Client: ${metadata.entityName || metadata.clientName || "Not specified"}`,
      `Return Type: ${metadata.returnType || "Not specified"}`,
      `Tax Year: ${metadata.taxYear || "Not specified"}`,
      "",
      "Uploaded documents and detected roles:",
      listFiles(payload.files || []),
      "",
      "Required schema:",
      reviewJsonSchemaText(),
      "",
      "Raw review response to convert:",
      raw.slice(0, 45000),
    ].join("\n"),
  }];
  return callClaudeContentWithFallbacks(apiKey, content, { knowledgeBase: [], reviewExamples: [] }, {
    maxTokens: 12000,
    models: [...MODEL_FALLBACKS, "claude-sonnet-4-5-20250929"],
    webSearch: false,
    system: [
      "You are a JSON repair and tax-review structuring assistant.",
      "You do not perform a new tax review. You only convert the supplied raw review into the required JSON schema.",
      "Every field in the schema is required. If the raw review lacks a field, fill it with a concise explanation of what is missing rather than an empty placeholder.",
      "Return only one parseable JSON object.",
    ].join("\n"),
  });
}

function reviewJsonSchemaText() {
  return '{"clientName":"string","returnType":"string","taxYear":"string","reviewStage":"string","generatedDate":"string","reviewerName":"string","executiveSummary":"string","filingReadiness":"READY|NOT READY|READY WITH CONDITIONS","overallRiskScore":"string","documentsRead":[{"filename":"string","role":"prior_return|current_return|prior_workpaper|current_workpaper|supporting_document","summary":"string"}],"feedbackApplied":["string"],"issues":[{"priority":"HIGH|MEDIUM|LOW","category":"string","areaReviewed":"string","formOrSchedule":"string","issueDescription":"string","evidence":"string","riskAnalysis":"string","proposedSolution":"string","authority":"string","source":"string","needsMoreInfo":"string"}],"checkboxReview":[{"box":"string","currentState":"string","shouldBe":"string","explanation":"string"}],"infoConsistency":[{"item":"string","returnValue":"string","sourceValue":"string","source":"string","status":"MATCH|MISMATCH","note":"string"}],"tieOutResults":[{"lineItem":"string","returnAmount":0,"workpaperAmount":0,"difference":0,"status":"TIE|OUT_OF_BALANCE","note":"string"}],"balanceSheetCheck":{"totalAssets":0,"totalLiabEquity":0,"balanced":true,"difference":0,"note":"string"},"openQuestions":["string"],"verifiedItems":["string"],"missingDocuments":["string"],"finalConclusion":"string"}';
}

async function callClaudeContentWithFallbacks(apiKey, content, context, options = {}) {
  let lastError = "Claude API request failed.";
  let lastStatus = 500;
  const userId = options.userId || "unknown";
  const feature = options.feature || "api";
  const MAX_429_RETRIES = 3;
  const BACKOFF_MS = [1000, 2000, 4000];
  // AbortController passed by the dispatcher when the client disconnects.
  const signal = options.signal || null;

  const models = Array.from(new Set(options.models || MODEL_FALLBACKS));
  for (const model of models) {
    const requestBody = {
      model,
      max_tokens: options.maxTokens || 4500,
      system: options.system || buildSystemBlocks(context),
      messages: [{ role: "user", content }],
    };
    if (options.thinking && /sonnet-4-5/i.test(model)) requestBody.thinking = options.thinking;
    if (WEB_SEARCH_ENABLED && options.webSearch !== false) requestBody.tools = [buildWebSearchTool()];

    let triedNextModel = false;
    for (let attempt = 1; attempt <= MAX_429_RETRIES + 1; attempt++) {
      if (signal?.aborted) {
        console.log(`[ABORTED] model=${model} userId=${userId} feature=${feature} reason=client_disconnected`);
        return { ok: false, status: 499, error: "Request cancelled: client disconnected." };
      }
      let res, data;
      try {
        res  = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
          body: JSON.stringify(requestBody),
          signal,
        });
        data = await res.json().catch(() => ({}));
      } catch (fetchErr) {
        if (fetchErr?.name === "AbortError") {
          console.log(`[ABORTED] model=${model} userId=${userId} feature=${feature} reason=fetch_aborted`);
          return { ok: false, status: 499, error: "Request cancelled: client disconnected." };
        }
        // Transient network failure (DNS blip, connection reset, TLS hiccup). These used to
        // kill the whole run on the first stumble; retry with the same backoff the
        // rate-limit path already uses before giving up.
        if (attempt <= MAX_429_RETRIES) {
          const waitMs = (BACKOFF_MS[attempt - 1] || 4000) + Math.floor(Math.random() * 400);
          console.log(`[RETRY-NET] model=${model} attempt=${attempt}/${MAX_429_RETRIES} waitMs=${waitMs} err=${fetchErr.message} userId=${userId} feature=${feature}`);
          await sleep(waitMs);
          continue;
        }
        return { ok: false, status: 502, error: `Network error calling Claude: ${fetchErr.message}` };
      }
      if (res.ok) return {
        ok: true,
        data,
        model,
        context: {
          knowledgeBaseCount: context.knowledgeBase.length,
          reviewExampleCount: context.reviewExamples.length,
          knowledgeBaseFiles: context.knowledgeBase.map((file) => file.name),
          reviewExampleFiles: context.reviewExamples.map((file) => file.name),
          databaseContextTokens: estimateTokens(context.databaseContext || ""),
        },
      };
      const message = data.error?.message || data.message || "Failed.";
      lastError = `Model ${model}: ${message}`;
      lastStatus = res.status;

      if (isRateLimitError(res.status, message)) {
        if (attempt <= MAX_429_RETRIES) {
          const baseMs = parseRetryAfterMs(res.headers.get("retry-after")) || BACKOFF_MS[attempt - 1];
          const waitMs = baseMs + Math.floor(Math.random() * 500);
          console.log(`[RETRY] model=${model} attempt=${attempt}/${MAX_429_RETRIES} waitMs=${waitMs} userId=${userId} feature=${feature}`);
          await sleep(waitMs);
          continue;
        }
        // All retries for this model exhausted — try next model in fallbacks
        triedNextModel = true;
        break;
      }
      if (!shouldTryNextModel(res.status, message)) {
        // Non-transient error, no point trying other models
        return { ok: false, status: lastStatus, error: `${lastError} Tried: ${models.join(", ")}.` };
      }
      triedNextModel = true;
      break;
    }
    if (!triedNextModel) break;
  }
  return { ok: false, status: lastStatus, error: `${lastError} Tried: ${models.join(", ")}.` };
}

function isRateLimitError(status, message) {
  const lower = String(message || "").toLowerCase();
  return status === 429 || lower.includes("rate limit") || lower.includes("tokens per minute");
}

// Pause execution for ms milliseconds.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse Anthropic's Retry-After header (integer seconds or HTTP-date string).
function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const asInt = parseInt(headerValue, 10);
  if (!isNaN(asInt) && asInt > 0) return asInt * 1000;
  const asDate = Date.parse(headerValue);
  if (!isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function buildWebSearchTool() {
  const tool = {
    type: "web_search_20250305",
    name: "web_search",
    max_uses: WEB_SEARCH_MAX_USES,
  };
  if (WEB_SEARCH_ALLOWED_DOMAINS.length) tool.allowed_domains = WEB_SEARCH_ALLOWED_DOMAINS;
  return tool;
}

function shouldTryNextModel(status, message) {
  return status === 400 || status === 404 || String(message).toLowerCase().includes("model");
}

// A failure that happened before any HTTP response existed (DNS, socket reset, TLS): worth
// retrying the same model rather than failing the run or switching models.
function isTransientNetworkError(status, message) {
  return Number(status) === 502
    && /fetch failed|network|socket|econn|eai_again|etimedout|enotfound|tls|before a response was received/i.test(String(message || ""));
}

function selectMasterPromptForReturn(payload = {}) {
  if (!MASTER_REVIEW_PROMPT) return "";
  const returnType = String(payload.metadata?.returnType || payload.returnType || "").trim();
  const sharedEnd = MASTER_REVIEW_PROMPT.search(/\n\s*â•+\s*\nFORM\s+/i);
  const sharedRules = sharedEnd > 0 ? MASTER_REVIEW_PROMPT.slice(0, sharedEnd).trim() : MASTER_REVIEW_PROMPT.slice(0, 18000).trim();
  const formPrompt = extractFormPrompt(returnType);
  const selected = [
    sharedRules,
    formPrompt || `FORM-SPECIFIC RULES: Return type "${returnType || "not specified"}" was not matched to a configured form section. Apply shared rules, uploaded documents, knowledge base, and official web research where enabled.`,
  ].join("\n\n");
  return truncateMiddle(selected, 26000);
}

function extractFormPrompt(returnType) {
  const normalized = normalizeReturnType(returnType);
  if (!normalized) return "";
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startMatch = MASTER_REVIEW_PROMPT.match(new RegExp(`\\nFORM\\s+${escaped}\\b[\\s\\S]*`, "i"));
  if (!startMatch || typeof startMatch.index !== "number") return "";
  const start = startMatch.index + 1;
  const next = MASTER_REVIEW_PROMPT.slice(start + 1).search(/\n\s*â•+\s*\nFORM\s+/i);
  const end = next >= 0 ? start + 1 + next : MASTER_REVIEW_PROMPT.length;
  return MASTER_REVIEW_PROMPT.slice(start, end).trim();
}

function normalizeReturnType(returnType) {
  const value = String(returnType || "").toUpperCase().replace(/\s+/g, "");
  if (!value) return "";
  if (value.includes("1120-S") || value.includes("1120S")) return "1120-S";
  if (value.includes("1040-NR") || value.includes("1040NR")) return "1040-NR";
  if (value.includes("1040-SS") || value.includes("1040SS")) return "1040-SS";
  if (value.includes("1040-PR") || value.includes("1040PR")) return "1040-PR";
  const match = value.match(/1040|1041|1065|1120|990|706|709|720|2290/);
  return match ? match[0] : "";
}

function resolveReturnTypeFromPayload(payload = {}) {
  const explicit = String(
    payload.metadata?.returnType ||
    payload.returnType ||
    payload.context?.returnType ||
    payload.client?.returnType ||
    payload.client?.entityType ||
    ""
  ).trim();
  if (explicit) return explicit;
  // Selector left blank (happens often) — infer from the user's own instructions.
  // Priority order matters: "Schedule C included in the 1040, this is NOT an 1120s"
  // must resolve to 1040, so the filing-return signals (1040 / Sch C/E) are checked
  // BEFORE entity forms that may appear negated.
  const instructions = String(payload.metadata?.instructions || payload.instructions || "").toLowerCase();
  if (!instructions) return "";
  if (/\b1040\b/.test(instructions) || /\bsch(edule)?\s*[.\-]?\s*[ce]\b/.test(instructions)) return "1040";
  if (/\b1065\b/.test(instructions) || /\bpartnership\b/.test(instructions)) return "1065";
  if (/\b1120[\s-]?s\b/.test(instructions) || /\bs[\s-]?corp/.test(instructions)) return "1120-S";
  if (/\b1120\b/.test(instructions) || /\bc[\s-]?corp/.test(instructions)) return "1120";
  if (/\b990\b/.test(instructions)) return "990";
  if (/\b1041\b/.test(instructions)) return "1041";
  return "";
}

function resolveClientIdFromPayload(payload = {}) {
  const explicit = payload.clientId || payload.metadata?.clientId || payload.context?.clientId || payload.client?.id;
  if (explicit) return String(explicit);
  const name = String(
    payload.metadata?.clientName ||
    payload.metadata?.entityName ||
    payload.clientName ||
    payload.client?.name ||
    payload.client?.company ||
    payload.client?.companyName ||
    ""
  ).trim().toLowerCase();
  if (!name) return "";
  const db = readDb();
  const match = Object.values(db.clients || {}).find((client) => String(client.name || "").trim().toLowerCase() === name);
  return match?.id || "";
}

function withDatabaseContext(systemText, payload = {}, tab = "review") {
  const context = buildDatabaseContext(resolveClientIdFromPayload(payload), resolveReturnTypeFromPayload(payload), tab);
  return context ? `${context}\n\n${systemText}` : systemText;
}

function pushContextSection(parts, title, lines, maxChars) {
  const cleanLines = (Array.isArray(lines) ? lines : [lines]).map((line) => String(line || "").trim()).filter(Boolean);
  if (!cleanLines.length) return;
  parts.push(truncateMiddle([`${title}:`, ...cleanLines].join("\n"), maxChars));
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function buildDatabaseContext(clientId, returnType, tab) {
  const type = normalizeReturnType(returnType) || String(returnType || "all");
  const parts = [];
  const library = readFirmLibrary();
  const learning = readLearning();

  pushContextSection(parts, "DATABASE CONTEXT - FIRM-WIDE INSTRUCTIONS", library.globalInstructions, 2000);

  const activeDocs = library.documents.filter((doc) => doc.active !== false);
  pushContextSection(parts, "DATABASE CONTEXT - ALWAYS-INJECT FIRM LIBRARY", activeDocs.filter((doc) => doc.alwaysInject).map((doc) => `- ${doc.title}: ${doc.content || doc.driveWebViewLink || "File attached in firm library."}`), 1800);

  const applicableDocs = activeDocs.filter((doc) => {
    const applies = Array.isArray(doc.applicableTo) ? doc.applicableTo.map((item) => normalizeReturnType(item) || String(item).toLowerCase()) : ["all"];
    return !doc.alwaysInject && (applies.includes("all") || applies.includes(type) || applies.includes(String(returnType || "").toLowerCase()));
  });
  pushContextSection(parts, `DATABASE CONTEXT - FIRM LIBRARY FOR ${type || "THIS RETURN"}`, applicableDocs.map((doc) => `- ${doc.title}: ${doc.content || doc.driveWebViewLink || "File attached in firm library."}`), 1600);

  const client = clientId ? readDb().clients?.[clientId] : null;
  if (client) {
    pushContextSection(parts, `DATABASE CONTEXT - PERMANENT INSTRUCTIONS FOR ${client.name}`, (client.permanentInstructions || []).filter((item) => item.active !== false).map((item) => `- [${item.category || "other"}] ${item.text}`), 1600);
    pushContextSection(parts, `DATABASE CONTEXT - RELATED PARTIES FOR ${client.name}`, (client.relatedParties || []).map((item) => `- ${item.name} (${item.relationship || "relationship not specified"})${item.ein ? ` EIN: ${item.ein}` : ""}${item.notes ? ` - ${item.notes}` : ""}`), 900);
    pushContextSection(parts, `DATABASE CONTEXT - CARRYFORWARDS FOR ${client.name}`, Object.entries(client.carryforwards || {}).filter(([, value]) => value && String(value) !== "0").map(([key, value]) => `- ${key}: ${value}`), 700);
    pushContextSection(parts, `DATABASE CONTEXT - AUDIT HISTORY FOR ${client.name}`, (client.auditHistory || []).map((item) => `- TY${item.year || ""} ${item.authority || ""}: ${item.outcome || ""}${item.notes ? ` - ${item.notes}` : ""}`), 700);
    const recentReviews = (client.reviewHistory || []).slice().sort((a, b) => new Date(b.runAt || 0) - new Date(a.runAt || 0)).slice(0, 2);
    pushContextSection(parts, `DATABASE CONTEXT - PRIOR REVIEW HISTORY FOR ${client.name}`, recentReviews.map((review) => `- TY${review.taxYear || ""} ${review.reviewStage || ""}: ${(review.executiveSummary || "").slice(0, 300)} Issues: H${review.issuesSummary?.high || 0}/M${review.issuesSummary?.medium || 0}/L${review.issuesSummary?.low || 0}`), 1100);
    pushContextSection(parts, `DATABASE CONTEXT - LEARNED CLIENT CORRECTIONS FOR ${client.name}`, (learning.clientCorrections?.[clientId] || []).filter((item) => item.active !== false).map((item) => `- ${item.correction}`), 1200);
  }

  const globalCorrections = (learning.globalCorrections || []).filter((item) => {
    const applies = Array.isArray(item.appliesTo) ? item.appliesTo.map((value) => normalizeReturnType(value) || String(value).toLowerCase()) : ["all"];
    return item.active !== false && (applies.includes("all") || applies.includes(type) || applies.includes(String(returnType || "").toLowerCase()));
  });
  pushContextSection(parts, `DATABASE CONTEXT - LEARNED GLOBAL CORRECTIONS FOR ${type || "THIS RETURN"}`, globalCorrections.map((item) => `- ${item.correction}`), 1400);

  const body = parts.filter(Boolean).join("\n\n");
  if (!body) return "";
  return [
    "DATABASE CONTEXT INJECTION:",
    `This context comes from the Database tab and applies to the current ${tab || "AI"} task. Use it before general Claude reasoning and use it to interpret client-specific facts, preferences, corrections, and firm library guidance.`,
    truncateMiddle(body, 8000),
  ].join("\n");
}

function publicTaxSoftwareList() {
  return TAX_SOFTWARE_LIST.map((software) => ({
    id: software.id,
    name: software.name,
    vendor: software.vendor,
    type: software.type,
    logo: software.logo,
    description: software.description,
    navigationStyle: software.navigationStyle,
    screenTerminology: software.screenTerminology,
  }));
}

function taxSoftwareById(softwareId) {
  const key = String(softwareId || "").toLowerCase();
  return TAX_SOFTWARE_LIST.find((software) => software.id === key) || TAX_SOFTWARE_LIST.find((software) => software.id === "other");
}

function resolveTaxSoftwareFromPayload(payload = {}) {
  const explicit = payload.taxSoftware || payload.metadata?.taxSoftware || payload.context?.taxSoftware;
  if (explicit) return String(explicit);
  const clientId = resolveClientIdFromPayload(payload);
  const clientSoftware = clientId ? readDb().clients?.[clientId]?.taxSoftware?.primary : "";
  if (clientSoftware) return String(clientSoftware);
  const firmDefault = readFirmLibrary().defaultTaxSoftware;
  return firmDefault || "proconnect";
}

function buildSoftwareContext(softwareId, returnType, taxYear) {
  const software = taxSoftwareById(softwareId);
  if (!software || software.id === "other") {
    return [
      "TAX SOFTWARE: Not specified.",
      "Use standard IRS form and line references. All navigation instructions should reference the IRS form name and line number directly.",
    ].join("\n");
  }
  const paths = software.commonScreenPaths || {};
  return [
    `TAX SOFTWARE IN USE: ${software.name}${software.vendor ? ` (${software.vendor})` : ""}`,
    `Navigation style: ${software.description}`,
    `Terminology: what other software calls a screen, ${software.name} calls a "${software.screenTerminology.screen}".`,
    "",
    "NAVIGATION FORMAT TO USE:",
    `When giving entry instructions, always say: "${software.screenTerminology.navigate}"`,
    "",
    `COMMON SCREEN PATHS IN ${software.name.toUpperCase()} FOR ${returnType || "THIS RETURN"} TY ${taxYear || "current"}:`,
    `Client Information: ${paths.clientInfo}`,
    `Electronic Filing: ${paths.efiling}`,
    `Income / Gross Receipts: ${paths.grossReceipts}`,
    `Cost of Goods Sold: ${paths.cogs}`,
    `Officer Compensation: ${paths.officerComp}`,
    `Depreciation: ${paths.depreciation}`,
    `Other Deductions: ${paths.otherDeductions}`,
    `Balance Sheet: ${paths.scheduleL}`,
    `Schedule M-1: ${paths.scheduleM1}`,
    `Schedule M-3: ${paths.scheduleM3}`,
    `Schedule K: ${paths.scheduleK}`,
    `State Return: ${paths.stateReturn}`,
    `Investments: ${paths.investments}`,
    `Dispositions: ${paths.dispositions}`,
    "",
    `IMPORTANT: Every software entry instruction you generate must include the exact navigation path in ${software.name} when applicable. Do not say "go to the income section"; say "${paths.grossReceipts}".`,
    `If a specific screen path is not listed above, use your knowledge of ${software.name} ${taxYear || ""} to provide the correct path and terminology.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// System prompt â€” specialized US tax reviewer with all 4 checks + corrections DB
// ---------------------------------------------------------------------------
function buildSystemPrompt(context = { knowledgeBase: [], reviewExamples: [] }) {
  const dbLines = CORRECTIONS_DB.map((c, i) =>
    `${i + 1}. [${c.stage.toUpperCase()}][${c.type}] ${c.client}: ${c.desc}`
  ).join("\n");
  const contextSummary = [
    `Knowledge base files loaded: ${context.knowledgeBase.length}`,
    `Prior review example files loaded: ${context.reviewExamples.length}`,
  ].join("\n");

  return [
    "CRITICAL OUTPUT REQUIREMENT: You MUST return a complete senior review as valid JSON in the exact schema below. Every field is required. Do not write prose outside the JSON. Do not return an empty issues array unless every required review section contains real work and the return is genuinely clean.",
    "",
    MASTER_REVIEW_PROMPT || "You are a Senior US Tax Reviewer at a CPA firm. Review the uploaded US tax return package and do not invent facts.",
    "",
    "APPLICATION RUNTIME RULES:",
    "You are not preparing the return and you must not modify tax forms.",
    "You are a senior tax return reviewer with 20+ years of CPA firm experience. Your job is to catch every issue a partner would catch before filing, including small checkbox, EIN, SSN, ownership percentage, date, and tie-out errors.",
    "",
    "SOURCE PRIORITY AND CONFLICT RULES:",
    "1. Knowledge Base is the highest-priority technical authority. Use official IRS/state instructions and firm policy files from the Knowledge Base first whenever they address the issue. Cite the Knowledge Base file name in source when it supports a finding.",
    "2. Use your senior tax-review reasoning second, only to interpret, connect, and apply the Knowledge Base, uploaded documents, and generally accepted US tax concepts where no direct Knowledge Base authority is available.",
    "3. Use all remaining sources to define scope, facts, context, and review style: User Review Notes / Specific Instructions, Client Facts / Expected Information, uploaded returns, uploaded workpapers, uploaded related documents, review examples, the hidden master prompt, and web search where enabled.",
    "If lower-priority context conflicts with the Knowledge Base, follow the Knowledge Base and flag the conflict.",
    "If Client Facts / Expected Information conflict with uploaded documents, do not choose silently; flag the mismatch with evidence.",
    "Review examples are never tax authority. They are for phrasing, tone, and comment style only.",
    "The hidden master prompt defines the checklist and output discipline, but it must not override specific Knowledge Base authority.",
    "Web search, if enabled, is supplemental and should be used only when the Knowledge Base and uploaded documents are insufficient.",
    "",
    "Required senior review process:",
    "1. Read and confirm every uploaded document. Identify which document is the current-year return under review, which are prior-year references, which are current-year workpapers, and which are supporting documents.",
    "2. Cross-document consistency: compare legal name, EIN/SSN, address, officer/shareholder/partner names, ownership percentages, tax year/period dates, filing status, entity type, signatures, and dates across CY return, PY return, workpapers, and support.",
    "3. Checkbox and election review: examine every checkbox and yes/no question visible in the return. Flag boxes that should be checked but are not, boxes checked incorrectly, initial/final return, name/address change, accounting method, consolidated/personal holding company questions, Schedule B/K questions, foreign ownership, and other return-type specific boxes.",
    "4. Numeric tie-out: every material number on the current-year return must tie to the current-year workpaper or supporting document. Show return amount, workpaper/support amount, difference, and likely cause for mismatches.",
    "5. Supporting document review: for each W-2, W-3, W-9, 1099, K-1, depreciation schedule, bank statement, or other support, decide whether it belongs on the return, whether the amount appears correctly, and whether anything on the return lacks support.",
    "6. Schedule L: verify total assets equal total liabilities plus equity, beginning balances tie to prior-year ending balances, and ending balances tie to current-year workpapers. Flag exact differences.",
    "7. M-1/M-2/M-3: verify book income plus/minus adjustments equals taxable income; retained earnings rolls forward and ties to Schedule L; M-3 is present and complete if required.",
    "8. Apply form-specific checks for the return type, including 1125-E threshold/reasonable comp for 1120/1120-S, partner capital and guaranteed payments for 1065, filing status/dependents/QBI/NIIT for 1040, and fiduciary-specific items for 1041.",
    "9. Apply every firm review/reviewer feedback item as an additional review standard.",
    "10. For every issue, provide risk level, risk analysis, proposed solution, source documents compared, and what additional information is needed.",
    "",
    "Anti-error rules:",
    "Do not invent facts, amounts, documents, form lines, or sources.",
    "Do not say something was reviewed if the document was not uploaded.",
    "Do not use historical corrections as technical authority; use them only as pattern examples.",
    "Do not mix tax years or entities.",
    "Treat Client Facts / Expected Information as expected client-specific data and review context. Compare it against uploaded returns, workpapers, and related documents; flag any mismatch, missing value, or contradiction as an issue.",
    "Treat User Review Notes / Specific Instructions as mandatory scope and formatting instructions unless they contradict the Knowledge Base or uploaded evidence. If the user asks for a list, summary, special ending, or specific check, explicitly satisfy it in reviewerComments, questions, finalConclusion, or an issue as appropriate.",
    "Avoid generic comments like review for accuracy.",
    "If something cannot be verified, say exactly: Unable to verify based on documents provided.",
    "Never conclude that a return is ready to file when support is incomplete.",
    "Every finding must cite the exact form, schedule, line, box, or document section when available.",
    "Every numeric finding must show the amounts compared and the difference.",
    "If web search is enabled, use it only when the Knowledge Base or uploaded documents do not provide enough authority. Prefer official IRS, state tax agency, and government sources.",
    "If web search is disabled, do not pretend to have searched the internet.",
    "",
    "OUTPUT CONTRACT FOR THE APP:",
    "The browser will turn your response into a written Word-style review for the user. Return ONLY a JSON object inside ```json``` fences so the app can render and export it cleanly.",
    "Write all JSON values in English. Keep the JSON property names exactly as specified below.",
    reviewJsonSchemaText(),
    "",
    "High = blocks or could materially affect filing. Medium = should resolve before filing. Low = cleanup or limited risk. Info = observation.",
    "Every issue must include evidence, riskAnalysis, proposedSolution, source, and whether more information is needed.",
    "documentsRead must list every uploaded document you received and what you extracted from it.",
    "A response with zero issues is acceptable only if you still provide detailed documentsRead, checkboxReview, tieOutResults, balanceSheetCheck, verifiedItems, filingReadiness, and finalConclusion showing what was actually checked. Never return only 'No issues identified' or 'None noted'.",
    "Before responding, verify your JSON includes non-empty executiveSummary, documentsRead, checkboxReview, tieOutResults, balanceSheetCheck with actual numbers or an explicit unreadable/missing explanation, filingReadiness, finalConclusion, and all material findings. If any required section is empty, complete it before responding.",
    "If a current-year return or current-year workpaper is missing or unreadable, do not say the review is clean. Add a HIGH issue and missingDocuments entry explaining that the review cannot be completed.",
    "If User Review Notes ask for a specific list or final note, include that requested output in verifiedItems, openQuestions, finalConclusion, or an issue as appropriate.",
    "",
    contextSummary,
    "",
    context.databaseContext || "",
    context.databaseContext ? "" : "",
    "FIRM REVIEW FEEDBACK (apply these as review standards):",
    context.reviewFeedback?.length ? context.reviewFeedback.map((entry, index) => `${index + 1}. ${entry.text}`).join("\n") : "No firm review feedback on file.",
    "",
    `FIRM CORRECTIONS DATABASE (${CORRECTIONS_DB.length} historical entries):`,
    dbLines,
    "",
    "FINAL OUTPUT REMINDER: return only the complete JSON object. No explanation, no markdown narrative, no partial checklist, no empty senior review shell.",
  ].join("\n");
}

function buildSystemBlocks(context = { knowledgeBase: [], reviewExamples: [] }) {
  return [{
    type: "text",
    text: buildSystemPrompt(context),
    cache_control: { type: "ephemeral" },
  }];
}

// ---------------------------------------------------------------------------
// Content builder â€” handles PDF, XLSX text, DOCX text, CSV/TXT, metadata
// ---------------------------------------------------------------------------
function buildClaudeContent(payload, context = { knowledgeBase: [], reviewExamples: [] }) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const content = [];

  if (context.knowledgeBase.length) {
    content.push({
      type: "text",
      text: [
        "=== PRIORITY 1 KNOWLEDGE BASE: TECHNICAL AUTHORITY ===",
        "These files are the highest-priority technical authority for the review. Apply them before general model reasoning and before user/client context when they address an issue. Cite the file name in the source field.",
        formatContextFiles(context.knowledgeBase),
      ].join("\n\n"),
      cache_control: context.reviewExamples.length ? undefined : { type: "ephemeral" },
    });
  }

  if (context.reviewExamples.length) {
    content.push({
      type: "text",
      text: [
        "=== PRIORITY 3 REVIEW EXAMPLES: STYLE AND FORMAT ONLY ===",
        "Use these only to understand the firm's preferred tone, context, and reviewer-comment format. Do not treat them as tax authority and do not copy facts from them into the current review.",
        formatContextFiles(context.reviewExamples),
      ].join("\n\n"),
      cache_control: { type: "ephemeral" },
    });
  }

  files.forEach((file, index) => {
    const documentHeader = [
      `DOCUMENT ${index + 1}: ${file.name}`,
      `ROLE: ${file.reviewRole || file.canonicalRole || file.role || "supporting_document"}`,
      `ROLE PURPOSE: ${file.roleDescription || "Use this document only for the review purpose indicated by its role."}`,
    ].join("\n");
    if (file.encoding === "base64" && file.mediaType === "application/pdf" && file.data) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: file.data },
        title: file.name,
        context: `${documentHeader}\n${labelForType(file.type)} - uploaded for senior tax review.`,
      });
      return;
    }

    if ((file.encoding === "zip-text" || file.encoding === "pdf-text" || file.encoding === "xlsx-text" || file.encoding === "docx-text" || file.encoding === "text") && file.text) {
      const label = file.encoding === "zip-text" ? "ZIP PACKAGE (prepared text)"
        : file.encoding === "pdf-text" ? "DOCUMENT (PDF text)"
        : file.encoding === "xlsx-text" ? "WORKPAPER (Excel)"
        : file.encoding === "docx-text" ? "DOCUMENT (Word)"
        : "TEXT FILE";
      content.push({
        type: "text",
        text: [`=== ${label}: ${file.name} ===`, documentHeader, `Category: ${labelForType(file.type)}`, "", file.text].join("\n"),
      });
      return;
    }

    content.push({
      type: "text",
      text: [
        `=== METADATA ONLY: ${file.name} ===`,
        documentHeader,
        `Category: ${labelForType(file.type)} | Type: ${file.mediaType || "unknown"} | Size: ${file.size || 0} bytes`,
        "Content not parsed â€” ask user to export as PDF or CSV for full review.",
      ].join("\n"),
    });
  });

  content.push({ type: "text", text: buildUserPrompt(payload, context) });
  return content;
}

function buildUserPrompt(payload, context = { knowledgeBase: [], reviewExamples: [] }) {
  const metadata = payload.metadata || {};
  const clientName = metadata.clientName || payload.clientName || "Unnamed client";
  const taxYear = metadata.taxYear || payload.taxYear || "Not specified";
  const reviewTypes = Array.isArray(metadata.reviewTypes || payload.reviewTypes)
    ? (metadata.reviewTypes || payload.reviewTypes).join(", ")
    : "General review";
  const reviewStage = metadata.reviewStage || payload.reviewStage || "Initial review";
  const grouped = groupFiles(payload.files || []);
  const userNotes = metadata.userNotes || "No specific instructions entered. Run the standard senior review checklist.";
  const clientFacts = metadata.clientFacts || "No client facts entered. Verify only against facts found in the uploaded documents.";
  const roles = (payload.files || []).map((file) => file.reviewRole || file.canonicalRole || file.role || "");
  const intakeWarnings = [
    roles.includes("current_return") ? "" : "No current year return detected - the review may be incomplete.",
    roles.includes("current_workpaper") ? "" : "No current year workpaper detected - numeric tie-out may be incomplete.",
  ].filter(Boolean);

  return [
    "SOURCE PRIORITY FOR THIS REVIEW:",
    "1. Knowledge Base technical authority.",
    "2. Senior tax-review reasoning used to interpret and apply the authority and evidence.",
    "3. Context and style sources: User Review Notes / Specific Instructions, Client Facts / Expected Information, uploaded documents, review examples, hidden firm checklist, and web search if enabled.",
    "",
    `Knowledge Base files available: ${context.knowledgeBase.length ? context.knowledgeBase.map((file) => file.name).join(", ") : "None"}`,
    `Review example files available: ${context.reviewExamples.length ? context.reviewExamples.map((file) => file.name).join(", ") : "None"}`,
    "",
    "PRIORITY 3 USER REVIEW NOTES / SPECIFIC INSTRUCTIONS:",
    userNotes,
    "",
    "Explicitly address every applicable user instruction in the JSON output unless it conflicts with higher-priority Knowledge Base authority or uploaded evidence. If the user asks for a list or special note, place it in reviewerComments or finalConclusion.",
    "",
    "PRIORITY 3 CLIENT FACTS / EXPECTED INFORMATION TO VERIFY:",
    clientFacts,
    "",
    "Compare the client facts above against all uploaded documents. If a document contains a different SSN, EIN, name, address, partner/shareholder detail, tax year, state, or other expected value, flag it as an issue with evidence and recommended action.",
    "",
    `Client name: ${clientName}`,
    `Entity name: ${metadata.entityName || "Not specified"}`,
    `Tax year: ${taxYear}`,
    `Return type: ${metadata.returnType || "Not specified"}`,
    `States included: ${metadata.statesIncluded || "Not specified"}`,
    `Review stage: ${reviewStage}`,
    `Requested checks: ${reviewTypes}`,
    "Web research enabled: No for this Review call. Use uploaded documents, Knowledge Base, Database context, and firm review feedback.",
    intakeWarnings.length ? `Intake warnings: ${intakeWarnings.join(" ")}` : "Intake warnings: None.",
    "",
    "Detected document roles:",
    listFiles(payload.files || []),
    "",
    metadata.qboInstruction ? "" : null,
    metadata.qboInstruction || null,
    Array.isArray(metadata.qboReports) && metadata.qboReports.length ? `Accounting software reports included: ${metadata.qboReports.map((report) => `${report.software || "Accounting"} - ${report.name || report.reportId}`).join(", ")}` : null,
    "",
    "Uploaded Tax Returns:",
    listFiles(grouped.taxReturns),
    "",
    "Uploaded Workpapers:",
    listFiles(grouped.workpapers),
    "",
    "Uploaded Related Documents:",
    listFiles(grouped.documents),
    "",
    "Perform the required senior review using the hidden firm master prompt and return ONLY the JSON object.",
  ].join("\n");
}

// Shared between the main preparation prompt and the dedicated reconciliation fallback
// call, so the schema and treatment rules can never drift apart between the two.
const RECONCILIATION_PROMPT_LINES = [
  "STRUCTURED RECONCILIATION (MANDATORY — the workbook is WRONG without it): the top-level 'reconciliation' object is the ONLY place the book-to-tax reconciliation is returned (there is no reconciliation worksheet — the app builds it from this object). You must always include this object, fully populated, whenever the return has a Schedule M-1 (Forms 1065, 1120, 1120-S) — and also for a 1040 with business financials (Schedule C/E), using the same keys. Use exactly these keys:",
  '  "reconciliation": {',
  '    "netIncomePerBooks": number (current-year net income per books from the P&L),',
  '    "ajes": [ { "label": string, "amount": number (SIGNED: negative reduces book income), "note": string } ],',
  '    "m1": { "meals50": number, "entertainment": number, "penalties": number, "politicalLobbying": number, "officerLifeInsurance": number, "federalIncomeTax": number, "charitable": number, "ownerHealthcare": number, "homeOffice": number, "creditCardRewards": number, "taxExemptInterest": number, "depreciationBookVsTax": number, "sec179Bonus": number, "gainLossBookVsTax": number, "assetSaleIncomeRemoval": number, "portfolioIncomeRemoval": number, "foreignTaxesPaid": number, "section163j": number, "otherPermanent": number, "otherTiming": number },',
  '    "separatelyStated": [ { "label": string, "amount": number, "note": string } ]',
  "  }",
  "Every m1 value is a SIGNED amount that adjusts book income toward taxable income (+ increases, − decreases). Use 0 for any line that does not apply — never omit a key. CRITICAL FOR CONSISTENCY: owner healthcare premiums, home office, and credit card rewards each have their OWN fixed key (ownerHealthcare, homeOffice, creditCardRewards) — always put them there with the correct signed amount, and NEVER instead place them in 'ajes', 'otherPermanent', or 'otherTiming'. Reserve otherPermanent/otherTiming only for items with no dedicated key. Put interest, dividends, capital gains, and any pass-through separately-stated items in separatelyStated (they must NOT be folded into ordinary business income). The 'ajes' amounts must match the AJE worksheet. Do not compute the subtotals yourself — the app computes Adjusted Net Income and Ordinary Business Income from these components.",
  "NO DOUBLE COUNTING (the app adds Net Income + all ajes + all m1 keys): every economic item must appear in EXACTLY ONE of 'ajes' or the 'm1' keys — never both. In particular, the removal of asset-sale proceeds/gain that were booked as P&L income goes ONLY in m1.assetSaleIncomeRemoval (negative); do NOT also enter it as an AJE. If the same dollar amount would appear in both an AJE and an m1 key, keep it in the m1 key and remove it from ajes. 'separatelyStated' is informational only (it is NOT summed into ordinary income), so an item may legitimately appear both as an m1 addback that removes it from ordinary AND in separatelyStated for the K-1 (e.g. charitable, Section 1231 gain) — that is not double counting.",
  "FIXED TREATMENT RULES (apply consistently every run — these are the correct pass-through treatments; for a C corporation (1120) note the exception in parentheses):",
  "  • ownerHealthcare: ENTITY-SPECIFIC. 1065 partnership: partner health premiums are a GUARANTEED PAYMENT (deductible by the entity; partner takes SE health on the 1040) — not a positive addback; set 0 unless a specifically nondeductible portion exists, and report in separatelyStated as informational. 1120-S: an S-corp has NO guaranteed payments — >2% shareholder premiums must be included in the shareholder's W-2 Box 1 wages and deducted as officer compensation; NEVER label them 'guaranteed payment'. If premiums were booked to equity/distributions and NOT run through payroll, set ownerHealthcare to 0, list in separatelyStated as informational, and add an aiNotes flag that payroll/W-2 must be corrected before filing (decision item). (C-corp: fully deductible employee benefit — 0.)",
  "  • homeOffice: ENTITY-SPECIFIC. 1065 partnership: a partner's home office is deductible as Unreimbursed Partnership Expense (UPE) on the partner's Schedule E or via an accountable plan — deductible, NOT an addback; set 0 (or a NEGATIVE amount only when recording a supported additional deduction). 1120-S: UPE does NOT exist for S-corp shareholders — the ONLY deductible route is a documented accountable-plan reimbursement. DETERMINISTIC RULE: if shareholder home-office costs are booked as entity expenses AND the provided files document an accountable plan or reimbursement arrangement (e.g. the prior workpaper reclasses them to rent/reimbursement), treat as deductible → homeOffice = 0. If NO accountable plan is evidenced in the files, ADD BACK the full amount as a POSITIVE number (nondeductible shareholder personal expense, K-1 16C) and flag in aiNotes that adopting/documenting a written accountable plan would restore the deduction. Never guess an in-between amount. PLACEMENT: this disallowance always goes in m1.homeOffice — NEVER as an AJE (it is a tax adjustment, not a book entry).",
  "  • gainLossBookVsTax: this line is ONLY for a book-vs-tax basis DIFFERENCE on a disposition. The gain/proceeds itself from selling a business asset (Section 1231) is SEPARATELY STATED (K-1 box 10 for a 1065 / box 9 for an 1120-S) — put it in separatelyStated, NOT in ordinary income. Leave gainLossBookVsTax at 0 unless book and tax basis genuinely differ. (C-corp: the 1231 gain IS in taxable income — then use gainLossBookVsTax for the amount.)",
  "  • assetSaleIncomeRemoval: if asset-sale proceeds or gain were RECORDED IN THE P&L as income (e.g. an 'Other Income' / 'Sale of asset' line), that amount is inside Net Income per Books and must be REMOVED from ordinary income. Enter the amount that was booked as income here as a NEGATIVE number (for a pass-through the Section 1231 gain is separately stated, not ordinary). Do this HERE, not as an AJE. Also list the Form 4797 / Section 1231 gain in separatelyStated. If no asset-sale income was booked in the P&L, use 0.",
  "  • federalIncomeTax: for a partnership (1065) or S-corporation (1120-S) there is NO entity-level federal income tax — set federalIncomeTax to 0. Only a C-corporation (1120) that expensed federal income tax on its books adds it back here.",
  "  • portfolioIncomeRemoval: if interest income, dividends (domestic or foreign), or other portfolio income was booked in the P&L (so it is inside Net Income per Books), enter the TOTAL as a NEGATIVE number here to remove it from ordinary business income — for a pass-through, portfolio income is separately stated (1065 K-1 lines 5/6a-6b; 1120-S K-1 lines 4/5a-5b). ALSO list each portfolio item in separatelyStated. Even a small interest amount must be removed here — do NOT leave it in ordinary income and do NOT use otherTiming for this. (C-corp: portfolio income stays in taxable income — use 0.)",
  "  • foreignTaxesPaid: if foreign taxes paid/withheld (e.g. on foreign dividends) were expensed on the books, add them back here as a POSITIVE number — they are not an ordinary deduction; they are separately stated so the partners/shareholders can claim the Foreign Tax Credit (1065 K-1 box 21; 1120-S K-1 box 14; Schedule K-3 either way). ALSO list the foreign tax in separatelyStated with a note to evaluate Form 1116/FTC, and flag foreign-source income in aiNotes for Schedule K-2/K-3 filing requirements. If none, 0.",
  "  • creditCardRewards: DETERMINISTIC RULE — if credit card rewards / rebates / cash back were booked as income in the P&L, enter the TOTAL as a NEGATIVE number here (nontaxable purchase-price reduction, not gross income). NEVER 0 while rewards income exists in the books, and never move this to an AJE or otherPermanent instead. Also list it in separatelyStated as 'Nontaxable income - credit card rewards'. Same treatment for every entity type.",
  "  • Uncategorized/unclassified expense accounts ('Uncategorized Expense', 'Ask My Accountant', 'Suspense', etc.): DETERMINISTIC RULE — always add the full amount back as a POSITIVE otherPermanent adjustment (note: 'pending categorization/substantiation — not deductible until classified') and flag it in aiNotes. Never leave an uncategorized amount deducted, and never guess its category.",
  "  • separatelyStated must ALWAYS include, when derivable from the files: each portfolio income item (interest/dividends), the Section 1231 gain (label it exactly 'Net Section 1231 gain (K-1 Line 10)' for a 1065 or 'Net Section 1231 gain (K-1 Line 9)' for an 1120-S), charitable contributions, 'Nontaxable income - credit card rewards' when rewards exist, nondeductible expenses total (K-1 16C / 18C), shareholder/partner DISTRIBUTIONS from the equity section (K-1 16D for 1120-S / 19A for 1065), and owner health premiums (informational). Use those exact label styles so every run lists the same items the same way.",
  "  • De minimis fixed-asset expensing (AJE): apply ONLY when the uploaded files BOTH document the de minimis election / prior-year expensing treatment AND provide the current-year addition amounts — then the AJE must expense those additions (NEGATIVE amount reducing book income), consistent with the documented treatment. If additions exist but no election/treatment is documented, do NOT expense them — leave 0 and flag as a capitalization / Section 179 decision item.",
  'OWNERS (for the Schedule K-1 allocation the app builds in code): also return a top-level "owners" array: [ { "name": string, "ownershipPct": number } ] — ONLY when the uploaded files evidence the owners and their percentages (prior-year K-1s, prior return, operating agreement, workpaper). Percentages must sum to 100. If ownership is NOT documented, return an empty array — the app will assume a single 100% owner and flag it; NEVER invent names or percentages.',
];

/**
 * Collects the image-only PDFs the browser shipped as raw bytes, under the API's limits.
 *
 * Shared because the Review tab needed exactly this and did not have it: its user content
 * was two text blocks, so a scanned upload reached the model as "[No readable extracted
 * text was available]". In one real package that hid a Form 1098, a 1099-INT and a W-2 —
 * and the review dutifully reported all three as "not provided".
 */
function collectScannedPdfDocuments(payload = {}) {
  const scannedDocs = [];
  const skippedScans = [];
  for (const file of payload.files || []) {
    const candidates = [
      ...(file.scannedPdfBase64 ? [{ name: file.scannedPdfName || file.name || "scanned.pdf", data: file.scannedPdfBase64 }] : []),
      ...(Array.isArray(file.scannedPdfs) ? file.scannedPdfs : []),
    ];
    for (const candidate of candidates) {
      const data = String(candidate?.data || "");
      if (!data) continue;
      const bytes = Math.floor(data.length * 0.75);
      const total = scannedDocs.reduce((sum, d) => sum + d.bytes, 0);
      if (scannedDocs.length >= 5 || bytes > 5 * 1024 * 1024 || total + bytes > 15 * 1024 * 1024) {
        skippedScans.push(String(candidate.name || "scanned.pdf"));
        continue;
      }
      scannedDocs.push({ name: String(candidate.name || "scanned.pdf"), data, bytes });
    }
  }
  return { scannedDocs, skippedScans };
}

function buildPreparerContent(payload) {
  const metadata = payload.metadata || {};
  const taxYearNum = Number(String(metadata.taxYear || payload.taxYear || "").match(/\d{4}/)?.[0] || 0);
  const priorYearNum = taxYearNum ? taxYearNum - 1 : 0;
  const yearContext = taxYearNum
    ? `TAX YEAR CONTEXT: You are preparing the workpaper for TAX YEAR ${taxYearNum}. The prior year is ${priorYearNum}. Any file or document whose name includes "${priorYearNum}" or that was uploaded as a prior-year reference contains ${priorYearNum} amounts — those are REFERENCE ONLY and must never appear as current-year amounts in this workpaper. All income, expense, balance sheet, and GL amounts for the ${taxYearNum} workpaper must come exclusively from files labeled current_financials.`
    : "";
  const content = [{
    type: "text",
    text: [
      "You are a senior tax preparer assistant. Your task is to produce an Excel-ready workpaper workbook based on the user's instructions and uploaded files.",
      "Do not prepare a tax return and do not invent amounts.",
      ...(yearContext ? [yearContext] : []),
      "Use the uploaded files according to the user's instructions. If prior-year workpapers and current-year reports are included, use prior-year workpapers for workbook structure, sheet names, section order, labels, and row layout; use current-year reports for updated values.",
      "The backend labels each uploaded file with a preparation role. Follow those labels exactly:",
      "- current_financials: source of truth for every current-year P&L, balance sheet, trial balance, and GL amount.",
      "- prior_return: source for beginning balances, carryforwards, depreciation/tax basis support, prior tax positions, and prior-year tax return disclosures only.",
      "- prior_workpaper: source for workbook structure, section order, labels, formulas/categories, and formatting only. Prior-year amounts are reference only and must never be used as current-year values.",
      "- supporting_document: use only for directly supported values/context.",
      "For a requested new-year workbook, keep a similar visual format to the prior-year Excel file: section boxes, underlined labels, title/header rows, column widths, merged cells, spacing, and sheet order should be mirrored as closely as the structured output allows while updating the numbers and year labels.",
      "The output must be a new workpaper workbook, not a narrative memo and not JSON pasted into Excel.",
      "If a requested value cannot be verified, leave the cell blank or write Unable to verify based on documents provided, and explain the missing support in AI Notes.",
      "Never invent a current-year amount. Never reuse a prior-year amount as a current-year amount unless a current-year source explicitly supports it. If a current-year P&L account is absent, the current-year amount is zero or blank and the issue belongs in AI Notes/flags, not silently copied from prior year.",
      "Return ONLY a JSON object inside ```json``` fences. No prose outside JSON.",
      "The JSON must be complete and parseable. If the full workbook would be too long, prioritize the main workpaper tabs and summarize lower-priority detail in AI Notes rather than truncating the JSON.",
      "The top-level JSON object MUST include a non-empty sheets array. Do not return only entryGuide, only aiNotes, only tables, only markdown, or a narrative answer.",
      "Each top-level sheets item MUST include a name and a non-empty rows array. Each rows item MUST be an array of primitive cell values.",
      "",
      "Required JSON schema:",
      '{"sheets":[{"name":"Workpaper","rows":[["Header 1","Header 2"],["value","value"]],"merges":[],"cols":[{"wch":18}],"styles":[{"r":0,"c":0,"bold":true,"underline":true,"border":true}]}],"aiNotes":["What could not be done","Missing information needed to finish"],"transactions8949":[],"assets4562":[],"w2s":[],"int_1099s":[],"div_1099s":[],"ret_1099rs":[],"ssa_1099s":[],"nec_1099s":[],"misc_1099s":[],"entryGuide":{"returnType":"string","taxYear":"string","software":"string","clientName":"string","ein":"string","generatedAt":"ISO timestamp","totalFields":number,"fieldsNeedingDecision":number,"fieldsFromReviewIssues":number,"allTiesOut":boolean,"tieOutChecks":[{"check":"Income lines vs CY P&L","guideAmount":0,"financialAmount":0,"difference":0,"status":"OK|NEEDS_REVIEW","note":"string"}],"completenessFlags":["string"],"screens":[{"screenNumber":number,"screenPath":"string","screenDescription":"string","softwareNavigation":"string","fields":[{"fieldNumber":number,"fieldName":"string","fieldDescription":"string","lineReference":"string","value":"string","amount":"string or number","valueSource":"string","amountSource":"string","tieOutStatus":"OK|NEEDS_REVIEW|N/A","status":"ready|decision_needed|verify|review_issue|not_applicable","statusNote":"string or null","dataType":"currency|percentage|date|text|checkbox|dropdown|integer","reviewIssueRef":"string or null"}],"screenNotes":"string or null"}],"decisionItems":[],"reviewIssueFields":[],"entryOrder":"string","estimatedEntryTime":"string"},"reconciliation":{"netIncomePerBooks":0,"ajes":[{"label":"string","amount":0,"note":"string"}],"m1":{"meals50":0,"entertainment":0,"penalties":0,"politicalLobbying":0,"officerLifeInsurance":0,"federalIncomeTax":0,"charitable":0,"ownerHealthcare":0,"homeOffice":0,"creditCardRewards":0,"taxExemptInterest":0,"depreciationBookVsTax":0,"sec179Bonus":0,"gainLossBookVsTax":0,"assetSaleIncomeRemoval":0,"portfolioIncomeRemoval":0,"foreignTaxesPaid":0,"section163j":0,"otherPermanent":0,"otherTiming":0},"separatelyStated":[{"label":"string","amount":0,"note":"string"}]},"owners":[{"name":"string","ownershipPct":0}]}',
      "The 'reconciliation' object is REQUIRED for any return with a Schedule M-1 (1065, 1120, 1120-S) AND for a 1040 whose uploads include business financials (P&L / balance sheet — Schedule C or E business) — it is detailed in the STRUCTURED RECONCILIATION section below and is the ONLY place the book-to-tax reconciliation is returned. Omit it only for a 990/1041 or a purely personal 1040 (W-2s/1099s with no business P&L).",
      "",
      "DRAKE IMPORT ARRAYS (include only when the relevant source documents are present in the uploads):",
      "transactions8949: Extract every capital gain/loss transaction you can find in uploaded 1099-B forms, brokerage statements, or Schedule D source documents. Each element: { description, dateAcquired, dateSold, proceeds, basis, form8949Box, adjCode, adjAmount, washSaleLoss, tsj }. Dates must be in MM/DD/YYYY format. form8949Box: 'A' (short-term, basis reported), 'B' (short-term, basis NOT reported), 'C' (short-term, other), 'D' (long-term, basis reported), 'E' (long-term, basis NOT reported), 'F' (long-term, other). If no capital gain documents are uploaded, omit this key or return an empty array.",
      "assets4562: Extract every depreciable asset you can find in uploaded depreciation schedules, fixed asset lists, or Form 4562 from prior-year returns. Each element: { description, dateInService, cost, method, life, priorDepreciation, section179, bonusDepreciation, businessUsePct }. dateInService must be in MM/DD/YYYY format. method: 'SL', '200DB', '150DB', 'HY', or blank. If no asset documents are uploaded, omit this key or return an empty array.",
      "w2s: Extract every W-2 you can find in uploaded documents. Each element: { tsj, employer, ein, box1, box2, box3, box4, box5, box6, box12_code, box12_amount, box13_retirement, box15_state, box16_state_wages, box17_state_wh }. tsj: 'T'=taxpayer, 'S'=spouse. box1=wages, box2=fed WH, box3=SS wages, box4=SS WH, box5=Medicare wages, box6=Medicare WH. If no W-2 documents are uploaded, omit or return empty array.",
      "int_1099s: Extract every 1099-INT. Each element: { tsj, payer, ein, box1, box2, box3, box4 }. box1=interest, box2=early withdrawal penalty, box3=US savings bonds, box4=fed WH. Omit if none found.",
      "div_1099s: Extract every 1099-DIV. Each element: { tsj, payer, ein, box1a, box1b, box2a, box4 }. box1a=total dividends, box1b=qualified dividends, box2a=total capital gain, box4=fed WH. Omit if none found.",
      "ret_1099rs: Extract every 1099-R. Each element: { tsj, payer, ein, box1, box2a, box4, box7, box7_ira }. box1=gross distribution, box2a=taxable amount, box4=fed WH, box7=distribution code (1/2/4/7/G/etc.), box7_ira=true if IRA/SEP/SIMPLE box is checked. Omit if none found.",
      "ssa_1099s: Extract every SSA-1099. Each element: { tsj, box3, box4 }. box3=net SS benefits, box4=fed WH. Omit if none found.",
      "nec_1099s: Extract every 1099-NEC. Each element: { tsj, payer, ein, box1, box4 }. box1=nonemployee compensation, box4=fed WH. Omit if none found.",
      "misc_1099s: Extract every 1099-MISC (for pre-2020 returns or genuine misc income). Each element: { tsj, payer, ein, box3, box7, box4 }. box3=other income, box7=nonemployee comp (pre-2020), box4=fed WH. Omit if none found.",
      "IMPORTANT: Only include data you can actually read from the uploaded files. Do not invent transactions, assets, or income documents. If you find partial data include what you can and set missing fields to null.",
      "",
      "Rules for sheets:",
      "Create one or more useful Excel sheets based on the request.",
      "CANONICAL SHEET NAMES (use these EXACT names so every run produces the same tabs): 'Profit and Loss' for the current-year P&L workpaper tab, 'Balance Sheet' for the balance sheet tab, 'AJE Worksheet' for adjusting journal entries, 'Fixed Assets' for fixed asset additions/depreciation detail. Use each canonical name ONLY for a tab that actually contains that statement — never name a W-2 summary, source-document digest, or other content 'Profit and Loss'. Additional tabs beyond these may use descriptive names of your choice (e.g. 'W-2 Summary'). Do NOT create any K-1 tab for a 1065/1120-S — the app builds the 'Schedule K-1 Allocation' tab in code from your reconciliation and owners data.",
      "K-1 INTAKE (1040 preparation): when an uploaded workpaper contains a 'Schedule K-1 Allocation' tab (produced by this app for the related 1065/1120-S), treat the taxpayer's column there as their Schedule K-1: ordinary business income to Schedule E Part II, and each separately stated line to its 1040 destination (interest to Sch B, Section 1231 gain via Form 4797, charitable to Sch A, distributions for basis tracking). Flag if the taxpayer's name does not match any owner column.",
      "At least one sheet must be a real workpaper sheet with calculated/updated values, not a placeholder and not a JSON/text dump.",
      "When a workbookTemplate is provided for an uploaded Excel file, mirror that template's sheets, headers, labels, row order, and column order as closely as possible.",
      "Keep the same workpaper-style layout from the prior-year workbook, updating year labels and values for the current-year request. Preserve columns widths, merged cells, underlined words, boxed sections, and obvious title/header formatting by returning cols, merges, and styles entries where available.",
      "Every sheet.rows value must be an array of rows, and every row must be an array of primitive cell values.",
      "Keep rows concise. Do not include long paragraphs in cells unless the user specifically requested narrative notes.",
      "Always include useful headers in row 1.",
      "Do not include formulas unless the formula is obvious and safe.",
      "Always include aiNotes with things you could not complete and information still needed.",
      "",
      "Mandatory workpaper refresh process:",
      "1. Balance sheet: beginning balances come from prior_return or prior-year ending balances; ending balances must come from current_financials. Flag any imbalance between assets and liabilities/equity.",
      "2. P&L: current-year values must come from current_financials. Map current-year accounts into the prior_workpaper structure; add new accounts when needed; set prior-year accounts with no current-year activity to 0 or blank.",
      "3. GL detail: reconcile supporting detail to refreshed P&L and balance sheet lines where GL detail is provided.",
      "4. Book-to-tax: start from current-year net income per books from current_financials. Then apply current-year supported addbacks/deductions and tax adjustments. Always evaluate meals, entertainment, depreciation timing, penalties, federal income tax, Section 163(j), officer life insurance, state tax, charitable contributions, and any other prior-year recurring adjustment category. If an adjustment has no current-year support, do not use prior-year amount; mark it 0/blank and flag as not supported.",
      "5. CRITICAL — HOW TO OUTPUT THE BOOK-TO-TAX RECONCILIATION: express it ONLY through the top-level 'reconciliation' object (schema in STRUCTURED RECONCILIATION below). The app rebuilds the Schedule M-1 sheet from that object with fixed lines and live subtotal formulas. Therefore you MUST NOT create any worksheet for it: do NOT put a sheet named or containing 'Book to Tax', 'Book-to-Tax', 'M-1', 'M-3', 'Reconciliation', or 'Schedule M' in the sheets array. Do NOT compute the reconciliation subtotals yourself (Adjusted Net Income, Ordinary/Business Income, Taxable Income) — supply only the signed component amounts in the object and the app foots them. Returning the reconciliation as a sheet instead of the object produces a WRONG, inconsistent workbook.",
      "5b. CONSISTENT ENTITY TYPE AND DIRECTIONS: put the assumed entity/return type in the reconciliation, and apply every adjustment's sign (addback = +, subtraction = −) consistently for that entity type. Do NOT flip the same item (e.g. owner healthcare premiums, home-office reclass) between + and −. Follow the FIXED TREATMENT RULES below for the standard items.",
      "6. M-2 / retained earnings: tie beginning retained earnings, book income, distributions/dividends, and ending retained earnings to the balance sheet or flag the difference.",
      "7. Source every material number in a nearby source/notes column or AI Notes. Every current-year amount must be traceable to a current_financials line, GL line, or explicit user instruction.",
      "",
      ...RECONCILIATION_PROMPT_LINES,
      "",
      "Rules for entryGuide:",
      "Generate entryGuide in the same JSON response. Do not leave entryGuide empty.",
      "The app will insert entryGuide into the downloaded Excel workbook as a Data Entry Guide sheet, so the guide must be complete on the first generation.",
      "The entryGuide must be specific to the selected tax software below. Use that software's screen terminology, navigation paths, and field labels. Do not default to ProConnect unless ProConnect is the selected software.",
      "For every material workbook line item, source-file value, tax adjustment, balance sheet item, payment, deduction, credit, state amount, and reviewer-required item, create an entryGuide field with screenPath, softwareNavigation, fieldName, value, valueSource, status, and statusNote.",
      "For ProConnect 1120 workpapers, use field-level paths precise enough for a preparer to enter the return without guessing. Other Deductions must list each component separately, not as one combined number.",
      "The entryGuide must include tieOutChecks with these checks at minimum: income lines vs current-year P&L revenue; COGS vs current-year P&L; deductions vs P&L/book-to-tax bridge; assets vs current-year balance sheet; liabilities plus equity vs current-year balance sheet; net income vs current-year P&L; taxable income vs M-1/M-3.",
      "Each tieOutChecks item must include check, guideAmount, financialAmount, difference, status (OK or NEEDS_REVIEW), and note.",
      "The entryGuide must include completenessFlags for any P&L or balance sheet account that was not mapped into the workbook or tax software guide.",
      "Each field should include lineReference, amountSource, tieOutStatus, and dataType when available.",
      "If a value is not entered in tax software, mark it not_applicable and explain why.",
      "If a value requires preparer judgment, mark it decision_needed with the decision item.",
      "At minimum, include the core client information, income, deductions, book-to-tax adjustments, tax/payments, balance sheet, state items, and any review-sensitive entries that are supported by the uploaded files.",
      "",
      `Tax software: ${softwareDisplayName(metadata.taxSoftware || payload.taxSoftware || "proconnect")}`,
      "Any software-specific guidance or entry steps must use the selected tax software's screen terminology and navigation paths from the system prompt.",
      "",
      `User instructions: ${metadata.instructions || "None"}`,
    ].join("\n"),
  }];

  for (const file of payload.files || []) {
    if (!file.text) continue;
    const role = file.preparationRole || "supporting_document";
    let workbookTemplates = [
      file.workbookTemplate,
      ...(Array.isArray(file.workbookTemplates) ? file.workbookTemplates : []),
    ].filter((template) => template?.sheets?.length);

    // For prior-year workpapers we provide ONLY the empty structure (labels, sheet
    // order, formatting) with every dollar amount blanked out. This is the key
    // enforcement: if the prior-year numbers are not in the prompt, the model cannot
    // copy them and is forced to fill the workpaper from the current-year financials.
    // Labels, section names, adjustment categories, and notes are preserved.
    let fileText = file.text;
    if (role === "prior_workpaper") {
      workbookTemplates = workbookTemplates.map(stripAmountsFromTemplate);
      fileText = workbookTemplates.length
        ? csvTextFromTemplates(workbookTemplates)
        : stripFinancialAmountsFromText(file.text);
    }

    // Role-specific header for the structured Excel data block — this is critical
    // because the prior header said "PRIOR-YEAR WORKBOOK TEMPLATE" for ALL files,
    // which confused Claude into treating current-year Excel exports as prior-year references.
    let structuredDataHeader;
    if (role === "current_financials") {
      structuredDataHeader = `=== STRUCTURED CURRENT-YEAR FINANCIAL DATA (${taxYearNum || "CURRENT YEAR"}) — SOURCE OF TRUTH FOR ALL CURRENT-YEAR AMOUNTS — USE THESE NUMBERS IN THE WORKPAPER ===`;
    } else if (role === "prior_workpaper") {
      structuredDataHeader = `=== EMPTY PRIOR-YEAR WORKBOOK SKELETON (${priorYearNum || "PRIOR YEAR"}) — FORMAT/STRUCTURE/LABELS ONLY — ALL DOLLAR AMOUNTS HAVE BEEN REMOVED ON PURPOSE — FILL EVERY VALUE FROM THE CURRENT-YEAR FINANCIAL FILES ===`;
    } else if (role === "prior_return") {
      structuredDataHeader = `=== STRUCTURED PRIOR-YEAR TAX RETURN (${priorYearNum || "PRIOR YEAR"}) — USE ONLY FOR CARRYFORWARDS, BEGINNING BALANCES, AND DEPRECIATION BASIS ===`;
    } else {
      structuredDataHeader = `=== STRUCTURED WORKBOOK DATA ===`;
    }

    const templateBlock = workbookTemplates.length
      ? ["", structuredDataHeader, safeJsonForPrompt(workbookTemplates.slice(0, 3), 100000)].join("\n")
      : "";

    // Per-file year instruction so Claude cannot miss which year the data belongs to
    let yearNote = "";
    if (taxYearNum) {
      if (role === "current_financials") {
        yearNote = `YEAR: ${taxYearNum} (CURRENT YEAR) — All dollar amounts in this file are ${taxYearNum} values. Use them as the authoritative source for the workpaper.`;
      } else if (role === "prior_workpaper") {
        yearNote = `YEAR: ${priorYearNum || "PRIOR"} (PRIOR YEAR TEMPLATE — AMOUNTS REMOVED) — This file has had all dollar amounts intentionally stripped. Use it ONLY for sheet names, row labels, section order, adjustment categories, and formatting. Every number in the new ${taxYearNum} workpaper must be calculated from the current-year financial files, never carried over from prior year.`;
      } else if (role === "prior_return") {
        yearNote = `YEAR: ${priorYearNum || "PRIOR"} (PRIOR YEAR RETURN) — Dollar amounts are ${priorYearNum || "prior-year"} values. Use only for beginning balances, carryforwards, and depreciation basis.`;
      }
    }

    content.push({
      type: "text",
      text: [
        `=== PREPARATION SOURCE FILE: ${file.name} ===`,
        `ROLE: ${role}`,
        `ROLE PURPOSE: ${file.preparationRoleDescription || "Use only for directly supported values or context."}`,
        yearNote,
        fileText,
        templateBlock,
      ].filter(Boolean).join("\n\n"),
    });
  }

  // Scanned/image-only PDFs (no extractable text — e.g. scanned 1099s and broker
  // composites) are attached as NATIVE PDF documents so the model reads them visually.
  // Caps stay well under the API's 100-page / request-size limits: max 5 docs, 5 MB each,
  // 15 MB total. Anything beyond the caps is announced as NOT attached so the model
  // flags it instead of silently missing data.
  const { scannedDocs, skippedScans } = collectScannedPdfDocuments(payload);
  if (scannedDocs.length) {
    content.push({
      type: "text",
      text: `SCANNED SOURCE DOCUMENTS ATTACHED (${scannedDocs.length}): the following uploads are image-based PDFs with no extractable text; each is attached below as a document. READ THEM VISUALLY and extract every reportable amount exactly as printed (payer, box numbers, amounts, withholding, transactions). Do NOT report these documents as missing: ${scannedDocs.map((d) => d.name).join("; ")}.${skippedScans.length ? ` NOT ATTACHED (size limits — flag as pending in aiNotes): ${skippedScans.join("; ")}.` : ""}`,
    });
    for (const doc of scannedDocs) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: doc.data },
        title: doc.name.slice(0, 120),
      });
    }
  }

  return content;
}

// Returns true when a cell holds a pure financial amount / date / percentage
// (digits plus only financial punctuation, no letters). Label cells that contain
// letters — e.g. "Add: Meals 50%", "401(k) Safe Harbor", "January - December 2024"
// — are NOT treated as amounts and are preserved.
function isFinancialAmountCell(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return false;
  if (!/\d/.test(s)) return false;       // must contain a digit
  if (/[a-zA-Z]/.test(s)) return false;  // any letter => it is a label, keep it
  return /^[\d\s.,()\-$%/]+$/.test(s);   // only digits + financial/date punctuation => amount
}

function stripAmountsFromRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => (isFinancialAmountCell(cell) ? "" : cell))
  );
}

function stripAmountsFromTemplate(template) {
  if (!template || !Array.isArray(template.sheets)) return template;
  return {
    ...template,
    sheets: template.sheets.map((sheet) => ({
      ...sheet,
      rows: stripAmountsFromRows(sheet.rows),
    })),
  };
}

// Rebuild a clean, number-free CSV view from already-stripped templates so the
// natural-language text the model reads also contains no copyable prior-year amounts.
function csvTextFromTemplates(templates) {
  return (Array.isArray(templates) ? templates : []).map((template) => {
    if (!template || !Array.isArray(template.sheets)) return "";
    return template.sheets.map((sheet) => {
      const head = `--- Sheet: ${sheet.name || ""} ---`;
      const body = (Array.isArray(sheet.rows) ? sheet.rows : []).map((row) =>
        (Array.isArray(row) ? row : []).map((cell) => {
          const s = String(cell == null ? "" : cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(",")
      ).join("\n");
      return `${head}\n${body}`;
    }).join("\n\n");
  }).filter(Boolean).join("\n\n");
}

// Fallback for prior_workpaper files that have no structured template (e.g. a PDF).
// Blanks standalone financial amounts in free text while leaving labels intact.
function stripFinancialAmountsFromText(text) {
  return String(text || "").replace(
    /(^|[\s,;|(])\$?-?\(?\d[\d,]*(?:\.\d+)?\)?%?(?=$|[\s,;|)])/g,
    (match, lead) => `${lead}`
  );
}

function buildDataEntryGuideSystemPrompt(returnType, taxYear, taxSoftware) {
  const softwareName = softwareDisplayName(taxSoftware);
  return [
    `You are a senior ${softwareName} tax software expert for Tax Year ${taxYear}.`,
    `You have memorized the exact screen structure, navigation path, and field names of ${softwareName} for Form ${returnType}.`,
    "Your job is to generate a complete, ordered data entry guide that tells the preparer exactly where to enter every piece of data in the selected tax software. This must be operational software-entry instructions, not another copy of the Excel workpaper and not a summary of the workbook.",
    "",
    "CRITICAL RULES:",
    "- Organize entries in the exact order the screens appear in the software so the preparer can work top-to-bottom without jumping between screens.",
    "- Use exact screen names and field names where the selected software is known.",
    "- For every material workbook line item or source-file value, identify the software screen/path, field name, value to enter, source, and any verification note.",
    "- If the workbook contains formatting/layout rows, ignore those for entry unless they represent an actual tax input value.",
    "- Pre-calculate every value; never say calculate a value when the final value can be derived.",
    "- If a value requires a preparer decision before entry, mark it decision_needed.",
    "- If a value came from a HIGH priority review issue, mark it review_issue.",
    "- If a value is uncertain or needs verification, mark it verify.",
    "- Never leave a field blank if the value can be derived from the input data.",
    "",
    "PROCONNECT TAX SCREEN ORDER:",
    proConnectScreenOrder(returnType),
    "",
    "DRAKE TAX REQUIREMENTS:",
    "- If the selected software is Drake Tax, every screenPath must start with the Drake data-entry screen code followed by a dash and the screen name, for example: W2 - Wages, INT - Interest Income, DIV - Dividend Income, 99G - Government Payments, ES - Estimated Taxes, A - Itemized Deductions, C - Schedule C, E - Schedule E, K1 - Schedule K-1, 4562 - Depreciation, BANK - Bank Information, EF - EF Selections, PDF - PDF Attachments, PAD - Preparer Notepad.",
    "- For Drake Tax, also include screenCode or drakeScreenCode on each screen when known. The value must be the code the preparer can type in Drake's 'Enter Screen, State or Search Phrase' box.",
    "- For Drake Tax, include tabOrder or drakeTabOrder on a field only when you are confident in the exact number of Tab keystrokes from the first field on that Drake screen. If you are not confident, omit tabOrder and write a clear statusNote.",
    "- For Drake Tax, softwareNavigation must use this format when a code is known: Type screen code [CODE] in the Drake data entry search box, press Enter, then enter [Field Name].",
    "- If a Drake field is not supported by a general import and requires data entry, still include it in entryGuide so the app can generate the supervised Drake Auto-Entry Script.",
    "",
    "For other non-ProConnect software, keep the same JSON structure and use the closest exact navigation paths you know. If exact paths are not known, use standard tax return section names and set softwareNavigation to a generic instruction.",
    "",
    "OUTPUT FORMAT: respond ONLY with valid JSON inside ```json fences using this schema:",
    '{"returnType":"string","taxYear":"string","software":"string","clientName":"string","ein":"string","generatedAt":"ISO timestamp","totalFields":number,"fieldsNeedingDecision":number,"fieldsFromReviewIssues":number,"screens":[{"screenNumber":number,"screenPath":"string","screenDescription":"string","softwareNavigation":"string","fields":[{"fieldNumber":number,"fieldName":"string","fieldDescription":"string","value":"string","valueSource":"string","status":"ready|decision_needed|verify|review_issue|not_applicable","statusNote":"string or null","dataType":"currency|percentage|date|text|checkbox|dropdown|integer","reviewIssueRef":"string or null"}],"screenNotes":"string or null"}],"decisionItems":[{"screen":"string","field":"string","question":"string","options":["string"],"impactIfWrong":"string"}],"reviewIssueFields":[{"screen":"string","field":"string","issue":"string","blocksEntry":boolean}],"entryOrder":"string","estimatedEntryTime":"string"}',
  ].join("\n");
}

function buildDataEntryGuidePrompt(payload) {
  const reviewIssues = Array.isArray(payload.highReviewIssues) ? payload.highReviewIssues : [];
  return [
    "Create the data entry guide from the following session data.",
    "",
    `Return type: ${payload.returnType || "Not provided"}`,
    `Tax year: ${payload.taxYear || "Not provided"}`,
    `Tax software: ${softwareDisplayName(payload.taxSoftware || "proconnect")}`,
    `Client name: ${payload.clientName || "Not provided"}`,
    `EIN: ${payload.ein || "Not provided"}`,
    "",
    "Workpaper data / generated workbook JSON:",
    safeJsonForPrompt(payload.workpaperData || {}, 60000),
    "",
    "Accounting software data, if any, should be used as a source for field values and cited as [Software] [Report Name] [Line]:",
    safeJsonForPrompt(payload.qboReports || [], 30000),
    "",
    "The following HIGH priority issues were found in the tax review. For any field in the data entry guide that corresponds to one of these issues, set its status to review_issue and include the issue description in the statusNote:",
    reviewIssues.length ? safeJsonForPrompt(reviewIssues, 30000) : "No HIGH priority review issues were provided.",
    "",
    "User / preparer instructions:",
    String(payload.instructions || payload.metadata?.instructions || "None"),
  ].join("\n");
}

function proConnectScreenOrder(returnType) {
  const key = String(returnType || "").toUpperCase();
  const orders = {
    "1120": [
      "1. General > Client Information",
      "2. General > Electronic Filing",
      "3. General > Miscellaneous Information",
      "4. Income > Gross Receipts / Sales",
      "5. Income > Cost of Goods Sold (Form 1125-A)",
      "6. Income > Dividends and Inclusions",
      "7. Income > Interest Income",
      "8. Income > Gross Rents",
      "9. Income > Gross Royalties",
      "10. Income > Capital Gain Net Income",
      "11. Income > Other Income",
      "12. Deductions > Compensation of Officers (Form 1125-E)",
      "13. Deductions > Salaries and Wages",
      "14. Deductions > Repairs and Maintenance",
      "15. Deductions > Bad Debts",
      "16. Deductions > Rents",
      "17. Deductions > Taxes and Licenses",
      "18. Deductions > Interest",
      "19. Deductions > Charitable Contributions",
      "20. Deductions > Depreciation (Form 4562)",
      "21. Deductions > Depletion",
      "22. Deductions > Advertising",
      "23. Deductions > Pension / Profit Sharing",
      "24. Deductions > Employee Benefit Programs",
      "25. Deductions > Other Deductions",
      "26. Tax and Payments > Schedule J",
      "27. Tax and Payments > Estimated Tax Payments",
      "28. Balance Sheet > Assets (Schedule L)",
      "29. Balance Sheet > Liabilities and Equity (Schedule L)",
      "30. Reconciliation > Schedule M-1",
      "31. Reconciliation > Schedule M-2",
      "32. Reconciliation > Schedule M-3 (if required)",
      "33. State > [State name] > [State-specific screens]",
    ],
    "1120-S": [
      "1. General > Client Information",
      "2. General > Electronic Filing",
      "3. General > S Corporation Information",
      "4. Income > Gross Receipts / Sales",
      "5. Income > Cost of Goods Sold",
      "6. Income > Other Income",
      "7. Deductions > Officer Compensation (Form 1125-E)",
      "8. Deductions > Salaries and Wages",
      "9. Deductions > Other deduction lines in return order",
      "10. Deductions > Other Deductions",
      "11. Schedule K > Income (Loss)",
      "12. Schedule K > Deductions",
      "13. Schedule K > Credits",
      "14. Schedule K > Foreign Transactions",
      "15. Schedule K > AMT Items",
      "16. Schedule K > Other Information",
      "17. Shareholders > K-1 for each shareholder",
      "18. Balance Sheet > Schedule L",
      "19. Reconciliation > Schedule M-1",
      "20. Reconciliation > Schedule M-2 (AAA, OAA)",
      "21. State > [State screens]",
    ],
    "1065": [
      "1. General > Client Information",
      "2. General > Electronic Filing",
      "3. General > Partnership Information",
      "4. Income > Ordinary Business Income",
      "5. Income > Other Income",
      "6. Deductions > Deduction lines in return order",
      "7. Deductions > Other Deductions",
      "8. Schedule K > Income (Loss)",
      "9. Schedule K > Deductions",
      "10. Schedule K > Self-Employment",
      "11. Schedule K > Credits",
      "12. Schedule K > Foreign Transactions",
      "13. Schedule K > AMT Items",
      "14. Schedule K > Other Information",
      "15. Partners > K-1 for each partner",
      "16. Balance Sheet > Schedule L",
      "17. Reconciliation > Schedule M-1 or M-3",
      "18. Reconciliation > Schedule M-2 (capital accounts)",
      "19. State > [State screens]",
    ],
    "1040": [
      "1. General > Personal Information",
      "2. General > Electronic Filing",
      "3. Income > Wages (W-2)",
      "4. Income > Interest Income (1099-INT)",
      "5. Income > Dividend Income (1099-DIV)",
      "6. Income > State Tax Refunds (1099-G)",
      "7. Income > Business Income (Schedule C)",
      "8. Income > Capital Gains (Schedule D / 8949)",
      "9. Income > Supplemental Income (Schedule E)",
      "10. Income > Other Income",
      "11. Deductions > Standard vs Itemized",
      "12. Deductions > Student Loan Interest",
      "13. Deductions > IRA Contributions",
      "14. Credits > Child Tax Credit",
      "15. Credits > Education Credits (Form 8863)",
      "16. Credits > Foreign Tax Credit (Form 1116)",
      "17. Credits > Other Credits",
      "18. Taxes > Self-Employment Tax (Schedule SE)",
      "19. Taxes > Other Taxes",
      "20. Payments > Federal Withholding",
      "21. Payments > Estimated Tax Payments",
      "22. State > [State screens]",
    ],
    "990": [
      "1. General > Organization Information",
      "2. General > Electronic Filing",
      "3. Revenue > Contributions and Grants",
      "4. Revenue > Program Service Revenue",
      "5. Revenue > Investment Income",
      "6. Revenue > Dispositions (Schedule D)",
      "7. Revenue > Other Revenue",
      "8. Expenses > Grants Paid",
      "9. Expenses > Compensation",
      "10. Expenses > Other Expenses",
      "11. Balance Sheet > Assets (Part X)",
      "12. Balance Sheet > Liabilities and Net Assets (Part X)",
      "13. Schedules > Schedule A",
      "14. Schedules > Schedule B",
      "15. Schedules > Schedule D",
      "16. Schedules > Schedule F",
      "17. Schedules > Schedule O",
    ],
    "1041": [
      "1. General > Entity Information",
      "2. Income > Interest Income",
      "3. Income > Dividends",
      "4. Income > Business Income",
      "5. Income > Capital Gains (Schedule D)",
      "6. Income > Rents, Royalties (Schedule E)",
      "7. Income > Farm Income",
      "8. Income > Other Income",
      "9. Deductions > Interest",
      "10. Deductions > Taxes",
      "11. Deductions > Fiduciary Fees",
      "12. Deductions > Attorney / Accountant Fees",
      "13. Deductions > Other Deductions",
      "14. Distributions > Income Distribution Deduction",
      "15. Beneficiaries > K-1 for each beneficiary",
      "16. State > [State screens]",
    ],
  };
  return (orders[key] || orders["1120"]).join("\n");
}

function softwareDisplayName(value) {
  const key = String(value || "").toLowerCase();
  const software = taxSoftwareById(key);
  if (software) return software.name;
  const names = {
    proconnect: "ProConnect Tax",
    lacerte: "Lacerte",
    proseries: "ProSeries",
    drake: "Drake Tax",
    ultratax: "UltraTax CS",
    cch_axcess: "CCH Axcess",
    cch_prosystem: "CCH ProSystem fx",
    other: "Other / Generic",
  };
  return names[key] || value || "ProConnect Tax";
}

function highReviewIssuesForEntryGuide(reviewResult) {
  const issues = reviewResult?.structured?.issues || reviewResult?.issues || [];
  if (!Array.isArray(issues)) return [];
  return issues.filter((issue) => {
    const priority = String(issue.priority || issue.severity || "").toLowerCase();
    return priority.includes("high") && (issue.formOrSchedule || issue.lineOrField);
  }).map((issue, index) => ({
    id: issue.id || `HIGH-${index + 1}`,
    formOrSchedule: issue.formOrSchedule || issue.areaReviewed || "",
    lineOrField: issue.lineOrField || "",
    description: issue.description || issue.issue || issue.summary || "",
    recommendation: issue.recommendation || issue.fix || "",
  }));
}

function safeJsonForPrompt(value, maxChars) {
  const text = JSON.stringify(value || {}, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated for prompt length]`;
}

function annotateReviewFileRoles(files, payload = {}) {
  return (Array.isArray(files) ? files : []).map((file) => {
    const role = detectReviewFileRole(file, payload);
    return { ...file, reviewRole: role.id, canonicalRole: role.id, roleDescription: role.description };
  });
}

function detectReviewFileRole(file = {}, payload = {}) {
  const metadata = payload.metadata || {};
  const taxYear = Number(String(metadata.taxYear || payload.taxYear || "").match(/\d{4}/)?.[0] || 0);
  const currentYear = taxYear ? String(taxYear) : "";
  const priorYear = taxYear ? String(taxYear - 1) : "";
  const name = String(file.name || "").toLowerCase();
  const ext = String(file.name || "").toLowerCase().split(".").pop() || "";
  // Frontend sends the extracted content as extractedText; file.text only exists on
  // some legacy paths. Reading the wrong field left detection filename-only, which is
  // how "FRANZESE, JOSEPH A 1040.pdf" ended up as supporting_document.
  const text = String(file.extractedText || file.text || "").slice(0, 16000).toLowerCase();
  const explicitRole = String(file.role || "").toLowerCase();
  const joined = `${name}\n${text}`;
  const canonicalRoles = new Set(["current_return", "prior_return", "current_workpaper", "prior_workpaper", "supporting_document"]);
  if (canonicalRoles.has(explicitRole)) return roleDefinition(explicitRole);
  if (explicitRole === "current-year") return roleDefinition("current_return");
  if (explicitRole === "prior-year") return roleDefinition("prior_return");
  if (explicitRole.includes("support")) return roleDefinition("supporting_document");

  const isSpreadsheet = ["xlsx", "xls", "xlsm", "csv"].includes(ext) || /spreadsheet|excel/.test(String(file.mediaType || "").toLowerCase());
  const isZip = ext === "zip" || /zip/.test(String(file.mediaType || "").toLowerCase());
  const isWorkpaper = /\b(workpaper|workpapers|work paper|wp\b|trial balance|balance sheet|profit\s*(and|&)?\s*loss|p&l|general ledger|book[-\s]?to[-\s]?tax|m-1|m-2|m-3|lead sheet|supporting schedule)\b/.test(joined)
    || (isSpreadsheet && /\b(book[-\s]?to[-\s]?tax|trial balance|balance sheet|p&l|profit\s*(and|&)?\s*loss|tax workpapers?)\b/.test(joined));
  const isSupporting = /\b(w-?2|w-?3|w-?9|1099|k-?1|pir\b|05-102|franchise|depreciation|fixed asset|bank statement|brokerage|payroll|invoice|receipt|support|backup|source document)\b/.test(joined)
    || (isZip && /\b(w-?2|w-?3|w-?9|1099|k-?1|pir|support|docs?|documents?|backup)\b/.test(joined));
  // "form" is optional and "tax returns" (plural) counts: real packages arrive named
  // "FRANZESE, JOSEPH A 1040.pdf" or "Joseph Franzese - 2024 tax returns.pdf".
  // Supporting/workpaper checks still win first, so a "1099" or "K-1" file that
  // mentions Form 1040 in its instructions is not misclassified as a return.
  const isReturn = /\b((form\s*)?(1040|1041|1065|1120s?|1120-s|990)|u\.s\.\s*(individual|income tax|corporation|partnership).*return|tax returns?|income tax returns?)\b/.test(joined)
    && !isSupporting
    && !isWorkpaper;
  const mentionsCurrent = currentYear && (name.includes(currentYear) || joined.includes(`tax year ${currentYear}`) || joined.includes(`ty ${currentYear}`) || joined.includes(`year ended 12/31/${currentYear}`));
  const mentionsPrior = priorYear && (name.includes(priorYear) || joined.includes(`tax year ${priorYear}`) || joined.includes(`ty ${priorYear}`) || joined.includes(`year ended 12/31/${priorYear}`));

  if (isWorkpaper) {
    if (mentionsPrior && !mentionsCurrent) {
      return roleDefinition("prior_workpaper");
    }
    return roleDefinition("current_workpaper");
  }
  if (isReturn) {
    if (mentionsPrior && !mentionsCurrent) return roleDefinition("prior_return");
    return roleDefinition("current_return");
  }
  if (isSupporting) return roleDefinition("supporting_document");
  return roleDefinition("supporting_document");
}

function roleDefinition(role) {
  const definitions = {
    prior_return: "Prior-year tax return used for reference, beginning balances, prior positions, and consistency checks.",
    current_return: "Current-year return under senior review. Analyze this return for errors.",
    prior_workpaper: "Prior-year workpaper used for reference, recurring adjustments, and prior treatment.",
    current_workpaper: "Current-year workpaper. Current-year return amounts should tie to this source.",
    supporting_document: "Supporting document. Determine whether it belongs on the current-year return and whether amounts are reflected correctly.",
  };
  const id = definitions[role] ? role : "supporting_document";
  return { id, description: definitions[id] };
}

function getReviewFeedbackForPayload(payload = {}) {
  const feedback = readFeedbackStore();
  const clientId = resolveClientIdFromPayload(payload);
  const returnType = normalizeReturnType(resolveReturnTypeFromPayload(payload));
  const entries = (feedback.entries || []).filter((entry) => {
    const labels = [
      entry.tag,
      entry.category,
      entry.tab,
      entry.feedbackType,
      ...(Array.isArray(entry.tags) ? entry.tags : []),
    ].map((value) => String(value || "").toLowerCase());
    const isReview = labels.some((label) => label === "review" || label === "reviewer" || label.includes("review"));
    if (!isReview) return false;
    if (entry.clientId && clientId && entry.clientId !== clientId) return false;
    if (entry.clientId && !clientId) return false;
    const entryType = normalizeReturnType(entry.returnType || "");
    if (entryType && returnType && entryType !== returnType) return false;
    return true;
  }).slice(-25);
  return entries.map((entry) => ({
    id: entry.id,
    tag: entry.tag || entry.tab || "review",
    clientId: entry.clientId || null,
    returnType: entry.returnType || null,
    text: entry.text || entry.preparerCorrection || entry.originalAIOutput || entry.feedback || "",
    createdBy: entry.createdBy || entry.addedBy || entry.username || "",
    createdAt: entry.createdAt || entry.addedAt || "",
  })).filter((entry) => entry.text);
}

// Returns the preparation (current) tax year as a string, reconciling the metadata
// year with the most recent year that appears in the uploaded filenames. The metadata
// year can be a stale hidden-field default (e.g. "2024" while the user uploads 2025
// financials), so we take whichever year is later. Falls back to the metadata year,
// then the latest filename year, then "".
function reconcilePreparationYear(metaYearStr, files) {
  const metaYear = Number(String(metaYearStr || "").match(/\b(20\d{2})\b/)?.[1] || 0);
  let maxFileYear = 0;
  for (const file of Array.isArray(files) ? files : []) {
    const matches = String(file?.name || "").match(/\b(20\d{2})\b/g);
    if (matches) for (const y of matches) maxFileYear = Math.max(maxFileYear, Number(y));
  }
  const reconciled = Math.max(metaYear, maxFileYear);
  return reconciled ? String(reconciled) : String(metaYearStr || "").trim();
}

function annotatePreparationFileRoles(files, payload = {}) {
  return (Array.isArray(files) ? files : []).map((file) => {
    const role = detectPreparationFileRole(file, payload);
    return { ...file, preparationRole: role.id, preparationRoleDescription: role.description };
  });
}

function detectPreparationFileRole(file = {}, payload = {}) {
  const metadata = payload.metadata || {};
  const taxYear = Number(String(metadata.taxYear || payload.taxYear || "").match(/\d{4}/)?.[0] || 0);
  const priorYear = taxYear ? String(taxYear - 1) : "";
  const currentYear = taxYear ? String(taxYear) : "";
  const name = String(file.name || "").toLowerCase();
  const text = String(file.text || "").slice(0, 12000).toLowerCase();
  const joined = `${name}\n${text}`;
  const hasWorkbookTemplate = Boolean(file.workbookTemplate?.sheets?.length || (Array.isArray(file.workbookTemplates) && file.workbookTemplates.some((template) => template?.sheets?.length)));

  // True when the file name explicitly references prior year but NOT current year
  // e.g. "workpaper 2024.xlsx" or "P&L 2024.pdf" when tax year is 2025
  const isPriorYearByName = Boolean(priorYear && name.includes(priorYear) && currentYear && !name.includes(currentYear));

  // 1. Excel with workpaper/template keywords → prior_workpaper
  // Note: use workpapers? to match both "workpaper" and "workpapers" (plural)
  if (hasWorkbookTemplate && /\b(templates?|workpapers?|work papers?|estimate|est tax|projection|safe harbor)\b/.test(joined)) {
    return {
      id: "prior_workpaper",
      description: "Prior-year workpaper/template: use for workbook structure, labels, sheet order, formatting, and prior adjustment categories only.",
    };
  }

  // 2. Any file (PDF or Excel) that has workpaper/template keywords AND prior year in name → prior_workpaper
  if (/\b(templates?|workpapers?|work papers?|safe harbor)\b/.test(joined) && isPriorYearByName) {
    return {
      id: "prior_workpaper",
      description: "Prior-year workpaper/template: use for workbook structure, labels, sheet order, formatting, and prior adjustment categories only.",
    };
  }

  // 2b. Source income/deduction documents (W-2/W-2C, 1099 series, composite broker
  // statements, 1098, SSA-1099, K-1 received) are CURRENT-year source documents whose
  // amounts must be extracted — never prior_return, even though their text mentions
  // schedules or "tax return" (run 66 bug: a ZIP of 2025 1099s was classified
  // prior_return and its interest/dividends were ignored entirely). Guard: a file whose
  // NAME says it is an actual tax return still falls through to rule 3.
  // NOTE: (?![a-z0-9]) instead of a trailing \b — underscores are word chars, so \b fails
  // on names like "1099_INT_Chase.pdf" ("int" is followed by "_"). The token check also
  // runs against the HEAD of the extracted text so a ZIP of 1099s (generic zip name, inner
  // filenames in the text) is caught — but only when the text head does not look like a
  // FILED return, which mentions W-2s/1099s yet must stay prior_return.
  const sourceDocTokenRe = /\b(w-?2c?|1099[-_\s]?(int|div|b|k|r|nec|misc|g|sa|q|composite)|consolidated\s+1099|composite\s+(statement|form)?\s*1099|1098|ssa-?1099|5498)(?![a-z0-9])/;
  const headLooksLikeFiledReturn = /(form\s*10(40|41|65|20)|form\s*1120-?s)[^\n]{0,80}(u\.s\.|income tax return|tax year)/i.test(text.slice(0, 6000));
  const looksLikeSourceDocs = sourceDocTokenRe.test(name)
    || (!headLooksLikeFiledReturn && (
      sourceDocTokenRe.test(text.slice(0, 6000))
      || /\b(w-?2c?|1099[-_\s]?(int|div|b|k|r|nec|misc|g|sa|q)|1098-?[a-z]?|ssa-?1099)(?![a-z0-9])[^\n]{0,80}\b(wages|interest income|dividends|proceeds|payer|recipient|gross amount|box\s*\d)/i.test(text.slice(0, 8000))
    ));
  const nameSaysTaxReturn = /\b(tax\s*returns?|form\s*10(40|41|65|20)|1120-?s|return transcript)\b/.test(name);
  if (looksLikeSourceDocs && !nameSaysTaxReturn) {
    return {
      id: "supporting_document",
      description: "Current-year source tax document (W-2 / 1099 / 1098 / K-1 / broker composite): extract every reportable amount from it for the return — wages, withholding, interest, dividends, capital gain transactions, etc.",
    };
  }

  // 3. Tax return (prior year) → prior_return
  if (/\b(form\s*(1040|1041|1065|1120|1120s|1120-s)|u\.s\.\s*(individual|income tax|corporation|partnership)|schedule\s+[a-z0-9-]+|tax return|return transcript)\b/.test(joined) && (!currentYear || !name.includes(currentYear) || name.includes(priorYear))) {
    return {
      id: "prior_return",
      description: "Prior-year tax return: use for beginning balances, carryforwards, depreciation/tax basis, prior tax positions, and prior-year support only.",
    };
  }

  // 4. Financial statement keywords — with year-based disambiguation
  if (/\b(profit\s*(and|&)?\s*loss|p&l|income statement|balance sheet|trial balance|general ledger|gl detail|financial statement|financial report|quickbooks|xero|sage|netsuite|freshbooks|zoho|wave)\b/.test(joined)) {
    // File name says prior year, not current year → prior-year reference (e.g. "P&L 2024.pdf" when preparing 2025)
    if (isPriorYearByName) {
      return {
        id: "prior_workpaper",
        description: "Prior-year financial statement: use for prior-year reference values, beginning balances, and workpaper structure only. All current-year amounts must come from current-year financial files.",
      };
    }
    // Not an Excel workbook → must be a PDF/text financial export → current-year source
    if (!hasWorkbookTemplate) {
      return {
        id: "current_financials",
        description: "Current-year financials: source of truth for all current-year P&L, balance sheet, trial balance, and GL amounts.",
      };
    }
    // Excel file with financial content: current_financials when the current year is in
    // the name — or, when the NAME has no year at all, when the CONTENT carries it (QBO/
    // Xero exports print the period in the header: "January - December, 2025"). Run 69
    // bug: "Activa LLC_Profit and Loss (1).xlsx" (current-year P&L, year-less name) fell
    // through to prior_workpaper and had every amount stripped.
    if (currentYear && name.includes(currentYear)) {
      return {
        id: "current_financials",
        description: "Current-year financials: source of truth for all current-year P&L, balance sheet, trial balance, and GL amounts.",
      };
    }
    const nameHasAnyYear = /\b(19|20)\d{2}\b/.test(name);
    if (!nameHasAnyYear && currentYear && text.includes(currentYear)) {
      return {
        id: "current_financials",
        description: "Current-year financials (year detected in the report header): source of truth for all current-year P&L, balance sheet, trial balance, and GL amounts.",
      };
    }
    // Excel file with financial content but no clear current-year indicator → safer to treat as prior reference
  }

  // 5. Excel workbook fallback → prior_workpaper
  if (hasWorkbookTemplate) {
    return {
      id: "prior_workpaper",
      description: "Workbook/template file: use structure and prior-year categories only unless user explicitly says otherwise.",
    };
  }

  return {
    id: "supporting_document",
    description: "Supporting document: use only for values or context directly supported by the file.",
  };
}

function normalizeEntryGuide(parsed, fallback) {
  const guide = parsed && typeof parsed === "object" ? parsed : {};
  const screens = Array.isArray(guide.screens) ? guide.screens : buildEntryGuideScreensFromRows(guide.rows || guide.fields || guide.entries, fallback);
  let nextScreenNumber = 1;
  const normalizedScreens = screens.map((screen) => {
    let screenNumber = Number(screen.screenNumber || 0);
    if (!screenNumber) screenNumber = nextScreenNumber;
    nextScreenNumber = Math.max(nextScreenNumber, screenNumber + 1);
    const fields = Array.isArray(screen.fields) ? screen.fields.map((field, index) => ({
      fieldNumber: Number(field.fieldNumber || index + 1),
      fieldName: String(field.fieldName || field.field || "Field"),
      fieldDescription: String(field.fieldDescription || ""),
      lineReference: field.lineReference ? String(field.lineReference) : "",
      // Coalesce across the amount keys the model uses inconsistently (value / amount), and
      // treat an empty string as absent — otherwise a field with value:"" and amount:1542.31
      // would show a blank amount, because ?? only falls through on null/undefined, not "".
      value: formatEntryGuideValue(firstNonEmptyValue(field.value, field.amount, field.enteredValue), field.dataType),
      valueSource: String(field.valueSource || field.amountSource || "Workpaper data"),
      tieOutStatus: field.tieOutStatus ? String(field.tieOutStatus) : "",
      status: normalizeEntryStatus(field.status),
      statusNote: field.statusNote ? String(field.statusNote) : null,
      dataType: String(field.dataType || "text"),
      reviewIssueRef: field.reviewIssueRef ? String(field.reviewIssueRef) : null,
    })) : [];
    return {
      screenNumber,
      screenPath: String(screen.screenPath || `Section ${screenNumber}`),
      screenDescription: String(screen.screenDescription || ""),
      softwareNavigation: String(screen.softwareNavigation || screen.screenPath || `Refer to ${softwareDisplayName(fallback.taxSoftware)} input screens`),
      fields,
      screenNotes: screen.screenNotes ? String(screen.screenNotes) : null,
    };
  }).sort((a, b) => a.screenNumber - b.screenNumber);

  const allFields = normalizedScreens.flatMap((screen) => screen.fields);
  return {
    returnType: String(guide.returnType || fallback.returnType || ""),
    taxYear: String(guide.taxYear || fallback.taxYear || ""),
    software: String(guide.software || softwareDisplayName(fallback.taxSoftware)),
    clientName: String(guide.clientName || fallback.clientName || ""),
    ein: String(guide.ein || fallback.ein || ""),
    generatedAt: guide.generatedAt || new Date().toISOString(),
    totalFields: Number(guide.totalFields || allFields.length),
    fieldsNeedingDecision: Number(guide.fieldsNeedingDecision || allFields.filter((field) => field.status === "decision_needed").length),
    fieldsFromReviewIssues: Number(guide.fieldsFromReviewIssues || allFields.filter((field) => field.status === "review_issue").length),
    allTiesOut: Boolean(guide.allTiesOut || guide.validationSummary?.allTiesOut || false),
    tieOutChecks: normalizeTieOutChecks(guide.tieOutChecks || guide.validationChecks || guide.tieOuts || []),
    completenessFlags: Array.isArray(guide.completenessFlags) ? guide.completenessFlags.map((item) => String(item)).filter(Boolean) : [],
    screens: normalizedScreens,
    decisionItems: Array.isArray(guide.decisionItems) ? guide.decisionItems : [],
    reviewIssueFields: Array.isArray(guide.reviewIssueFields) ? guide.reviewIssueFields : [],
    entryOrder: String(guide.entryOrder || "Enter fields in screen number order from top to bottom."),
    estimatedEntryTime: String(guide.estimatedEntryTime || "30-60 minutes"),
  };
}

function buildEntryGuideScreensFromRows(rows, fallback = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const grouped = new Map();
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const screen = String(row.screen || row.proConnectScreen || row.softwareScreen || row.screenPath || "Tax Software Inputs");
    const section = String(row.section || row.softwareSection || "").trim();
    const screenPath = section ? `${screen} > ${section}` : screen;
    if (!grouped.has(screenPath)) {
      grouped.set(screenPath, {
        screenNumber: grouped.size + 1,
        screenPath,
        screenDescription: String(row.description || row.screenDescription || ""),
        softwareNavigation: String(row.navigation || row.softwareNavigation || row.path || screenPath || `Refer to ${softwareDisplayName(fallback.taxSoftware)} input screens`),
        fields: [],
        screenNotes: "",
      });
    }
    const group = grouped.get(screenPath);
    group.fields.push({
      fieldNumber: group.fields.length + 1,
      fieldName: String(row.field || row.fieldName || row.label || `Field ${index + 1}`),
      fieldDescription: String(row.fieldDescription || row.description || ""),
      lineReference: String(row.lineReference || row.formLine || row.formLineReference || ""),
      value: row.amount ?? row.value ?? "",
      valueSource: String(row.amountSource || row.valueSource || row.source || "Workpaper data"),
      tieOutStatus: String(row.tieOutStatus || row.status || ""),
      status: normalizeEntryStatus(row.entryStatus || row.status),
      statusNote: String(row.statusNote || row.note || ""),
      dataType: String(row.dataType || inferEntryDataType(row.amount ?? row.value)),
      reviewIssueRef: row.reviewIssueRef ? String(row.reviewIssueRef) : null,
    });
  });
  return [...grouped.values()];
}

function normalizeTieOutChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.map((check) => ({
    check: String(check.check || check.name || check.label || "Tie-out check"),
    guideAmount: check.guideAmount ?? check.workpaperAmount ?? check.entryGuideAmount ?? "",
    financialAmount: check.financialAmount ?? check.sourceAmount ?? "",
    difference: check.difference ?? "",
    status: String(check.status || "").toUpperCase().includes("OK") || String(check.status || "").toUpperCase().includes("PASS") ? "OK" : "NEEDS_REVIEW",
    note: String(check.note || check.notes || ""),
  })).filter((check) => check.check);
}

function normalizeOrBuildEntryGuide(parsed, workbook, payload) {
  const metadata = payload.metadata || {};
  const fallback = {
    ...payload,
    returnType: metadata.returnType || payload.returnType || "",
    taxYear: metadata.taxYear || payload.taxYear || "",
    taxSoftware: metadata.taxSoftware || payload.taxSoftware || "proconnect",
    clientName: metadata.clientName || metadata.entityName || payload.clientName || payload.entityName || "",
    ein: metadata.ein || payload.ein || "",
  };
  const rawGuide = parsed?.entryGuide || parsed?.dataEntryGuide || parsed?.taxSoftwareEntryGuide || {};
  let guide = normalizeEntryGuide(rawGuide, fallback);
  if (!guide.screens.length || Number(guide.totalFields || 0) === 0) {
    guide = buildFallbackEntryGuideFromWorkbook(workbook, fallback);
  }
  return guide;
}

// Links the Data Entry Guide amounts to the M-1 reconciliation by formula, so editing a
// number in the M-1 flows into the entry guide. SAFE by construction: only links a value
// that matches EXACTLY ONE cell in the M-1 (unique match), skips 0/tiny amounts, and leaves
// everything else static — an ambiguous or missing match never produces a broken reference.
// linkEntryGuideToWorkpaper and canonicalizeWorkbookSheets live in lib/workbook-postprocess.js
// so they can be unit-tested without loading the server.

// Adds one verbatim tab per sheet of every uploaded spreadsheet (P&L, Balance Sheet,
// asset reports, prior-year workpaper, etc.). The client already parses each xlsx into
// workbookTemplate(s) = { sourceFileName, sheets:[{ name, rows }] }, so we reuse those
// exact rows. Tabs are marked verbatim so the styled generator formats them but never
// injects formulas or rewrites a number inside the client's original report.
function appendSourceReportSheets(workbook, files) {
  if (!workbook || !Array.isArray(workbook.sheets)) return workbook;
  const MAX_SOURCE_SHEETS = 40;
  let added = 0;
  for (const file of Array.isArray(files) ? files : []) {
    const templates = [file?.workbookTemplate, ...(Array.isArray(file?.workbookTemplates) ? file.workbookTemplates : [])]
      .filter((t) => t && Array.isArray(t.sheets) && t.sheets.length);
    if (!templates.length) continue;
    const fileBase = String(file?.name || templates[0].sourceFileName || "Source")
      .replace(/\.[a-z0-9]+$/i, "").trim() || "Source";
    for (const template of templates) {
      const sheets = template.sheets.filter((s) => Array.isArray(s.rows) && s.rows.some((row) => (row || []).some((c) => String(c ?? "").trim())));
      const multi = sheets.length > 1;
      for (const s of sheets) {
        if (added >= MAX_SOURCE_SHEETS) return workbook;
        const label = multi ? `${fileBase} - ${s.name || ""}`.trim() : (fileBase || s.name || "Source");
        workbook.sheets.push({
          name: String(label).slice(0, 31),
          rows: normalizeRows(s.rows),
          styles: [],
          verbatim: true,
        });
        added += 1;
      }
    }
  }
  return workbook;
}

function appendEntryGuideSheetToWorkbook(workbook, guide) {
  if (!workbook || !Array.isArray(workbook.sheets) || !guide) return workbook;
  const guideSheet = buildEntryGuideWorkbookSheet(guide);
  workbook.sheets = workbook.sheets.filter((sheet) => {
    const name = String(sheet?.name || "").trim().toLowerCase();
    return name !== "data entry guide" && name !== "proconnect entry guide";
  });
  workbook.sheets.push(guideSheet);
  if (Array.isArray(workbook.aiNotes)) {
    workbook.aiNotes.push(`${guide.software || "Tax software"} data entry guide included in the workbook with ${guide.totalFields || 0} mapped field(s).`);
  }
  return workbook;
}

function buildEntryGuideWorkbookSheet(guideData) {
  const guide = normalizeEntryGuide(guideData, guideData || {});
  const tieOutChecks = Array.isArray(guide.tieOutChecks) ? guide.tieOutChecks : [];
  const completenessFlags = Array.isArray(guide.completenessFlags) ? guide.completenessFlags : [];
  const validationOk = tieOutChecks.length && tieOutChecks.every((check) => String(check.status || "").toUpperCase() === "OK") && !completenessFlags.length;
  const rows = [
    [`${guide.software || "Tax Software"} - Data Entry Guide`, "", "", "", "", "", ""],
    [`${guide.clientName || "Client"} | EIN: ${guide.ein || "Not provided"} | Form ${guide.returnType || ""} | TY ${guide.taxYear || ""}`, "", "", "", "", "", ""],
    [`Validation summary: ${validationOk ? "ALL PRIMARY TIE-OUTS OK" : "NEEDS REVIEW"} | Total fields: ${guide.totalFields || 0} | Ready: ${countGuideStatus(guide, "ready")} | Decision needed: ${guide.fieldsNeedingDecision || 0} | Verify: ${countGuideStatus(guide, "verify")} | Review issues: ${guide.fieldsFromReviewIssues || 0}`, "", "", "", "", "", ""],
    [guide.entryOrder || "Enter fields in screen number order from top to bottom.", "", "", "", "", "", ""],
    [""],
    ["TIE-OUT CHECKS", "", "", "", "", "", ""],
    ["Check", "Guide Amount", "Financial Amount", "Difference", "Status", "Note", ""],
  ];

  if (tieOutChecks.length) {
    for (const check of tieOutChecks) {
      rows.push([
        check.check || "",
        check.guideAmount ?? "",
        check.financialAmount ?? "",
        check.difference ?? "",
        check.status || "NEEDS_REVIEW",
        check.note || "",
        "",
      ]);
    }
  } else {
    rows.push(["No tie-out checks were returned. Review generated workpaper manually against current-year financials.", "", "", "", "NEEDS_REVIEW", "", ""]);
  }

  if (completenessFlags.length) {
    rows.push([""], ["COMPLETENESS FLAGS", "", "", "", "", "", ""], ["Flag", "", "", "", "", "", ""]);
    completenessFlags.forEach((flag) => rows.push([flag, "", "", "", "", "", ""]));
  }

  rows.push(
    [""],
    ["DATA ENTRY FIELDS", "", "", "", "", "", ""],
    ["#", `${guide.software || "Tax Software"} Screen > Section > Field`, "Form Line", "Amount", "Source", "Tie-Out Status", "Done"]
  );

  let fieldNum = 1;
  for (const screen of guide.screens || []) {
    rows.push([`Screen ${screen.screenNumber || ""}: ${screen.screenPath || "Input screen"}`, screen.screenDescription || "", screen.softwareNavigation || "", "", "", screen.screenNotes || ""]);
    for (const field of screen.fields || []) {
      rows.push([
        fieldNum++,
        [screen.screenPath, field.fieldName].filter(Boolean).join(" > "),
        field.lineReference || field.fieldDescription || "",
        field.value ?? "",
        field.valueSource || "",
        field.tieOutStatus || entryGuideStatusText(field.status),
        "",
      ]);
    }
    rows.push([""]);
  }

  if ((guide.decisionItems || []).length) {
    rows.push([""], ["DECISION ITEMS - Preparer Action Required", "", "", "", "", "", "", ""], ["Screen", "Field", "Question", "Options", "Impact if Wrong", "", "", ""]);
    for (const item of guide.decisionItems) {
      rows.push([String(item.screen || ""), String(item.field || ""), String(item.question || ""), Array.isArray(item.options) ? item.options.join("; ") : String(item.options || ""), String(item.impactIfWrong || ""), "", "", ""]);
    }
  }

  if ((guide.reviewIssueFields || []).length) {
    rows.push([""], ["REVIEW ISSUES AFFECTING DATA ENTRY", "", "", "", "", "", "", ""], ["Screen", "Field", "Issue Description", "Blocks Entry", "", "", "", ""]);
    for (const item of guide.reviewIssueFields) {
      rows.push([String(item.screen || ""), String(item.field || ""), String(item.issue || ""), item.blocksEntry ? "Yes" : "No", "", "", "", ""]);
    }
  }

  return {
    name: "Data Entry Guide",
    rows,
    merges: [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } },
      { s: { r: 3, c: 0 }, e: { r: 3, c: 6 } },
    ],
    cols: [{ wch: 6 }, { wch: 46 }, { wch: 18 }, { wch: 18 }, { wch: 34 }, { wch: 18 }, { wch: 12 }],
    styles: [
      { r: 0, c: 0, bold: true, underline: true },
      { r: 2, c: 0, bold: true, fill: validationOk ? "DCFCE7" : "FEE2E2", border: true },
      { r: 5, c: 0, bold: true, fill: "EAF2FF", border: true },
      { r: 6, c: 0, bold: true, fill: "EAF2FF", border: true },
      { r: 6, c: 1, bold: true, fill: "EAF2FF", border: true },
      { r: 6, c: 2, bold: true, fill: "EAF2FF", border: true },
      { r: 6, c: 3, bold: true, fill: "EAF2FF", border: true },
      { r: 6, c: 4, bold: true, fill: "EAF2FF", border: true },
      { r: 6, c: 5, bold: true, fill: "EAF2FF", border: true },
    ],
  };
}

function buildFallbackEntryGuideFromWorkbook(workbook, fallback) {
  const software = taxSoftwareById(fallback.taxSoftware);
  const softwareName = softwareDisplayName(fallback.taxSoftware);
  const candidates = extractEntryGuideCandidates(workbook);
  const grouped = new Map();
  for (const item of candidates.slice(0, 80)) {
    const mapping = inferEntryGuideMapping(item.label, software, fallback.returnType);
    const key = mapping.screenPath;
    if (!grouped.has(key)) grouped.set(key, { mapping, fields: [] });
    grouped.get(key).fields.push({
      fieldNumber: grouped.get(key).fields.length + 1,
      fieldName: item.label,
      fieldDescription: `Enter or verify ${item.label}.`,
      value: item.value,
      valueSource: item.source,
      status: item.value ? "ready" : "verify",
      statusNote: item.value ? "Mapped from generated workpaper because Claude did not return a complete entryGuide object." : "Value was blank in the workpaper; verify source support before entry.",
      dataType: inferEntryDataType(item.value),
      reviewIssueRef: null,
    });
  }
  const screens = [...grouped.values()].map((group, index) => ({
    screenNumber: index + 1,
    screenPath: group.mapping.screenPath,
    screenDescription: group.mapping.description,
    softwareNavigation: group.mapping.softwareNavigation,
    fields: group.fields,
    screenNotes: "Fallback guide generated from workbook rows. Review against source files before entry.",
  }));
  return normalizeEntryGuide({
    returnType: fallback.returnType,
    taxYear: fallback.taxYear,
    software: softwareName,
    clientName: fallback.clientName,
    ein: fallback.ein,
    generatedAt: new Date().toISOString(),
    screens,
    entryOrder: `Follow the ${softwareName} navigation paths in screen order. Verify any fallback-mapped fields against the source files.`,
    estimatedEntryTime: screens.length ? "30-60 minutes" : "Unable to estimate",
  }, fallback);
}

function extractEntryGuideCandidates(workbook) {
  const candidates = [];
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  for (const sheet of sheets) {
    const sheetName = String(sheet.name || "Workpaper");
    if (/ai notes|entry guide/i.test(sheetName)) continue;
    const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const cells = row.map((cell) => String(cell ?? "").trim());
      const nonEmpty = cells.filter(Boolean);
      if (nonEmpty.length < 2) continue;
      const labelIndex = cells.findIndex((cell) => /[A-Za-z]/.test(cell) && !/^\$?-?\d[\d,]*(\.\d+)?%?$/.test(cell));
      const valueIndex = cells.findLastIndex((cell, index) => index !== labelIndex && looksLikeEntryValue(cell));
      if (labelIndex < 0 || valueIndex < 0) continue;
      const label = cells[labelIndex].replace(/\s+/g, " ").slice(0, 120);
      if (!label || /total fields|screen|source|status|notes/i.test(label)) continue;
      candidates.push({ label, value: cells[valueIndex], source: `${sheetName} row ${rows.indexOf(row) + 1}` });
    }
  }
  return candidates;
}

function looksLikeEntryValue(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^\$?-?\(?\d[\d,]*(\.\d+)?\)?%?$/.test(text)) return true;
  return /^(yes|no|true|false|cash|accrual|initial|final)$/i.test(text);
}

function inferEntryGuideMapping(label, software, returnType) {
  const paths = software?.commonScreenPaths || {};
  const text = String(label || "").toLowerCase();
  let key = "otherDeductions";
  let description = "General tax software input";
  if (/client|name|ein|address|entity/.test(text)) { key = "clientInfo"; description = "Client and entity information"; }
  else if (/gross receipt|sales|revenue|income/.test(text)) { key = "grossReceipts"; description = "Income entry"; }
  else if (/cost of goods|cogs|inventory/.test(text)) { key = "cogs"; description = "Cost of goods sold"; }
  else if (/officer|compensation/.test(text)) { key = "officerComp"; description = "Officer compensation"; }
  else if (/depreciation|amortization|4562/.test(text)) { key = "depreciation"; description = "Depreciation and amortization"; }
  else if (/balance sheet|asset|liabilit|equity|schedule l/.test(text)) { key = "scheduleL"; description = "Schedule L balance sheet"; }
  else if (/m-1|m1|book.?to.?tax|tax adjustment|addback|reconciliation/.test(text)) { key = "scheduleM1"; description = "Book-to-tax reconciliation"; }
  else if (/m-3|m3/.test(text)) { key = "scheduleM3"; description = "Schedule M-3 reconciliation"; }
  else if (/payment|estimated|withholding|tax due|refund/.test(text)) { key = "efiling"; description = "Tax payments and filing information"; }
  else if (/state|apportion|franchise/.test(text)) { key = "stateReturn"; description = "State return input"; }
  else if (/interest|dividend|investment/.test(text)) { key = "investments"; description = "Investment income"; }
  else if (/capital|gain|loss|sale|disposition/.test(text)) { key = "dispositions"; description = "Dispositions and gains/losses"; }
  const screenPath = paths[key] || `${returnType || "Return"} > ${description}`;
  return {
    screenPath,
    description,
    softwareNavigation: software?.screenTerminology?.navigate
      ? software.screenTerminology.navigate.replace(/\[Screen\]/g, screenPath).replace(/\[Screen name\]/g, screenPath).replace(/\[Form name\]/g, screenPath).replace(/\[N\]/g, "").replace(/\[CODE\]/g, screenPath).replace(/\[Field\]/g, label)
      : `Go to ${screenPath}`,
  };
}

function inferEntryDataType(value) {
  const text = String(value || "").trim();
  if (/^\$?-?\(?\d[\d,]*(\.\d+)?\)?$/.test(text)) return "currency";
  if (/^-?\d+(\.\d+)?%$/.test(text)) return "percentage";
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) return "date";
  if (/^(yes|no|true|false)$/i.test(text)) return "checkbox";
  return "text";
}

function countGuideStatus(guide, status) {
  return (guide.screens || []).reduce((sum, screen) => sum + (screen.fields || []).filter((field) => field.status === status).length, 0);
}

function entryGuideStatusText(status) {
  const labels = {
    ready: "READY",
    decision_needed: "DECISION",
    verify: "VERIFY",
    review_issue: "REVIEW ISSUE",
    not_applicable: "N/A",
  };
  return labels[normalizeEntryStatus(status)] || "READY";
}

function normalizeEntryStatus(status) {
  const normalized = String(status || "ready").toLowerCase().replace(/[\s-]+/g, "_");
  return ["ready", "decision_needed", "verify", "review_issue", "not_applicable"].includes(normalized) ? normalized : "ready";
}

// Returns the first argument that is neither null/undefined nor an empty/whitespace string.
// Preserves the ORIGINAL type (numbers stay numbers) so formatEntryGuideValue can format
// currency/percentage correctly. Falls back to "" when every candidate is empty.
function firstNonEmptyValue(...candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    if (typeof candidate === "string" && candidate.trim() === "") continue;
    return candidate;
  }
  return "";
}

function formatEntryGuideValue(value, dataType) {
  if (value === null || value === undefined) return "";
  const type = String(dataType || "").toLowerCase();
  if (type === "checkbox" && typeof value === "boolean") return value ? "Yes" : "No";
  if (type === "currency" && typeof value === "number") return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
  if (type === "percentage" && typeof value === "number") return `${value.toFixed(2)}%`;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function buildNoticeSystemPrompt() {
  return [
    "You are a senior US tax attorney and CPA specializing in IRS and state tax notice analysis and response drafting. You have deep knowledge of all IRS notice types, CP series notices, audit letters, state tax authority notices, collection notices, and the correct procedural response for each.",
    "",
    "Your job is to:",
    "1. Identify the notice type, issuing authority, tax year, and amount at issue",
    "2. Determine the deadline for response â€” state the exact date if visible, or calculate from notice date",
    "3. Analyze whether the notice appears correct, incorrect, or partially incorrect based on the documents provided",
    "4. Draft a complete, professional response letter ready to send on CPA firm letterhead",
    "5. List the enclosures the response letter should include",
    "6. Flag any immediate action required (e.g., stop collection, request CAF authorization, etc.)",
    "",
    "NOTICE CATEGORIES YOU MUST HANDLE:",
    "- CP2000 (Underreporter inquiry) â€” do NOT recommend amending; recommend a response letter with explanation",
    "- CP501/CP503/CP504 (Balance due notices) â€” verify balance, check payments, recommend payment plan if applicable",
    "- CP11/CP12 (Math error) â€” verify the IRS calculation; if incorrect, draft protest",
    "- Audit letters (Letter 2205, Letter 531, Notice of Examination) â€” draft initial response, request for extension if needed",
    "- Lien/Levy notices (LT11, CP90) â€” flag as URGENT; immediate action required",
    "- State notices â€” identify state, apply state-specific procedures",
    "- FBAR/international notices â€” flag for specialist review",
    "",
    "OUTPUT FORMAT â€” respond ONLY with valid JSON inside ```json fences:",
    '{"noticeType":"string â€” e.g. CP2000, Letter 531, State audit","issuingAuthority":"IRS / [State] Department of Revenue / etc.","taxYearAtIssue":"YYYY","amountAtIssue":"string â€” dollar amount or Not stated","responseDeadline":"string â€” exact date or XX days from notice date","urgencyLevel":"CRITICAL / HIGH / MEDIUM / LOW","summary":"string â€” 2-3 sentence plain-English summary of what the notice is about","analysis":"string â€” is the notice correct, incorrect, or partially incorrect? explain","immediateActions":["string","string"],"responseLetter":"string â€” complete draft letter, ready for CPA letterhead","enclosures":["string","string"],"internalNotes":"string â€” notes for the preparer, not for the client","deadlineWarning":"string â€” if deadline is within 30 days, say so explicitly"}',
  ].join("\n");
}

function buildNoticeContent(payload) {
  const content = [{
    type: "text",
    text: [
      "Analyze the uploaded tax notice using the system instructions.",
      `State selection: ${payload.state || "Federal / IRS"}`,
      `Client facts / context: ${payload.clientFacts || "None provided"}`,
    ].join("\n"),
  }];
  addNoticeFileContent(content, payload.noticeFile, "NOTICE DOCUMENT");
  if (payload.priorReturn?.content) addNoticeFileContent(content, payload.priorReturn, "PRIOR YEAR RETURN / SUPPORTING DOCUMENT");
  return content;
}

function addNoticeFileContent(content, file, label) {
  const mediaType = String(file.type || "").toLowerCase();
  if (mediaType === "application/pdf") {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: file.content },
      title: file.name || label,
      context: label,
    });
    return;
  }
  if (mediaType.startsWith("image/")) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: file.content },
    });
    return;
  }
  content.push({
    type: "text",
    text: [`=== ${label}: ${file.name || "uploaded file"} ===`, file.content || ""].join("\n\n"),
  });
}

function buildOrganizerSystemPrompt() {
  return [
    "You are a senior CPA preparing a personalized tax organizer for a client. You have analyzed the client's prior year tax return and you know exactly what information they needed last year. Your job is to generate a personalized, specific organizer for the upcoming tax year - NOT a generic checklist, but one tailored to this specific client's situation.",
    "",
    "RULES:",
    "- Every question must be specific to THIS client's situation based on the prior year return",
    "- Group questions by category (Income, Deductions, Balance Sheet changes, etc.)",
    "- For each item the client reported last year, ask if the same item applies this year and request updated amounts/documentation",
    "- Add new questions for items that commonly arise year over year (e.g., if they had a rental property, ask about rental income AND any improvements, repairs, new leases)",
    "- Flag any items from the prior year that require special attention (e.g., installment sales, carryforwards, depreciation recapture potential)",
    "- Use plain English - no tax jargon without explanation in parentheses",
    "- For each question, specify exactly what document to provide (W-2, 1099, bank statement, etc.)",
    "",
    "OUTPUT FORMAT - respond ONLY with valid JSON inside ```json fences:",
    '{"clientName":"string","taxYear":"string","returnType":"string","organizerTitle":"string","sections":[{"sectionName":"string","sectionDescription":"string","questions":[{"id":"string","question":"string","context":"string - why we are asking (e.g., You reported rental income of $XX,XXX last year)","documentRequired":"string - e.g., Form 1099-MISC from [payer name]","priority":"required | recommended | optional","priorYearAmount":"string or null","answerType":"yes_no | amount | document | text | yes_no_with_amount"}]}],"carryforwardItems":[{"item":"string","priorYearAmount":"string","note":"string"}],"specialAttentionItems":["string"],"deadlineReminders":["string"]}',
  ].join("\n");
}

function buildOrganizerContent(payload) {
  const content = [{
    type: "text",
    text: [
      "Generate a personalized client tax organizer using the prior year return.",
      `Client name: ${payload.clientName || "Not provided"}`,
      `Return type: ${payload.returnType || "Not provided"}`,
      `New tax year being organized: ${payload.taxYear || "Not provided"}`,
      `Entity type: ${payload.entityType || "Not provided"}`,
      `Additional context: ${payload.additionalContext || "None"}`,
    ].join("\n"),
  }];
  addOrganizerFileContent(content, payload.priorYearReturn, "PRIOR YEAR RETURN");
  return content;
}

function addOrganizerFileContent(content, file, label) {
  const mediaType = String(file.type || file.mediaType || "").toLowerCase();
  if (mediaType === "application/pdf" && file.encoding === "base64") {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: file.content },
      title: file.name || label,
      context: label,
    });
    return;
  }
  if (mediaType.startsWith("image/") && file.encoding === "base64") {
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: file.content },
    });
    return;
  }
  content.push({
    type: "text",
    text: [`=== ${label}: ${file.name || "uploaded file"} ===`, file.content || ""].join("\n\n"),
  });
}

function normalizeOrganizer(parsed, raw, payload = {}) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const sections = Array.isArray(source.sections) ? source.sections.map((section, sectionIndex) => ({
    sectionName: String(section.sectionName || `Section ${sectionIndex + 1}`),
    sectionDescription: String(section.sectionDescription || ""),
    questions: Array.isArray(section.questions) ? section.questions.map((question, questionIndex) => ({
      id: String(question.id || `q-${sectionIndex + 1}-${questionIndex + 1}`),
      question: String(question.question || ""),
      context: String(question.context || ""),
      documentRequired: String(question.documentRequired || ""),
      priority: normalizeOrganizerPriority(question.priority),
      priorYearAmount: question.priorYearAmount === null || question.priorYearAmount === undefined ? null : String(question.priorYearAmount),
      answerType: normalizeOrganizerAnswerType(question.answerType),
    })).filter((question) => question.question) : [],
  })).filter((section) => section.questions.length) : [];

  if (!sections.length) {
    sections.push({
      sectionName: "Organizer",
      sectionDescription: "Claude did not return structured organizer sections.",
      questions: [{
        id: "q-1",
        question: String(raw || "No organizer content returned."),
        context: "",
        documentRequired: "",
        priority: "recommended",
        priorYearAmount: null,
        answerType: "text",
      }],
    });
  }

  return {
    clientName: String(source.clientName || payload.clientName || ""),
    taxYear: String(source.taxYear || payload.taxYear || ""),
    returnType: String(source.returnType || payload.returnType || ""),
    organizerTitle: String(source.organizerTitle || `Tax Organizer - ${payload.clientName || "Client"} - Tax Year ${payload.taxYear || ""}`),
    sections,
    carryforwardItems: Array.isArray(source.carryforwardItems) ? source.carryforwardItems.map((item) => ({
      item: String(item.item || ""),
      priorYearAmount: String(item.priorYearAmount || ""),
      note: String(item.note || ""),
    })).filter((item) => item.item) : [],
    specialAttentionItems: Array.isArray(source.specialAttentionItems) ? source.specialAttentionItems.map((item) => String(item || "")).filter(Boolean) : [],
    deadlineReminders: Array.isArray(source.deadlineReminders) ? source.deadlineReminders.map((item) => String(item || "")).filter(Boolean) : [],
  };
}

function normalizeOrganizerPriority(value) {
  const priority = String(value || "").toLowerCase();
  if (["required", "recommended", "optional"].includes(priority)) return priority;
  return "recommended";
}

function normalizeOrganizerAnswerType(value) {
  const answerType = String(value || "").toLowerCase();
  if (["yes_no", "amount", "document", "text", "yes_no_with_amount"].includes(answerType)) return answerType;
  return "text";
}

function buildDeliverableSystemPrompt() {
  return [
    "You are a senior US tax CPA preparing client-facing deliverables after an internal senior tax review.",
    "Your job is to convert the review findings into plain-English, professional client communications.",
    "Use the review result as the authoritative source for tax review status and open items. Use notice analysis only when provided.",
    "Do not invent filing status, balances, deadlines, attachments, or client facts. If something is missing, state Not provided or include it as a checklist item.",
    "Use firm information exactly as provided.",
    "Transmittal letters must be suitable for firm letterhead, addressed to the client, and ready to send after minor editing.",
    "Client action checklist items must be concrete, understandable, and limited to what the client or preparer needs to provide or approve.",
    "Email drafts must be concise, client-friendly, and must not include internal-only notes.",
    "Return ONLY valid JSON inside ```json``` fences. No prose outside JSON.",
    "",
    "Required JSON schema:",
    '{"transmittalLetter":"string","clientActionChecklist":[{"item":"string","reason":"string","howToProvide":"string","urgency":"HIGH|MEDIUM|LOW"}],"emailDraft":{"subject":"string","body":"string"},"filingReadiness":"READY | NOT_READY | READY_WITH_CONDITIONS","filingReadinessReason":"string","balanceDueOrRefund":"string","filingDeadline":"string","enclosureList":["string"]}',
  ].join("\n");
}

function buildDeliverableContent(payload) {
  const content = [{
    type: "text",
    text: [
      "Create the requested client deliverable from the review data.",
      `Requested deliverable type: ${payload.deliverableType || "all"}`,
      `Client name: ${payload.clientName || "Not provided"}`,
      `Preparer name: ${payload.preparerName || "Not provided"}`,
      `Firm name: ${payload.firmName || "Not provided"}`,
      `Firm address: ${payload.firmAddress || "Not provided"}`,
      `Firm phone: ${payload.firmPhone || "Not provided"}`,
      `Firm email: ${payload.firmEmail || "Not provided"}`,
      `Recipient name: ${payload.recipientName || payload.clientName || "Not provided"}`,
      `Recipient email: ${payload.recipientEmail || "Not provided"}`,
      `Email tone: ${payload.emailTone || "formal"}`,
      `Custom instructions: ${payload.customInstructions || "None"}`,
      "",
      "CLIENT-SIDE FILING READINESS DERIVATION:",
      `Filing readiness: ${payload.derivedFilingReadiness || "Not provided"}`,
      `Filing readiness reason: ${payload.derivedFilingReadinessReason || "Not provided"}`,
      "",
      "SENIOR REVIEW RESULT JSON:",
      JSON.stringify(payload.reviewResult || {}, null, 2),
      "",
      "NOTICE ANALYSIS JSON, IF ANY:",
      JSON.stringify(payload.noticeResult || null, null, 2),
      "",
      "CLIENT ORGANIZER JSON, IF ANY:",
      JSON.stringify(payload.organizerResult || null, null, 2),
      "",
      "E-FILE DIAGNOSTICS JSON, IF ANY:",
      JSON.stringify(payload.diagnosticsResult || null, null, 2),
    ].join("\n"),
  }];
  return content;
}

function buildDeliverableDraftSystemPrompt() {
  return [
    "You are a senior CPA at a professional accounting firm writing a client email.",
    "You are attaching tax documents and communicating the status of the client's tax return preparation.",
    "Write a professional, clear email that addresses the client by name, explains what is attached, communicates filing status, states the filing deadline, and ends with a clear call to action.",
    "If READY, confirm it is ready for review/signature and state balance due or refund when provided.",
    "If NOT_READY, explain what is still needed in plain English as a numbered list.",
    "If READY_WITH_CONDITIONS, explain it is almost ready and list the conditions.",
    "Tone rules: formal uses conservative language; friendly is warm and professional; brief is 3-5 sentences maximum.",
    "Return ONLY valid JSON inside ```json``` fences.",
    '{"subject":"string","body":"string","bodyHtml":"string","keyPoints":["string"],"callToAction":"string","suggestedFollowUpDays":number}',
  ].join("\n");
}

function buildDeliverableDraftPrompt(payload) {
  return [
    "Generate a client email draft using this deliverable context.",
    "",
    "Client:",
    JSON.stringify(payload.client || {}, null, 2),
    "",
    "Preparer:",
    JSON.stringify(payload.preparer || {}, null, 2),
    "",
    "Attachments:",
    JSON.stringify(payload.attachments || [], null, 2),
    "",
    "Return / filing context:",
    JSON.stringify(payload.context || {}, null, 2),
    "",
    `Tone: ${payload.tone || "formal"}`,
  ].join("\n");
}

function normalizeEmailDraft(parsed, raw) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const body = String(source.body || raw || "");
  return {
    subject: String(source.subject || "Tax documents for your review"),
    body,
    bodyHtml: String(source.bodyHtml || plainTextToHtml(body)),
    keyPoints: Array.isArray(source.keyPoints) ? source.keyPoints.map((item) => String(item || "")).filter(Boolean) : [],
    callToAction: String(source.callToAction || ""),
    suggestedFollowUpDays: Number(source.suggestedFollowUpDays || 3),
  };
}

async function googleProfileEmail(username = "default") {
  const profile = await googleApiFetch("https://www.googleapis.com/oauth2/v2/userinfo", {}, username).then((r) => r.ok ? r.json() : {});
  return profile.email || null;
}

async function gmailAuthorizationStatus(username = "default") {
  const tokens = readGoogleTokens(username);
  if (!tokens || !isGoogleDriveEnabled()) return { authorized: false, email: null };
  const scopes = String(tokens.scope || "");
  const email = await googleProfileEmail(username).catch(() => null);
  if (!scopes.includes(GOOGLE_GMAIL_COMPOSE_SCOPE)) return { authorized: false, email };
  const profileRes = await googleApiFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {}, username).catch(() => ({ ok: false }));
  if (!profileRes.ok) return { authorized: true, email };
  const profile = await profileRes.json().catch(() => ({}));
  return { authorized: true, email: profile.emailAddress || email };
}

function buildMimeEmail(params) {
  const boundary = `boundary_${Date.now()}`;
  const alt = `alt_${boundary}`;
  const lines = [];
  lines.push(
    `To: ${params.to}`,
    `Subject: ${encodeMimeHeader(params.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`
  );
  if (params.cc) lines.splice(1, 0, `Cc: ${params.cc}`);
  lines.push(
    "",
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(params.bodyText || "", "utf8").toString("base64")),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(params.bodyHtml || plainTextToHtml(params.bodyText || ""), "utf8").toString("base64")),
    `--${alt}--`
  );
  for (const attachment of params.attachments || []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType || "application/octet-stream"}`,
      `Content-Disposition: attachment; filename="${String(attachment.name || "attachment").replace(/"/g, "")}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(String(attachment.contentBase64 || "").replace(/\s+/g, ""))
    );
  }
  lines.push(`--${boundary}--`);
  return lines.join("\r\n");
}

function wrapBase64(value) {
  return String(value || "").replace(/(.{76})/g, "$1\r\n");
}

function encodeMimeHeader(value) {
  const text = String(value || "");
  if (!/[^\x20-\x7E]/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function plainTextToHtml(text) {
  return String(text || "").split(/\n{2,}/).map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`).join("");
}

function htmlToPlainText(html) {
  return String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").trim();
}

function normalizeDeliverable(parsed, raw) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const checklist = Array.isArray(source.clientActionChecklist)
    ? source.clientActionChecklist.map((item) => ({
      item: String(item.item || item.action || ""),
      reason: String(item.reason || ""),
      howToProvide: String(item.howToProvide || item.how || ""),
      urgency: normalizeUrgency(item.urgency),
    })).filter((item) => item.item)
    : [];
  return {
    transmittalLetter: String(source.transmittalLetter || ""),
    clientActionChecklist: checklist,
    emailDraft: {
      subject: String(source.emailDraft?.subject || ""),
      body: String(source.emailDraft?.body || ""),
    },
    filingReadiness: normalizeFilingReadiness(source.filingReadiness),
    filingReadinessReason: String(source.filingReadinessReason || ""),
    balanceDueOrRefund: String(source.balanceDueOrRefund || "Not provided"),
    filingDeadline: String(source.filingDeadline || "Not provided"),
    enclosureList: Array.isArray(source.enclosureList) ? source.enclosureList.map((item) => String(item || "")).filter(Boolean) : [],
    raw: parsed ? "" : String(raw || ""),
  };
}

function normalizeUrgency(value) {
  const urgency = String(value || "").toUpperCase();
  if (["HIGH", "MEDIUM", "LOW"].includes(urgency)) return urgency;
  return "MEDIUM";
}

function normalizeFilingReadiness(value) {
  const readiness = String(value || "").toUpperCase().replace(/\s+/g, "_");
  if (["READY", "NOT_READY", "READY_WITH_CONDITIONS"].includes(readiness)) return readiness;
  return "READY_WITH_CONDITIONS";
}

function workbookCandidateFromParsed(parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const candidates = [
    source,
    source.workbook,
    source.excelWorkbook,
    source.workpaper,
    source.workpaperWorkbook,
    source.outputWorkbook,
    source.result,
    source.data,
  ].filter((candidate) => candidate && typeof candidate === "object");

  for (const candidate of candidates) {
    const sheets = workbookSheetsFromCandidate(candidate);
    if (sheets.some((sheet) => normalizeSheetRows(sheet).length)) return { ...candidate, sheets };
  }

  const directRows = normalizeSheetRows(source);
  if (directRows.length) {
    return {
      ...source,
      sheets: [{ name: source.sheetName || source.name || "Workpaper", rows: directRows }],
    };
  }

  return source;
}

function workbookSheetsFromCandidate(candidate) {
  const directKeys = ["sheets", "worksheets", "tabs", "workbookSheets", "excelSheets"];
  for (const key of directKeys) {
    if (Array.isArray(candidate?.[key]) && candidate[key].length) return candidate[key];
  }

  if (Array.isArray(candidate?.tables) && candidate.tables.length) {
    return candidate.tables.map((table, index) => ({
      ...table,
      name: table.name || table.title || table.sheetName || `Table ${index + 1}`,
      rows: normalizeSheetRows(table),
    }));
  }

  const sectionKeys = ["sections", "workpaperSections", "workbookSections"];
  for (const key of sectionKeys) {
    if (Array.isArray(candidate?.[key]) && candidate[key].length) {
      return candidate[key].map((section, index) => ({
        name: section.name || section.title || section.sectionName || `Section ${index + 1}`,
        rows: normalizeSectionRows(section),
      })).filter((sheet) => normalizeRows(sheet.rows).length);
    }
  }

  return [];
}

function normalizeSheetRows(sheet) {
  const rowKeys = ["rows", "data", "values", "tableRows", "lines", "items"];
  let rows = [];
  for (const key of rowKeys) {
    if (Array.isArray(sheet?.[key]) && sheet[key].length) {
      rows = normalizeRows(sheet[key]);
      break;
    }
  }

  if (!rows.length && Array.isArray(sheet?.sections)) {
    rows = normalizeSectionRows(sheet);
  }

  const columns = normalizeColumnHeaders(sheet?.columns || sheet?.headers || sheet?.fields);
  if (columns.length && rows.length && !rowLooksLikeHeader(rows[0], columns)) {
    rows = [columns, ...rows];
  }
  return rows;
}

function normalizeSectionRows(section) {
  const rows = [];
  for (const item of section.sections || section.subsections || []) {
    const title = item.name || item.title || item.sectionName;
    if (title) rows.push([String(title)]);
    rows.push(...normalizeSheetRows(item));
    rows.push([""]);
  }
  const ownRows = normalizeRows(section.rows || section.data || section.items || []);
  return rows.length ? [...ownRows, ...rows].filter((row) => row.some((cell) => String(cell ?? "").trim())) : ownRows;
}

function normalizeColumnHeaders(columns) {
  if (!Array.isArray(columns)) return [];
  return columns.map((column) => {
    if (column === null || column === undefined) return "";
    if (typeof column === "object") return String(column.header || column.name || column.label || column.title || column.key || "");
    return String(column);
  }).filter((column) => column.trim());
}

function rowLooksLikeHeader(row, columns) {
  const rowText = (Array.isArray(row) ? row : [row]).map((cell) => String(cell || "").trim().toLowerCase()).join("|");
  const matches = columns.filter((column) => rowText.includes(String(column || "").trim().toLowerCase())).length;
  return matches >= Math.min(columns.length, 2);
}

function normalizeWorkbook(parsed, raw, payload = {}) {
  const workbook = workbookCandidateFromParsed(parsed);
  const sheets = Array.isArray(workbook.sheets) ? workbook.sheets : [];
  const normalizedSheets = sheets.map((sheet, index) => ({
    name: String(sheet.name || `Sheet ${index + 1}`).slice(0, 31),
    rows: normalizeSheetRows(sheet),
    merges: Array.isArray(sheet.merges) ? sheet.merges : [],
    cols: Array.isArray(sheet.cols) ? sheet.cols : [],
    styles: normalizeSheetStyles(sheet.styles),
  })).filter((sheet) => sheet.rows.length);
  const aiNotes = Array.isArray(workbook.aiNotes) ? workbook.aiNotes.map((note) => String(note || "")) : [];
  let usedTemplateFallback = false;
  if (!normalizedSheets.length) {
    const templateWorkbook = workbookTemplateFromPayload(payload);
    if (templateWorkbook) {
      usedTemplateFallback = true;
      // CRITICAL: Claude returned no usable sheets, so we are forced to fall back to the
      // uploaded prior-year template. We must NOT copy prior-year dollar amounts into this
      // workbook (that would present last year's numbers as if they were current year).
      // Strip every amount, leave the structure/labels, and mark each sheet as incomplete.
      const warningRow = ["⚠ AI GENERATION INCOMPLETE — STRUCTURE ONLY. All amounts were left blank because the AI did not return a complete workbook. Re-run the preparation. Do NOT file these numbers."];
      normalizedSheets.push(...templateWorkbook.sheets.map((sheet, index) => ({
        name: String(sheet.name || `Sheet ${index + 1}`).slice(0, 31),
        rows: [warningRow, ...stripAmountsFromRows(normalizeRows(sheet.rows))],
        merges: [],
        cols: Array.isArray(sheet.cols) ? sheet.cols : [],
        styles: [],
      })).filter((sheet) => sheet.rows.length));
    }
  }
  if (!normalizedSheets.length) {
    throw new Error("Workbook JSON did not contain usable sheets.");
  }
  if (!normalizedSheets.some((sheet) => String(sheet.name || "").trim().toLowerCase() === "ai notes")) {
    normalizedSheets.push({
      name: "AI Notes",
      rows: [["AI Notes"], ...(aiNotes.length ? aiNotes : ["Workbook generated from source files. Review any blank cells marked unable to verify."]).map((note) => [note])],
    });
  }
  return { sheets: normalizedSheets, aiNotes, usedTemplateFallback };
}

function workbookTemplateFromPayload(payload = {}) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const templateFile = files.find((file) => file?.workbookTemplate?.sheets?.length || file?.workbookTemplates?.some((template) => template?.sheets?.length));
  if (!templateFile) return null;
  const template = templateFile.workbookTemplate?.sheets?.length
    ? templateFile.workbookTemplate
    : templateFile.workbookTemplates.find((candidate) => candidate?.sheets?.length);
  const targetYear = String(payload.metadata?.taxYear || payload.taxYear || "").trim();
  return {
    ...template,
    sheets: (template.sheets || []).map((sheet) => ({
      ...sheet,
      name: shiftYearText(sheet.name, targetYear),
      rows: normalizeRows(sheet.rows).map((row) => row.map((cell) => shiftYearText(cell, targetYear))),
      styles: normalizeSheetStyles(sheet.styles),
    })),
  };
}

function normalizeSheetStyles(styles) {
  if (!Array.isArray(styles)) return [];
  return styles.slice(0, 1000).map((style) => ({
    r: Number.isFinite(Number(style.r)) ? Number(style.r) : 0,
    c: Number.isFinite(Number(style.c)) ? Number(style.c) : 0,
    bold: Boolean(style.bold),
    underline: Boolean(style.underline),
    border: Boolean(style.border),
    fill: String(style.fill || ""),
    fontColor: String(style.fontColor || ""),
    numFmt: String(style.numFmt || ""),
  })).filter((style) => style.r >= 0 && style.c >= 0);
}

function shiftYearText(value, targetYear) {
  const text = String(value ?? "");
  if (!targetYear || !/20\d{2}/.test(text)) return text;
  return text.replace(/\b20\d{2}\b/g, targetYear);
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    let cells;
    if (Array.isArray(row)) {
      cells = row;
    } else if (row && typeof row === "object") {
      if (Array.isArray(row.cells)) cells = row.cells;
      else if (Array.isArray(row.values)) cells = row.values;
      else cells = Object.values(row);
    } else {
      cells = [row];
    }
    return cells.map((cell) => {
      if (cell === null || cell === undefined) return "";
      if (typeof cell === "object") {
        if (cell.formula) return String(cell.formula).startsWith("=") ? String(cell.formula) : `=${cell.formula}`;
        return String(cell.value ?? cell.text ?? cell.amount ?? cell.label ?? cell.name ?? cell.title ?? cell.description ?? "");
      }
      return cell;
    });
  }).filter((row) => row.some((cell) => String(cell ?? "").trim()));
}

function groupFiles(files) {
  const roleOf = (file) => String(file.reviewRole || file.canonicalRole || file.role || "").toLowerCase();
  return {
    taxReturns: files.filter((file) => roleOf(file).includes("return") || file.type === "taxReturns" && !roleOf(file)),
    workpapers: files.filter((file) => roleOf(file).includes("workpaper") || file.type === "workpapers"),
    documents: files.filter((file) => roleOf(file) === "supporting_document" || file.type === "documents"),
  };
}

function listFiles(files) {
  if (!files.length) return "None uploaded.";
  return files.map((file, index) =>
    `${index + 1}. ${file.name} (${labelForType(file.type)}, role: ${file.reviewRole || file.canonicalRole || file.role || "supporting_document"}, ${file.mediaType || "unknown"}, ${file.size || 0} bytes)`
  ).join("\n");
}

function buildReviewResponseContent(issue, payload = {}) {
  const files = Array.isArray(payload.additionalFiles) ? payload.additionalFiles : [];
  return [
    "Evaluate this preparer response to one issue from an existing tax review.",
    "",
    "ORIGINAL ISSUE",
    JSON.stringify(issue, null, 2),
    "",
    "PREPARER RESPONSE",
    String(payload.preparerResponse || "").trim(),
    "",
    "ADDITIONAL SUPPORTING FILES",
    files.length ? files.map((file, index) => [
      `--- ${index + 1}. ${file.name || "supporting file"} ---`,
      file.text || file.content || file.data || "(file content unavailable)",
    ].join("\n")).join("\n\n") : "None uploaded.",
    "",
    "Return only valid JSON with resolved, resolution, followUpRequired, and followUpQuestion.",
  ].join("\n");
}

async function loadReviewContext() {
  const [knowledgeBase, reviewExamples] = await Promise.all([
    loadContextFiles(KNOWLEDGE_BASE_DIR, "knowledge_base"),
    loadContextFiles(REVIEW_EXAMPLES_DIR, "review_examples"),
  ]);
  return { knowledgeBase, reviewExamples };
}

async function loadContextFiles(directory, kind, options = {}) {
  const includeBackendOnly = options.includeBackendOnly !== false;
  try {
    await fs.mkdir(directory, { recursive: true });
    const entries = await listFilesRecursive(directory);
    const files = [];

    for (const entry of entries) {
      const relativeName = path.relative(directory, entry).replace(/\\/g, "/");
      if (path.basename(relativeName).toLowerCase() === "readme.md") continue;
      if (!includeBackendOnly && isBackendOnlyContextFile(kind, relativeName)) continue;
      const ext = path.extname(relativeName).toLowerCase();
      if (!READABLE_CONTEXT_EXTENSIONS.has(ext)) continue;
      const text = await fs.readFile(entry, "utf8");
      files.push({
        kind,
        name: relativeName,
        text,
      });
      if (files.length >= MAX_CONTEXT_FILES) break;
    }

    return files;
  } catch (error) {
    console.warn(`Could not load ${kind}:`, error.message);
    return [];
  }
}

function isBackendOnlyContextFile(kind, relativeName) {
  const hidden = BACKEND_ONLY_CONTEXT_FILES.get(kind);
  if (!hidden) return false;
  return hidden.has(path.basename(relativeName).toLowerCase()) || hidden.has(String(relativeName || "").toLowerCase());
}

async function listFilesRecursive(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursive(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function loadMasterReviewPrompt() {
  try {
    return fsSync.readFileSync(MASTER_REVIEW_PROMPT_PATH, "utf8").trim();
  } catch (error) {
    console.warn("Master review prompt not found:", error.message);
    return "";
  }
}

function normalizeContextKind(kind) {
  const value = String(kind || "").trim().toLowerCase();
  if (["knowledge_base", "knowledge-base", "knowledge"].includes(value)) return "knowledge_base";
  if (["review_examples", "review-examples", "examples"].includes(value)) return "review_examples";
  return "";
}

function contextDirectoryForKind(kind) {
  return kind === "review_examples" ? REVIEW_EXAMPLES_DIR : KNOWLEDGE_BASE_DIR;
}

function safeContextRelativePath(name) {
  const rawParts = String(name || "context.txt").replace(/\\/g, "/").split("/");
  const safeParts = rawParts
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== "." && part !== "..")
    .map((part) => part.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/\s+/g, " ").slice(0, 120));
  return safeParts.length ? safeParts.join("/") : "context.txt";
}

function formatContextFiles(files) {
  return files.map((file, index) => [
    `--- ${index + 1}. ${file.name} ---`,
    file.text,
  ].join("\n")).join("\n\n");
}

function buildDiagnosticsContent(payload = {}) {
  const content = [];
  if (payload.errorImage?.contentBase64 && payload.errorImage?.mimeType) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: payload.errorImage.mimeType,
        data: payload.errorImage.contentBase64,
      },
    });
  }
  content.push({
    type: "text",
    text: buildDiagnosticsPrompt(payload),
  });
  return content;
}

function buildDiagnosticsPrompt(payload = {}) {
  return [
    "Analyze these e-file errors and return only valid JSON inside ```json fences.",
    "",
    `Selected tax software: ${payload.taxSoftware || "Not specified"}`,
    `Return type: ${payload.returnType || "Not specified"}`,
    `Tax year: ${payload.taxYear || "Not specified"}`,
    "",
    "Additional context from preparer:",
    payload.additionalContext || "None.",
    "",
    "Pasted diagnostic text:",
    payload.errorInput || "(No pasted text provided; use the screenshot if present.)",
  ].join("\n");
}

function buildDiagnosticsSystemPrompt() {
  return `You are a senior US tax software expert and CPA with deep knowledge of all major tax preparation platforms: ProConnect Tax, Lacerte, ProSeries, UltraTax CS, Drake Tax, CCH Axcess, GoSystem RS, TaxSlayer Pro, ATX, and TaxAct Professional.

You also have deep knowledge of IRS e-file specifications, IRS Modernized e-File (MeF) schema requirements, all IRS Business Rules (reject codes), and state e-file requirements for all 50 states.

Your job:
1. IDENTIFY every error, warning, reject code, or diagnostic message shown.
2. EXPLAIN what each means in plain English, including form/line and why IRS/state/software flags it.
3. FIX each item with specific step-by-step instructions for the selected software and tax year, using exact menu/screen/field paths when possible.
4. PRIORITY: distinguish critical e-file blockers from warnings/informational diagnostics.
5. ROOT CAUSE: identify cascaded errors that share one underlying issue.

Tax software screen knowledge:
PROCONNECT TAX: Input screens via left sidebar; Balance Sheet > Assets / Liabilities & Equity; Deductions > Depreciation (4562); General > Officer Compensation (1125-E); Income > Schedule M-3; Other > Foreign Transactions; State & Local [state abbreviation] > [relevant screen].
LACERTE: Use screen number and name, e.g. Screen 29 = Balance Sheet, Screen 26 = Depreciation.
PROSERIES: Form-based navigation; specify Interview mode vs Forms mode.
DRAKE TAX: Data entry screens by screen code, e.g. 4562.
ULTRATAX CS: Folder name + screen name.
CCH AXCESS / CCH PROSYSTEM FX: Interview tabs or Worksheet view; reference tab name and line number.

Common IRS reject codes include R0000-902-01, R0000-507-01, F1120-007-01, F1120-003-01, F1065-070-01, F990-040-01, F1040-007-02, F1120S-007-01, IND-031-04, IND-032-04, plus equivalents.

Respond ONLY with valid JSON inside \`\`\`json fences:
{
  "softwareDetected": "string",
  "returnTypeDetected": "string",
  "taxYearDetected": "string or null",
  "totalErrors": number,
  "totalWarnings": number,
  "canEfileNow": boolean,
  "summary": "string",
  "rootCauses": [{"rootCause":"string","affectsErrors":["string"],"fixThisFirst":boolean}],
  "diagnostics": [{"id":"string","type":"critical_efile_block | warning | informational","errorCode":"string or null","softwareRef":"string or null","rawErrorText":"string","formOrSchedule":"string","lineOrField":"string","plainExplanation":"string","rootCauseId":"string or null","fixSteps":[{"step":number,"instruction":"string","screenPath":"string","expectedValue":"string or null","warning":"string or null"}],"verificationStep":"string","irsReference":"string or null"}],
  "postFixChecklist": ["string"],
  "estimatedFixTime": "string",
  "additionalNotes": "string or null"
}`;
}

function normalizeDiagnostics(parsed, raw, payload = {}) {
  if (parsed && typeof parsed === "object") {
    return {
      softwareDetected: parsed.softwareDetected || payload.taxSoftware || "",
      returnTypeDetected: parsed.returnTypeDetected || payload.returnType || "",
      taxYearDetected: parsed.taxYearDetected || payload.taxYear || null,
      totalErrors: Number(parsed.totalErrors || 0),
      totalWarnings: Number(parsed.totalWarnings || 0),
      canEfileNow: Boolean(parsed.canEfileNow),
      summary: String(parsed.summary || ""),
      rootCauses: Array.isArray(parsed.rootCauses) ? parsed.rootCauses : [],
      diagnostics: Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [],
      postFixChecklist: Array.isArray(parsed.postFixChecklist) ? parsed.postFixChecklist : [],
      estimatedFixTime: String(parsed.estimatedFixTime || "Not estimated"),
      additionalNotes: parsed.additionalNotes || null,
    };
  }
  return {
    softwareDetected: payload.taxSoftware || "",
    returnTypeDetected: payload.returnType || "",
    taxYearDetected: payload.taxYear || null,
    totalErrors: 0,
    totalWarnings: 0,
    canEfileNow: true,
    summary: "No structured diagnostics were returned. Review the raw response.",
    rootCauses: [],
    diagnostics: [],
    postFixChecklist: [],
    estimatedFixTime: "Not estimated",
    additionalNotes: raw || null,
  };
}

async function findIrsInstructionUrl(form, year) {
  const normalizedForm = normalizeIrsForm(form);
  const normalizedYear = String(year || new Date().getFullYear()).match(/\d{4}/)?.[0] || "2025";
  if (!normalizedForm) return null;

  const reference = await loadIrsReferenceText();
  if (reference && !reference.toLowerCase().includes(normalizedForm.display.toLowerCase())) return null;

  const explicitUrl = findExplicitIrsUrl(reference, normalizedForm, normalizedYear);
  return {
    form: normalizedForm.display,
    year: normalizedYear,
    url: explicitUrl || buildIrsInstructionUrl(normalizedForm, normalizedYear),
  };
}

async function loadIrsReferenceText() {
  try {
    const entries = await listFilesRecursive(KNOWLEDGE_BASE_DIR);
    const match = entries.find((entry) => /IRS_Instructions_URL_Reference/i.test(path.basename(entry)));
    return match ? await fs.readFile(match, "utf8") : "";
  } catch (_) {
    return "";
  }
}

function findExplicitIrsUrl(reference, normalizedForm, year) {
  const urls = String(reference || "").match(/https?:\/\/[^\s"'<>]+/gi) || [];
  if (!urls.length) return "";
  const slug = normalizedForm.slug;
  const prior = year === "2024";
  return urls.find((url) => {
    const lower = url.toLowerCase();
    return lower.includes(`/${slug}`) || lower.includes(`${slug}--${year}`) || (prior && lower.includes(`/${slug.replace(/^i/, "")}--${year}`));
  }) || "";
}

function normalizeIrsForm(form) {
  const raw = String(form || "").toUpperCase().replace(/\s+/g, " ").trim();
  const scheduleMatch = raw.match(/SCHEDULE\s+([A-Z0-9-]+)/);
  const formMatch = raw.match(/(?:FORM\s*)?(1120S|1120-S|\d{3,4}(?:-[A-Z]+)?|1040-NR|1040-PR|1040-SS|1040-SR)/);
  const key = scheduleMatch ? `SCHEDULE ${scheduleMatch[1]}` : formMatch ? `FORM ${formMatch[1]}` : raw;
  const map = {
    "FORM 1040": { display: "Form 1040", slug: "i1040" },
    "FORM 1040-NR": { display: "Form 1040-NR", slug: "i1040nr" },
    "FORM 1040-PR": { display: "Form 1040-PR", slug: "i1040pr" },
    "FORM 1040-SS": { display: "Form 1040-SS", slug: "i1040ss" },
    "FORM 1040-SR": { display: "Form 1040-SR", slug: "i1040" },
    "FORM 1041": { display: "Form 1041", slug: "i1041" },
    "FORM 1065": { display: "Form 1065", slug: "i1065" },
    "FORM 1120": { display: "Form 1120", slug: "i1120" },
    "FORM 1120-S": { display: "Form 1120-S", slug: "i1120s" },
    "FORM 1120S": { display: "Form 1120-S", slug: "i1120s" },
    "FORM 990": { display: "Form 990", slug: "i990" },
    "FORM 990-EZ": { display: "Form 990-EZ", slug: "i990ez" },
    "FORM 990-T": { display: "Form 990-T", slug: "i990t" },
    "FORM 990-PF": { display: "Form 990-PF", slug: "i990pf" },
    "FORM 706": { display: "Form 706", slug: "i706" },
    "FORM 709": { display: "Form 709", slug: "i709" },
    "FORM 720": { display: "Form 720", slug: "i720" },
    "FORM 2290": { display: "Form 2290", slug: "i2290" },
    "SCHEDULE A": { display: "Schedule A", slug: "i1040sca" },
    "SCHEDULE B": { display: "Schedule B", slug: "i1040sb" },
    "SCHEDULE C": { display: "Schedule C", slug: "i1040sc" },
    "SCHEDULE D": { display: "Schedule D", slug: "i1040sd" },
    "SCHEDULE E": { display: "Schedule E", slug: "i1040se" },
    "SCHEDULE SE": { display: "Schedule SE", slug: "i1040sse" },
    "SCHEDULE K-1": { display: "Schedule K-1", slug: "i1065sk1" },
  };
  return map[key] || null;
}

function buildIrsInstructionUrl(normalizedForm, year) {
  if (String(year) === "2024") return `https://www.irs.gov/pub/irs-prior/${normalizedForm.slug}--2024.pdf`;
  return `https://www.irs.gov/pub/irs-pdf/${normalizedForm.slug}.pdf`;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function extractText(data) {
  if (!Array.isArray(data.content)) return "Claude returned no review text.";
  return data.content.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n\n").trim() || "Claude returned no review text.";
}

function estimateClaudeCost(usage) {
  if (!usage) return null;
  const inputTokens = Number(usage.input_tokens || 0);
  const outputTokens = Number(usage.output_tokens || 0);
  const cacheCreationInputTokens = Number(usage.cache_creation_input_tokens || 0);
  const cacheReadInputTokens = Number(usage.cache_read_input_tokens || 0);
  const inputUsd = (inputTokens / 1_000_000) * CLAUDE_INPUT_COST_PER_MTOK;
  const cacheWriteUsd = (cacheCreationInputTokens / 1_000_000) * CLAUDE_INPUT_COST_PER_MTOK * 1.25;
  const cacheReadUsd = (cacheReadInputTokens / 1_000_000) * CLAUDE_INPUT_COST_PER_MTOK * 0.1;
  const outputUsd = (outputTokens / 1_000_000) * CLAUDE_OUTPUT_COST_PER_MTOK;
  const totalUsd = inputUsd + cacheWriteUsd + cacheReadUsd + outputUsd;
  return {
    currency: "USD",
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    inputUsd,
    cacheWriteUsd,
    cacheReadUsd,
    outputUsd,
    totalUsd,
    inputCostPerMillionTokens: CLAUDE_INPUT_COST_PER_MTOK,
    outputCostPerMillionTokens: CLAUDE_OUTPUT_COST_PER_MTOK,
  };
}

function estimatePayloadInputTokens(payload = {}) {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const chars = JSON.stringify(payload.metadata || {}).length + files.reduce((sum, file) => {
    if (file.text) return sum + String(file.text).length;
    if (file.encoding === "base64") return sum + Math.round(String(file.data || "").length * 0.75);
    return sum + 500;
  }, 0) + MASTER_REVIEW_PROMPT.length;
  return Math.ceil(chars / 4);
}

function labelForType(type) {
  return {
    taxReturns: "Review Package",
    workpapers: "Workpaper",
    documents: "Related Document",
    priorWorkpaper: "Prior-Year Workpaper",
    financialReports: "Current-Year Financial Report",
    preparationPackage: "Preparation Package",
  }[type] || "Document";
}

function truncate(value, maxLength) {
  const text = String(value || "");
  const limit = Number(maxLength || 0);
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
  if (limit <= 20) return text.slice(0, limit);
  return `${text.slice(0, limit - 14)}\n[truncated]`;
}

function truncateMiddle(value, maxLength) {
  const text = String(value || "");
  const limit = Number(maxLength || 0);
  if (!Number.isFinite(limit) || limit <= 0 || text.length <= limit) return text;
  if (limit <= 40) return text.slice(0, limit);
  const marker = "\n[... middle truncated ...]\n";
  const available = Math.max(0, limit - marker.length);
  const head = Math.ceil(available * 0.6);
  const tail = Math.floor(available * 0.4);
  return `${text.slice(0, head)}${marker}${text.slice(Math.max(0, text.length - tail))}`;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

// Favicons served from stable root URLs, publicly (before the auth gate) so Google's crawler
// and browsers can fetch them without logging in. Files live in assets/icons/.
const FAVICON_ROUTES = {
  "/favicon.ico": "favicon.ico",
  "/favicon-48.png": "favicon-48.png",
  "/favicon-96.png": "favicon-96.png",
  "/favicon-144.png": "favicon-144.png",
  "/favicon-192.png": "favicon-192.png",
  "/favicon-512.png": "favicon-512.png",
  "/apple-touch-icon.png": "apple-touch-icon.png",
};

function serveLegalPage(res, title, bodyHtml) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — RAG Tax AI</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#222;line-height:1.6}h1{font-size:1.6rem;margin-bottom:4px}h2{font-size:1.1rem;margin-top:2rem}p,li{font-size:.95rem}a{color:#1a73e8}footer{margin-top:3rem;font-size:.8rem;color:#666;border-top:1px solid #eee;padding-top:1rem}</style></head><body>${bodyHtml}<footer><p>RAG Tax AI &mdash; <a href="/privacy">Privacy Policy</a> &mdash; <a href="/eula">EULA</a></p></footer></body></html>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=86400" });
  res.end(html);
}

function servePrivacyPolicy(res) {
  serveLegalPage(res, "Privacy Policy", `
    <h1>Privacy Policy</h1>
    <p><strong>Last updated: June 30, 2026</strong></p>
    <p>RAG Tax AI ("RAG Tax AI", "we", "us", or "the App") provides AI-assisted tax return review, workpaper preparation, client request workflows, tax research support, document analysis, accounting software integrations, and related CPA firm productivity tools. This Privacy Policy explains what information we collect, how we use it, how we protect it, and what choices authorized users have.</p>
    <p>This policy is written for firms and professionals using RAG Tax AI in connection with tax, accounting, and advisory work. The App is not intended for children, consumer social use, or unrelated personal data processing.</p>

    <h2>1. Information we collect</h2>
    <ul>
      <li><strong>Account and login information:</strong> usernames, display names, role assignments, hashed passwords, account status, spending limits, and session metadata needed to authenticate users and administer access.</li>
      <li><strong>Uploaded tax and financial materials:</strong> tax returns, workpapers, organizer files, notices, trial balances, financial statements, PDFs, spreadsheets, images, and other documents users submit for review, preparation, extraction, or analysis.</li>
      <li><strong>Client and workflow records:</strong> client names, entity details, tax years, return types, deadlines, tracker items, review findings, notes, firm library entries, generated drafts, and user-entered workflow data.</li>
      <li><strong>Accounting software data:</strong> when authorized by a user, the App may retrieve reports and related data from connected accounting platforms such as QuickBooks Online and Xero, including profit and loss reports, balance sheets, trial balances, accounts, contacts, and other report data needed for tax workflows.</li>
      <li><strong>Google account data:</strong> when authorized by a user, the App may access selected Google services such as Google Drive file metadata/content selected by the user, Gmail draft/compose functionality, and the user's Google email address, depending on the scopes granted.</li>
      <li><strong>AI usage and cost data:</strong> model used, action type, token counts, estimated processing costs, timestamps, duration, and related operational metadata used for budgets, security, auditing, and service monitoring.</li>
      <li><strong>Technical and security logs:</strong> IP-derived request information, browser and device metadata, server logs, rate-limit events, error logs, audit events, and security diagnostics.</li>
      <li><strong>Access request data:</strong> information submitted through the "Request access" form, such as email, firm/company/person name, and estimated annual filed returns.</li>
    </ul>

    <h2>2. How we use information</h2>
    <ul>
      <li>Authenticate users, enforce role-based access, manage administrator functions, and protect accounts.</li>
      <li>Analyze uploaded documents and accounting data to assist with tax return review, workpaper preparation, estimated tax workflows, notices, client deliverables, research, and related CPA firm operations.</li>
      <li>Generate AI-assisted summaries, review points, issue lists, workpapers, client request drafts, calculations, and other outputs requested by users.</li>
      <li>Connect to user-authorized third-party services such as Google Drive, Gmail, QuickBooks Online, and Xero.</li>
      <li>Track token usage, apply user-level spending limits, prevent excessive usage, troubleshoot errors, improve reliability, and secure the App.</li>
      <li>Respond to access requests, support questions, security issues, and administrative needs.</li>
    </ul>

    <h2>3. AI processing</h2>
    <p>RAG Tax AI uses third-party AI model providers, including Anthropic Claude, to process prompts and user-provided materials for the requested workflows. Information submitted for AI-assisted review may be sent to those providers solely to generate the requested output. We do not sell client data, and we do not use client tax documents, Google Workspace data, accounting data, or uploaded files to train generalized AI or machine-learning models. Users should review all AI-generated outputs before relying on them. The App is a professional assistance tool and does not replace qualified tax judgment, CPA review, or firm quality-control procedures.</p>

    <h2>4. Google API data</h2>
    <p>If you connect a Google account, RAG Tax AI uses Google data only to provide user-facing features requested inside the App, such as selecting Drive materials for review or creating Gmail drafts. The App does not sell Google user data, does not use Google user data for advertising, and does not transfer Google user data except as necessary to provide the requested feature, comply with law, or protect the App. OAuth tokens are stored server-side and are not exposed to the browser.</p>

    <h2>5. Accounting integrations</h2>
    <p>If you connect QuickBooks Online, Xero, or another accounting platform, RAG Tax AI uses the authorized connection to retrieve accounting reports and related business data needed for tax review, workpaper preparation, reconciliation, and analysis. OAuth tokens are stored server-side. Users can revoke access from within the relevant provider account or by contacting an administrator.</p>

    <h2>6. How we share information</h2>
    <p>We do not sell personal information, client tax information, Google user data, or accounting data. We may share information only with:</p>
    <ul>
      <li><strong>Service providers</strong> that host, secure, operate, or process the App, including AI model providers and infrastructure providers.</li>
      <li><strong>Connected third-party platforms</strong> at the user's direction, such as Google, QuickBooks Online, or Xero.</li>
      <li><strong>Firm administrators</strong> who manage users, budgets, access, security, and workflow operations.</li>
      <li><strong>Legal or security recipients</strong> when required to comply with law, enforce terms, investigate abuse, protect users, or defend legal rights.</li>
    </ul>

    <h2>7. Data retention</h2>
    <p>Retention depends on the type of information and the purpose for which it is used. Account records, audit logs, cost logs, workflow records, access requests, and OAuth tokens may be retained while needed to operate the App, maintain security, support firm workflows, comply with legal obligations, or preserve business records. Uploaded files may be processed temporarily or retained when a workflow requires persistent storage. Stored document metadata includes retention information, and retained local documents may be removed when the configured retention period expires. Administrators may request deletion or revocation of user accounts, OAuth tokens, or stored records, subject to legal, tax, accounting, backup, and security requirements.</p>

    <h2>8. Security</h2>
    <p>RAG Tax AI uses administrative, technical, and organizational safeguards designed to protect information, including authenticated access, role separation, tenant or firm identifiers, HTTPS transport, server-side token handling, password hashing, budget enforcement, rate limiting, audit logging, and restricted server-side storage. No system can guarantee absolute security, so users should avoid uploading unnecessary sensitive information and should promptly report suspected unauthorized access.</p>

    <h2>9. Firm separation and access control</h2>
    <p>The App is designed so users, client records, budgets, and audit events can be associated with a firm or organization. Administrators should create accounts only for authorized personnel, assign appropriate roles, disable inactive users, and avoid sharing credentials. Access-control features are a safeguard, but each firm remains responsible for deciding who may access client materials.</p>

    <h2>10. Incident response</h2>
    <p>If we become aware of unauthorized access, data loss, or another security incident affecting App data, we will take reasonable steps to investigate, mitigate, preserve relevant records, and notify affected administrators when legally or contractually required. Users should promptly report suspicious account activity, exposed credentials, or misdirected client data.</p>

    <h2>11. User responsibilities</h2>
    <p>Users are responsible for ensuring they have authority to upload, connect, or process client materials in the App. Users should review generated outputs, preserve required source documents, follow firm policies, comply with applicable tax and privacy laws, and avoid sharing credentials or unauthorized access.</p>

    <h2>12. Your choices</h2>
    <ul>
      <li>You may disconnect Google, QuickBooks Online, Xero, or other connected services through the provider account or by contacting an administrator.</li>
      <li>You may request deletion or correction of account information where legally and operationally permitted.</li>
      <li>Administrators may disable accounts, reset passwords, change spending limits, or remove access.</li>
    </ul>

    <h2>13. Changes to this policy</h2>
    <p>We may update this Privacy Policy as the App evolves, including when new integrations, workflows, vendors, or security features are added. The "Last updated" date reflects the latest version.</p>

    <h2>14. Contact</h2>
    <p>For questions about this Privacy Policy, access, data deletion, or connected accounts, contact us at <a href="mailto:ramiroflores@ragtax-ia.com">ramiroflores@ragtax-ia.com</a>.</p>
  `);
}

function serveEula(res) {
  serveLegalPage(res, "End-User License Agreement", `
    <h1>End-User License Agreement (EULA)</h1>
    <p><strong>Last updated: June 30, 2026</strong></p>
    <p>This End-User License Agreement ("Agreement") governs access to and use of RAG Tax AI ("the App"). By accessing the App, you agree to use it only as authorized by your organization and in accordance with this Agreement, the Privacy Policy, and applicable professional, tax, data protection, and security obligations.</p>

    <h2>1. License grant</h2>
    <p>Subject to this Agreement, we grant authorized users a limited, non-exclusive, non-transferable, revocable license to use RAG Tax AI for tax return review, workpaper preparation, document analysis, client request workflows, accounting software analysis, research assistance, and related professional tax and accounting workflows.</p>

    <h2>2. Restrictions</h2>
    <ul>
      <li>You may not sell, sublicense, rent, transfer, or provide unauthorized access to the App.</li>
      <li>You may not reverse-engineer, decompile, disassemble, bypass security controls, scrape, overload, or interfere with the App.</li>
      <li>You may not upload materials you are not authorized to process or use the App for unlawful, deceptive, or unauthorized purposes.</li>
      <li>You may not share login credentials or allow another person to use your account.</li>
      <li>You may not use AI outputs as final professional advice without appropriate human review and verification.</li>
    </ul>

    <h2>3. Data and privacy</h2>
    <p>Use of the App is subject to our <a href="/privacy">Privacy Policy</a>, which is incorporated into this Agreement by reference. Users and their organizations are responsible for maintaining client authorizations, professional confidentiality obligations, tax records, and any required data processing or confidentiality agreements with their own clients.</p>

    <h2>4. Third-party services</h2>
    <p>The App integrates with third-party services including AI model providers, Google services, QuickBooks Online, Xero, and hosting or infrastructure providers. Your use of connected services may be subject to those providers' terms, privacy policies, account settings, rate limits, and authorization requirements.</p>

    <h2>5. Disclaimer of warranties</h2>
    <p>The App is provided "as is" and "as available" without warranty of any kind. AI-generated outputs, summaries, calculations, workpapers, notices, research responses, and drafts are assistance tools only. They may be incomplete, inaccurate, outdated, or unsuitable for a particular client or filing position. A qualified professional must review, verify, and approve all outputs before use or reliance.</p>

    <h2>6. Limitation of liability</h2>
    <p>To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential, exemplary, or punitive damages, including lost profits, lost data, filing errors, penalties, interest, professional liability claims, or business interruption arising from use of the App or reliance on AI-assisted outputs.</p>

    <h2>7. User accounts and budgets</h2>
    <p>Administrators may create, disable, delete, or modify user accounts and may set spending or token-related limits. The App may block AI-powered actions when a user reaches the configured limit. Usage and cost estimates are operational controls and may differ from provider invoices due to timing, model pricing changes, retries, caching, or provider-side billing adjustments.</p>

    <h2>8. Suspension and termination</h2>
    <p>We may suspend or terminate access at any time if we believe an account is unauthorized, insecure, abusive, non-compliant, inactive, or otherwise creates legal, security, operational, or business risk.</p>

    <h2>9. Data retention, deletion, and security controls</h2>
    <p>The App may retain account records, client workflow records, OAuth tokens, audit logs, usage logs, and uploaded materials as described in the Privacy Policy. Administrators may request deletion, token revocation, user deactivation, or retention changes where operationally and legally permitted. Security controls such as rate limits, budget limits, audit logging, firm separation, and administrator verification may be added or changed to protect the App.</p>

    <h2>10. Changes</h2>
    <p>We may update this Agreement from time to time as the App, integrations, security controls, and business terms evolve. Continued use after an update means you accept the updated Agreement.</p>

    <h2>11. Contact</h2>
    <p>For questions about this Agreement, contact us at <a href="mailto:ramiroflores@ragtax-ia.com">ramiroflores@ragtax-ia.com</a>.</p>
  `);
}

async function serveFavicon(req, res, fileName) {
  try {
    const file = await fs.readFile(path.join(ROOT, "assets", "icons", fileName));
    const ext = path.extname(fileName).toLowerCase();
    const contentType = ext === ".ico" ? "image/x-icon" : (mimeTypes[ext] || "application/octet-stream");
    res.writeHead(200, { "content-type": contentType, "cache-control": "public, max-age=604800", "content-length": file.length });
    if (req.method === "HEAD") { res.end(); return; }
    res.end(file);
  } catch (_) { sendText(res, 404, "Not found"); }
}

async function serveWebManifest(req, res) {
  const manifest = {
    name: "RAG Tax AI",
    short_name: "RAG Tax AI",
    description: "AI-powered tax return review and workpaper preparation for CPA firms.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#164a92",
    icons: [
      { src: "/favicon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
  const body = JSON.stringify(manifest);
  res.writeHead(200, {
    "content-type": "application/manifest+json; charset=utf-8",
    "cache-control": "public, max-age=604800",
    "content-length": Buffer.byteLength(body),
  });
  if (req.method === "HEAD") { res.end(); return; }
  res.end(body);
}

async function serveStatic(req, res) {
  const requestedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestedUrl.pathname === "/" ? "/index.html" : requestedUrl.pathname;
  const normalizedPath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\\/])+/, "");
  const filePath = path.join(ROOT, normalizedPath);
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) { sendText(res, 403, "Forbidden"); return; }
  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": [".html", ".css", ".js"].includes(ext) ? "no-store" : "public, max-age=3600",
    });
    res.end(file);
  } catch (_) { sendText(res, 404, "Not found"); }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "", size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const error = new Error("Request body too large.");
        error.statusCode = 413;
        error.expose = true;
        reject(error);
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(new Error("Invalid JSON body.")); } });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders(res),
  };
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

// Long AI calls (review, workpaper) can run longer than the reverse proxy's read timeout,
// which produces a 504 even though the backend is still working. To keep the proxy
// connection alive we send the 200 + headers immediately and write a single space every
// few seconds while the work runs. JSON.parse ignores the leading whitespace, so the
// client still parses the final JSON normally. "X-Accel-Buffering: no" stops nginx from
// buffering the response so the heartbeat bytes actually reach the proxy.
function startHeartbeatResponse(res) {
  if (res.headersSent || res._heartbeatActive) return;
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
    ...corsHeaders(res),
  });
  try { res.write(" "); } catch (_) {}
  res._heartbeatActive = true;
  res._heartbeatTimer = setInterval(() => {
    try { res.write(" "); } catch (_) {}
  }, 15000);
  res._heartbeatTimer.unref?.();
}

function endHeartbeatResponse(res, payload) {
  if (res._heartbeatTimer) { clearInterval(res._heartbeatTimer); res._heartbeatTimer = null; }
  res._heartbeatActive = false;
  try { res.end(JSON.stringify(payload)); } catch (_) {}
}

function sendCorsPreflight(res) {
  res.writeHead(204, {
    ...corsHeaders(res),
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "86400",
  });
  res.end();
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function redirect(res, location) {
  res.writeHead(302, { location, "cache-control": "no-store" });
  res.end();
}

function setSecurityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
  res.setHeader("content-security-policy", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "));
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
}

function getAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.length) return "";
  return ALLOWED_ORIGINS.includes(origin) ? origin : "";
}

function corsHeaders(res) {
  if (!res.corsOrigin) return {};
  return {
    "access-control-allow-origin": res.corsOrigin,
    "vary": "Origin",
  };
}

