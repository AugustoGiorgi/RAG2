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
ENABLE_CLAUDE_WEB_SEARCH=false
CLAUDE_WEB_SEARCH_MAX_USES=3
CLAUDE_WEB_ALLOWED_DOMAINS=irs.gov,ftb.ca.gov,tax.ny.gov
GOOGLE_REDIRECT_URI=https://your-production-domain.com/auth/google/callback
GOOGLE_OAUTH_SCOPES=https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.compose
ENABLE_GMAIL_SEND=false
```

## Runtime Endpoints

```text
GET /healthz
GET /api/config
POST /api/review
GET /
```

Use `/healthz` for hosting health checks.

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
- Use `gmail.compose` for Gmail draft creation. Enable direct Gmail sending only after adding `gmail.send` and completing any required Google verification.
