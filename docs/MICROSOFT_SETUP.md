# Outlook and OneDrive (RAG USA)

Google's credentials, approved scopes, accounts and recovery-email sender are unchanged.
Microsoft is an optional, separate delegated connection. With missing Microsoft credentials
or a missing token-encryption key, Microsoft upload buttons and new Outlook selections are
hidden/disabled, so existing users retain the Google-only experience. Direct connection attempts
show a configuration message instead of starting OAuth. An explicitly selected Outlook sender is
never silently replaced with Gmail if configuration becomes unavailable. Argentina is not changed.

## App Registration

1. Open https://entra.microsoft.com/ with an account in a directory controlled by RAG,
   not an unrelated employer's directory. The account needs permission to register apps.
2. Entra ID > App registrations > New registration. Name: `RAG Tax AI`.
3. Supported accounts: **Accounts in any organizational directory and personal Microsoft
   accounts**. This supports Microsoft 365 business accounts and Outlook/Hotmail personal accounts.
4. Platform: **Web**. Redirect URI, exactly:
   `https://ragtax-ia.com/auth/microsoft/callback`.
   Do not use Single-page application, implicit grant, or public client flows.
5. Record the Application (client) ID. Create a client secret in Certificates & secrets,
   recording its **Value**, not its Secret ID. Deliver it through a secure local/server
   configuration channel, never a chat message, tracked file or GitHub commit.
6. Microsoft Graph permissions must be **Delegated**, not Application. Remove the default
   `User.Read` if unused. The app requests permissions incrementally as described below;
   use the same set in the registration. An organization's own admin-consent policies can
   still require its administrator's approval.
7. Configure the application's branding, RAG-owned publisher domain, privacy policy
   `https://ragtax-ia.com/privacy`, and terms `https://ragtax-ia.com/terms`. Publisher
   verification/tenant policies may affect which customers can grant consent.

Official instructions: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app

### Publisher Domain

After setting `MICROSOFT_CLIENT_ID` on the server, Branding & properties > Publisher
domain > Verify a new domain can verify `ragtax-ia.com`. The public endpoint
`https://ragtax-ia.com/.well-known/microsoft-identity-association.json` exposes only
the configured public application ID. With no configured ID, its application list is empty.
Do not expose the client secret or token cache in this document.

Domain verification is not Microsoft publisher verification (the verified badge).
The latter requires a verified Microsoft AI Cloud Partner Program account. External
organizations can require administrator consent or block unverified publishers;
do not weaken their consent policies to bypass this requirement.
See https://learn.microsoft.com/en-us/entra/identity-platform/howto-configure-publisher-domain
and https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview.

## Server Configuration

Set these in the existing protected USA environment file, not in Argentina:

```dotenv
MICROSOFT_CLIENT_ID=<application-client-id>
MICROSOFT_CLIENT_SECRET=<secret-value>
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://ragtax-ia.com/auth/microsoft/callback
```

The existing `TOKEN_ENCRYPTION_KEY` is required. **Do not replace it**: doing so would
invalidate existing encrypted integrations. Restart only the USA service with its
environment refreshed (the VPS deploy script already sources the USA `.env`).

For localhost development register a separate exact Web redirect and set
`MICROSOFT_REDIRECT_URI=http://127.0.0.1:<port>/auth/microsoft/callback`.

## Permissions and Data Boundaries

- Connecting/browsing/importing OneDrive files: `Files.Read`.
- Creating the optional firm's review folder and saving Word reviews: `Files.ReadWrite`,
  only when a firm administrator selects OneDrive storage. Personal connections are not
  automatically shared. The configured review-folder owner must remain active in the firm.
- Sending reviewed emails: `Mail.Send`. RAG uses `/me/sendMail`; a client cannot impersonate
  another sender. Microsoft returns `202 Accepted`, not guaranteed delivery.
- Large messages/attachments: incremental `Mail.ReadWrite` plus `Mail.Send` to create a
  draft and upload attachments. The app asks via a separate explicit button; no automatic
  resending. An upload failure can leave an unsent draft, reported to the user.
- MSAL adds identity/session scopes (`openid`, `profile`, `offline_access`); the app adds
  `email`. It does not request `Files.ReadWrite.All`, `Sites.*` or application permissions.
- Delegated file permissions are broader than Google's `drive.file`: Microsoft consent
  authorizes the user's OneDrive read access; the app UI imports only explicitly selected
  files. Organization policies and actual item ACLs still apply. Shortcuts to other drives
  and SharePoint site libraries are not supported by this first version.
- Authorization uses PKCE, nonce, single-use ten-minute state bound to the current RAG
  session. Only the popup navigates away. Expired sessions require a new sign-in.
- A per-attempt marker allows the app to detect completed authorization through its
  authenticated status endpoint when Microsoft severs `window.opener`. Grants from a
  different attempt cannot resume a pending action.
- New personal accounts may need to open OneDrive on Microsoft's website once before
  their storage is available. Personal downloads can use the exact Microsoft Graph
  redirect host `my.microsoftpersonalcontent.com`; Graph bearer tokens are never sent there.
- MSAL caches are AES-256-GCM encrypted per RAG username, in
  `DATA_DIR/microsoft-tokens/<sha256-of-username>.json`, with private directory/file modes
  and atomic per-user writes. Tokens never go to the browser. Back up that directory with
  the existing protected `DATA_DIR` backups and preserve the encryption key separately.
- Cache write locks and OAuth state are local to one USA process, like the current
  deployment. Multi-process/multi-server deployment requires a shared encrypted cache
  and OAuth-state store first. This change does not make that deployment distributed.
- Imports: 25 MB/file, 50 MB combined per picker import. Emails: 25 MB total attachments,
  at most 25 attachments. No send retries after an ambiguous network failure.
- Disconnect deletes only the current user's local Microsoft cache, not Microsoft files,
  emails or Google's connection. To revoke consent in Microsoft too, use the account's
  connected-app management screen.

## Acceptance Test

1. Sign in to an ordinary USA user. Confirm Google Picker/Gmail still work with their
   existing account. No new Google permissions should appear.
2. On any upload zone choose Add from OneDrive. Complete Microsoft consent in the popup.
   Navigate a folder, select a supported file, import it, and confirm the loading state
   remains until it appears in the workspace. Check root navigation, search and pagination.
3. In Deliverable, Estimated Taxes and Database client requests, choose Outlook under
   Send with. Confirm the sender shown is the intended Microsoft account. Review the
   recipient, CC, body and attachments. Send a test email only to an inbox you control.
   Check both recipient Inbox and the source account's Sent Items.
4. Repeat with a large test attachment. Grant the additional Outlook permission only from
   the explicit large-attachment button, then review and send again. Check errors without
   automatically retrying, to avoid duplicate sends.
5. As firm admin, choose OneDrive in Review storage, connect with write permission and
   create the review folder. Download a review from another user in that same firm and
   confirm its extra cloud copy. Another firm must not access that folder configuration.
6. Test a separate user/account, revoke or disconnect one, then confirm the other's
   Microsoft connection and all Google connections remain intact.

Automated unit tests: `node --test test/microsoft-*.test.js`.
Browser smoke test (uses synthetic accounts and mocked Graph responses, not real sends):
`node scripts/microsoft-ui-smoke.cjs`, with `PLAYWRIGHT_MODULE` pointing to Playwright when
not installed in this checkout. A Chrome installation is needed. Real Microsoft consent,
tenant policies, refresh and delivery still require a live registered-app test.
