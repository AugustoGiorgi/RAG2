# AI Senior Tax Reviewer

Production web app for senior review of US tax return packages with Claude.

The software does not prepare tax returns and does not calculate tax. Its job is to collect the right files, keep Claude API access server-side, add firm/official context, run a senior-review prompt, display structured findings, and export the review.

## Production Configuration

The Claude API key belongs to the backend only. Users should never paste or see it in the browser.

Configure these variables in the hosting provider's secret/environment settings:

```text
ANTHROPIC_API_KEY=sk-ant-api03-...
AUTH_SECRET=at-least-32-random-characters
AUTH_USERS_JSON=[{"username":"reviewer","passwordHash":"pbkdf2$210000$salt$hash"}]
PORT=8080
HOST=0.0.0.0
ALLOWED_ORIGINS=https://your-production-domain.com
MAX_UPLOAD_MB=64
MAX_FILES_PER_REVIEW=15
KNOWLEDGE_BASE_DIR=/app/knowledge_base
REVIEW_EXAMPLES_DIR=/app/review_examples
CLAUDE_MODEL=claude-sonnet-4-6
ENABLE_CLAUDE_WEB_SEARCH=false
CLAUDE_WEB_SEARCH_MAX_USES=3
CLAUDE_WEB_ALLOWED_DOMAINS=irs.gov,ftb.ca.gov,tax.ny.gov
```

`ANTHROPIC_API_KEY`, `AUTH_SECRET`, and `AUTH_USERS_JSON` are required for production. The other variables are optional.

Do not hardcode the API key in `index.html`, `app.js`, `server.js`, or any committed file.

## Deployment

Deploy this as a Node app on a backend hosting service such as Render, Railway, Fly.io, AWS, Azure, Google Cloud, or any Node-capable server.

Production requirements:

- Set `ANTHROPIC_API_KEY` as a secret/environment variable in the hosting provider.
- Set `AUTH_SECRET` and `AUTH_USERS_JSON` as secrets/environment variables.
- Serve the app over HTTPS.
- Keep uploaded tax documents ephemeral unless the product explicitly needs review history.
- Store persistent review history only in an encrypted database/storage layer.

Start command:

```text
npm start
```

Health/config endpoint:

```text
/healthz
/api/config
```

The user-facing browser never receives the Claude API key.

## Authentication

The app includes backend authentication with an HttpOnly signed session cookie.

Production auth variables:

```text
AUTH_SECRET=at-least-32-random-characters
AUTH_USERS_JSON=[{"username":"reviewer","passwordHash":"pbkdf2$210000$salt$hash"}]
SESSION_TTL_SECONDS=28800
COOKIE_SECURE=true
```

Passwords are not stored directly. Store only PBKDF2 password hashes in `AUTH_USERS_JSON`.

Generate a user hash with:

```text
npm run generate-password-hash
```

Disable auth only for controlled internal testing:

```text
AUTH_REQUIRED=false
```

## Web Research

Web research is controlled only by backend environment variables:

```text
ENABLE_CLAUDE_WEB_SEARCH=true
CLAUDE_WEB_SEARCH_MAX_USES=3
CLAUDE_WEB_ALLOWED_DOMAINS=irs.gov,ftb.ca.gov,tax.ny.gov
```

This requires Anthropic web search access on the account and a model that supports the tool. If web research is disabled, Claude is instructed not to claim it searched the internet.

## QuickBooks Online Setup

1. Go to https://developer.intuit.com.
2. Sign in with your Intuit developer account or create one.
3. Click **Create an app** and select **QuickBooks Online and Payments**.
4. App name: `Tax Review App` or your firm name.
5. Select the scope `com.intuit.quickbooks.accounting`.
6. In the app dashboard, open **Keys & credentials** and copy the Client ID and Client Secret.
7. Add this redirect URI: `http://localhost:8080/auth/qbo/callback`.
8. Add these environment variables:

```text
QBO_CLIENT_ID=your_client_id
QBO_CLIENT_SECRET=your_client_secret
QBO_REDIRECT_URI=http://localhost:8080/auth/qbo/callback
QBO_ENVIRONMENT=sandbox
```

Use `sandbox` for testing with Intuit sample companies. Switch `QBO_ENVIRONMENT=production` when ready to use real client data; production apps require Intuit app review.

## Multi-Accounting Software Setup

The Preparation tab can pull reports from QuickBooks Online, Xero, FreshBooks, Wave, Zoho Books, Sage Intacct, and NetSuite through the unified Accounting Software panel. Manual upload is always available when a platform is not configured.

### Xero Setup

1. Go to `https://developer.xero.com` > My Apps > New App.
2. App type: Web app.
3. OAuth redirect URI: `http://localhost:8080/auth/accounting/xero/callback`.
4. Copy Client ID and Client Secret.
5. Add environment variables:

```text
XERO_CLIENT_ID=your_client_id
XERO_CLIENT_SECRET=your_client_secret
XERO_REDIRECT_URI=http://localhost:8080/auth/accounting/xero/callback
```

### Zoho Books Setup

1. Go to `https://api-console.zoho.com` > Add Client > Server-based Applications.
2. Authorized Redirect URI: `http://localhost:8080/auth/accounting/zoho_books/callback`.
3. Scopes: `ZohoBooks.reports.READ ZohoBooks.settings.READ`.
4. Add environment variables:

```text
ZOHO_CLIENT_ID=your_client_id
ZOHO_CLIENT_SECRET=your_client_secret
ZOHO_REDIRECT_URI=http://localhost:8080/auth/accounting/zoho_books/callback
```

### FreshBooks Setup

1. Go to `https://my.freshbooks.com/#/developer` and create an app.
2. Redirect URI: `http://localhost:8080/auth/accounting/freshbooks/callback`.
3. Scopes: `user:profile:read user:reports:read`.
4. Add environment variables:

```text
FRESHBOOKS_CLIENT_ID=your_client_id
FRESHBOOKS_CLIENT_SECRET=your_client_secret
FRESHBOOKS_REDIRECT_URI=http://localhost:8080/auth/accounting/freshbooks/callback
```

### Wave Setup

1. Create an app at `https://developer.waveapps.com`.
2. Redirect URI: `http://localhost:8080/auth/accounting/wave/callback`.
3. Add environment variables:

```text
WAVE_CLIENT_ID=your_client_id
WAVE_CLIENT_SECRET=your_client_secret
WAVE_REDIRECT_URI=http://localhost:8080/auth/accounting/wave/callback
```

### NetSuite Setup

1. In NetSuite, enable REST Web Services and Token-Based Authentication.
2. Create an integration and access token with financial report permissions.
3. Add environment variables:

```text
NETSUITE_ACCOUNT_ID=your_account_id
NETSUITE_CONSUMER_KEY=your_consumer_key
NETSUITE_CONSUMER_SECRET=your_consumer_secret
NETSUITE_TOKEN_ID=your_token_id
NETSUITE_TOKEN_SECRET=your_token_secret
```

NetSuite uses token-based authentication rather than browser OAuth.

### Sage Intacct Setup

1. Join Sage Developer Network and create API sender credentials.
2. Enable Web Services/API access in Intacct.
3. Add environment variables:

```text
INTACCT_SENDER_ID=your_sender_id
INTACCT_SENDER_PASSWORD=your_sender_password
INTACCT_CLIENT_ID=your_client_id
INTACCT_CLIENT_SECRET=your_client_secret
```

Sage Intacct uses XML API patterns and requires advanced setup.

## User Flow

1. Enter client/entity, tax year, return type, states, and review stage.
2. Upload files into Tax Returns, Workpapers, or Related Documents.
3. Mark tax return files as current-year, prior-year, or other return.
4. Add IRS/state instructions or firm references in the Knowledge Base when needed.
5. Add `User Review Notes / Specific Instructions`.
6. Run Senior Review.
7. Review structured findings.
8. Export the written review in native Word `.docx` format.

## Upload Boxes

| Box | Required? | What goes here | Examples |
| --- | --- | --- | --- |
| Tax Returns | Yes, at least one current-year return | Current-year return and prior-year return if available | Federal return, state returns, draft/final return, e-file copy |
| Workpapers | No, but recommended | Files prepared by tax/accounting to support the return | Excel workpapers, trial balance, general ledger, book-to-tax, M-1/M-2, depreciation, payments, apportionment |
| Related Documents | No | External or client-provided support that is not a workpaper | 1099s, K-1s, W-2s, notices, bank statements, brokerage statements, client documents |

## Validations

Blocking:

- Missing backend API key.
- No current-year tax return.
- More than 15 files.
- More than 64 MB total request size.

Warnings:

- No workpapers.
- No prior-year return.
- No user notes.
- Empty knowledge base.

## Claude Review Method

The review is based on four source groups:

1. Hidden firm master prompt and user notes.
2. Official IRS/state instructions from `knowledge_base/` or approved web research.
3. Uploaded tax returns, workpapers, and related documents.
4. Claude's general tax reasoning only when direct support is unavailable.

The hidden firm master prompt is stored in `senior-review-master-prompt.txt` and loaded by the backend. It is not editable by end users in the browser.

## Knowledge Base

Add official IRS/state instructions and firm reference material to the configured `KNOWLEDGE_BASE_DIR`, or upload them from the Reference Library panel in the app.

```text
knowledge_base/
```

Readable extensions:

- `.txt`
- `.md`
- `.csv`
- `.json`

The app can upload TXT, MD, CSV, JSON, DOCX, XLSX, PDF, and ZIP files into the Knowledge Base. DOCX, XLSX, PDF, and ZIP contents are converted/extracted to text before being stored.

## Review Examples

Add prior review comments and firm examples to the configured `REVIEW_EXAMPLES_DIR`.

```text
review_examples/
```

These are used only for tone and style. Claude is explicitly told not to treat examples as tax authority.

## Accepted Uploaded Formats

| Format | Handling |
| --- | --- |
| PDF | Sent to Claude as a native document block |
| Excel `.xlsx/.xls` | Parsed in the browser with SheetJS and sent as text |
| Word `.docx/.doc` | Parsed in the browser with mammoth.js and sent as text |
| CSV / TXT / JSON / MD | Sent as plain text |
| ZIP | Automatically extracted in the browser; readable inner files are reviewed |
| Other files | Sent as metadata only |

## Output Structure

Claude is instructed to return structured data internally so the app can render cards, show token/cost estimates, and export a readable Word review with:

- Executive Summary
- Document Summary
- Issues
- Missing Information
- Reviewer Comments
- Open Questions
- Final Conclusion

Each issue should include priority, area reviewed, form or schedule, issue description, evidence, why it matters, recommended action, reviewer comment, source, and needs more info.

## Token Controls

To keep Claude costs and rate-limit errors under control without cutting review information:

- PDF uploads are converted to extracted text before sending to Claude.
- ZIP uploads are extracted first; readable inner files are sent individually.
- The hidden master prompt, Knowledge Base, and review examples are marked with Anthropic prompt caching.
- Repeated reviews within the cache window can reuse stable prompt/context at cache-read pricing.
- Rate-limit fallback does not switch to a lower-limit model after a token-per-minute error.
- The app shows cache-read tokens after each review when Anthropic returns usage data.

## Project Files

```text
server.js          Backend: static server, validation, knowledge base, Claude call
app.js             Frontend: guided flow, file parsing, render, export
index.html         UI structure
styles.css         Product UI
knowledge_base/    Official/source context
review_examples/   Prior-review style examples
senior-review-master-prompt.txt Hidden firm review prompt
package.json       npm start
Dockerfile         Container deployment entrypoint
PRODUCTION.md      Production deployment checklist
```
