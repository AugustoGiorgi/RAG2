const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Google OAuth uses only the production-approved scope set", () => {
  const server = read("server.js");
  const runtimeAndConfig = [
    server,
    read("app.js"),
    read(".env.example"),
    read("render.yaml"),
    read("README.md"),
    read("PRODUCTION.md"),
  ].join("\n");

  assert.match(server, /const GOOGLE_DRIVE_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/drive\.file"/);
  assert.match(server, /const GOOGLE_GMAIL_SEND_SCOPE = "https:\/\/www\.googleapis\.com\/auth\/gmail\.send"/);
  assert.match(server, /const REQUIRED_GOOGLE_OAUTH_SCOPES = \[GOOGLE_USERINFO_SCOPE, GOOGLE_DRIVE_SCOPE, GOOGLE_GMAIL_SEND_SCOPE\]/);
  assert.match(server, /include_granted_scopes: "false"/);
  assert.doesNotMatch(runtimeAndConfig, /auth\/drive\.readonly/);
  assert.doesNotMatch(runtimeAndConfig, /auth\/gmail\.compose/);
});

test("every Drive entry point uses the shared OAuth gate and official Google Picker", () => {
  const app = read("app.js");
  const server = read("server.js");

  for (const zone of [
    "prep-package",
    "review-package",
    "knowledge-base",
    "review-examples",
    "notice-document",
    "notice-prior-return",
    "diagnostics-screenshot",
    "organizer-prior-return",
    "presentation",
    "calculation",
    "estimated-reviewed-workbook",
    "planning-client",
    "planning-library",
  ]) {
    assert.match(app, new RegExp('"' + zone + '"'), "missing Drive integration for " + zone);
  }

  assert.match(app, /return runWithGooglePermission\("drive", action\)/);
  assert.match(app, /sources\.includes\("drive"\).*googleCapabilityReady\("drive"\)/);
  assert.match(app, /new google\.picker\.PickerBuilder\(\)/);
  assert.match(app, /\/api\/drive\/picker-config/);
  assert.match(app, /Loading \$\{fileName\} from Google Drive/);
  assert.match(server, /requestUrl\.pathname === "\/api\/drive\/picker-config"/);
  assert.match(server, /googleTokenHasScope\(tokens, GOOGLE_DRIVE_SCOPE\)/);
  assert.match(server, /script-src 'self' 'unsafe-inline' https:\/\/apis\.google\.com/);
  assert.match(server, /frame-src 'self' https:\/\/accounts\.google\.com https:\/\/docs\.google\.com https:\/\/drive\.google\.com/);
});

test("all Gmail send workflows share one permission manager and report real delivery state", () => {
  const app = read("app.js");
  const server = read("server.js");
  const html = read("index.html");
  const css = read("styles.css");

  assert.ok((app.match(/runWithGooglePermission\("gmail"/g) || []).length >= 5);
  assert.match(app, /Sending email through Gmail/);
  assert.match(app, /Email sent successfully/);
  assert.match(app, /showToast\("Preparing attachments\.\.\.", "info", \{ persistent: true, loading: true \}\)/);
  assert.match(server, /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/);
  assert.doesNotMatch(app + "\n" + server, /create-gmail-draft/);
  assert.doesNotMatch(html, /Create (?:Gmail )?Draft/i);
  assert.match(css, /\.toast-loading::before/);
});

test("OAuth opens only a popup before asynchronous status checks", () => {
  const app = read("app.js");
  const manager = app.slice(app.indexOf("function runWithGooglePermission"), app.indexOf("function openDriveWhenConnected"));

  assert.doesNotMatch(manager, /await\s+googleCapabilityReady/);
  assert.match(manager, /connectGoogleDrive\(\)/);
  assert.match(app, /window\.open\("", "google-oauth"/);
  assert.match(app, /googleOauthPopup\.location\.replace\("\/auth\/google"\)/);
});
