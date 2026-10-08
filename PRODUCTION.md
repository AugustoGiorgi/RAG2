# Production Deployment

This app is designed to run as a backend-served web application. The frontend and API are served from the same Node process.

## Required Secret

Configure this in the hosting provider's secret manager:

```text
ANTHROPIC_API_KEY
AUTH_SECRET
AUTH_USERS_JSON
```

The key is never sent to the browser.

## Recommended Environment Variables

```text
NODE_ENV=production
PORT=8080
HOST=0.0.0.0
ALLOWED_ORIGINS=https://your-production-domain.com
AUTH_SECRET=at-least-32-random-characters
AUTH_USERS_JSON=[{"username":"reviewer","passwordHash":"pbkdf2$210000$salt$hash"}]
SESSION_TTL_SECONDS=28800
COOKIE_SECURE=true
MAX_UPLOAD_MB=64
MAX_FILES_PER_REVIEW=15
KNOWLEDGE_BASE_DIR=/app/knowledge_base
REVIEW_EXAMPLES_DIR=/app/review_examples
CLAUDE_MODEL=claude-sonnet-4-6
ENABLE_CLAUDE_WEB_SEARCH=true
CLAUDE_WEB_SEARCH_MAX_USES=3
CLAUDE_WEB_ALLOWED_DOMAINS=irs.gov,uscode.house.gov,ecfr.gov,ftb.ca.gov,tax.ny.gov
GOOGLE_REDIRECT_URI=https://your-production-domain.com/auth/google/callback
GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.send
GOOGLE_PICKER_API_KEY=restricted-browser-api-key
GOOGLE_CLOUD_PROJECT_NUMBER=numeric-project-number
ENABLE_GMAIL_SEND=true
AI_MAX_CONCURRENT=10
AI_MAX_QUEUE=40
AI_QUEUE_WAIT_MS=90000
```

Google Picker is required with `drive.file`; it grants access only to files the user explicitly selects. Existing connections created with another scope set must reconnect once.

## Runtime Endpoints

```text
GET /healthz
GET /api/config
POST /api/review
GET /
```

Use `/healthz` for hosting health checks.

## Password recovery

New accounts require a unique recovery email and receive a temporary password.
Their session can only change that password before accessing the app. Existing
accounts are not forced to change passwords on deployment; an administrator may
add a recovery email to them from User Administration. The login page links to
email recovery. A reset link expires after 15 minutes, is single-use, and the
token is stored only as an HMAC hash. Resetting or changing a password invalidates
existing sessions. Never send the user's final password to an administrator.

The reset email uses the existing `ACCESS_REQUEST_SMTP_*` settings and links to
`https://ragtax-ia.com/reset-password`. If mail delivery is unavailable, an
administrator can set a new temporary password in User Administration; the user
must change it on the next sign-in. Before relying on recovery in a new
environment, verify SMTP delivery to an authorized test inbox. Run
`node --test test/password-recovery.test.js` for the isolated mail and auth flow.

## Deployment Notes

- Serve over HTTPS.
- Put authentication in front of the app before handling real client tax documents.
- Keep uploads ephemeral unless review history is explicitly required.
- If review history is added, store files and outputs in encrypted storage.
- Configure `ALLOWED_ORIGINS` when frontend and backend are not same-origin.
- Mount `KNOWLEDGE_BASE_DIR` and `REVIEW_EXAMPLES_DIR` as managed storage if firm content should be updated without rebuilding the image.
- Keep `senior-review-master-prompt.txt` under firm control. End users can add case-specific notes, but they cannot edit the master prompt in the browser.
- ZIP uploads are extracted in the browser before review. Very large ZIPs still count against browser memory and request-size limits.
- Set `CLAUDE_INPUT_COST_PER_MTOK` and `CLAUDE_OUTPUT_COST_PER_MTOK` if pricing changes or if a different Claude model is used.
- Keep the exact approved OAuth scope set aligned between the code, production environment, and Google Cloud Console. Direct Gmail sending requires the verified `gmail.send` scope.
- Run `npm run db:setup` after updating the code and before restarting Node. This applies the `firm_admin` role constraint and keeps the private schema current.
- On the GoDaddy VPS, `scripts/deploy-vps.sh` is installed as `/home/agiorgi/deploy-rag-tax.sh`. It backs up local data, refuses non-fast-forward updates or commits that change tracked `data/` files, runs the database setup, and restarts PM2 only after checks pass. Keep the VPS script in sync with this copy; do not replace its fast-forward merge with `git reset --hard` because live JSON files are modified in production.
- Run one Node/PM2 instance per data directory. The remaining JSON-backed stores and in-memory limits are safe for concurrent requests within one process, but are not shared across a PM2 cluster or multiple VPS instances. Move those stores and limits to PostgreSQL/Redis before horizontal scaling.
- `AI_MAX_CONCURRENT` caps active AI work; `AI_MAX_QUEUE` and `AI_QUEUE_WAIT_MS` bound the wait. Increase them only after measuring VPS memory, CPU, Anthropic rate limits, and real user latency.

## Initial 20-user capacity check

Run `node --test test/twenty-users.test.js` on the target host. It starts a separate
loopback-only server with a temporary data directory, 20 synthetic accounts in two
firms, and no database, Anthropic, Google, or QuickBooks credentials. It does not
modify production client data or call external APIs. The test reports request count,
p95 latency, and worst latency. Run `npm test` for the wider regression suite.

The check covers concurrent login, client/task/session writes and reads, same-firm
sharing, cross-firm access by direct ID, personal Google/QuickBooks token state,
and API rate-limit behavior for users behind one office IP. It also tests that
20 AI jobs are admitted through the in-process limiter without exceeding ten
active slots. This is an initial functional/capacity gate, not a guarantee that
20 simultaneous long AI reviews or uploads will finish quickly. Those need a
separate staged test with realistic document sizes and provider quotas before
raising concurrency limits.

Keep one PM2 instance while JSON-backed stores and rate limits remain local to
the process. Before adding instances or servers, move shared state and distributed
coordination to durable services and rerun the isolation and capacity checks.
