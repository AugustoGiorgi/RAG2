# Conexión con QuickBooks Online y Xero (OAuth 2.0)

Integración OAuth 2.0 multi-tenant **por usuario** para QuickBooks Online y Xero,
dentro de la tab **Preparer**. Los tokens se guardan encriptados (AES-256-GCM) por
usuario; el `client_secret` y los tokens **nunca** se exponen al browser.

## Cómo funciona para el usuario (cliente del firm)
1. En la tab **Preparer**, sección "Connected Accounting Software": botones
   **Connect QuickBooks** y **Connect Xero**.
2. Al hacer click se abre el login oficial de Intuit/Xero → el usuario autoriza.
3. La conexión queda guardada y persiste entre logins (los tokens se refrescan solos).
4. Para extraer datos, el usuario elige en el panel:
   - **Empresa/cliente** (de las que conectó),
   - **Período** (presets año actual / anterior / Q / YTD / custom),
   - **Método** (Cash / Accrual),
   - **Reporte(s)** (P&L, Balance Sheet, Trial Balance, General Ledger, etc.),
   y aprieta **Pull Selected Reports**.

## Lo que tenés que hacer vos (una sola vez) — pasos manuales

### A) QuickBooks Online — developer.intuit.com
1. Crear/loguear cuenta de developer y **crear una app** (QuickBooks Online and Payments).
2. En **Keys & credentials** copiar **Client ID** y **Client Secret**
   (usá las de **Development/Sandbox** para probar; las de **Production** para clientes reales).
3. En **Redirect URIs** agregar EXACTAMENTE:
   - `https://rag-prueba-web.onrender.com/auth/accounting/quickbooks/callback`
   - `http://localhost:8080/auth/accounting/quickbooks/callback` (para desarrollo)
4. Scope: **Accounting** (`com.intuit.quickbooks.accounting`).

### B) Xero — developer.xero.com
1. **My Apps → New app** (tipo "Web app").
2. Copiar **Client ID** y generar/copiar **Client Secret**.
3. En **Redirect URIs** agregar EXACTAMENTE:
   - `https://rag-prueba-web.onrender.com/auth/accounting/xero/callback`
   - `http://localhost:8080/auth/accounting/xero/callback` (para desarrollo)
4. Scopes: `openid profile email accounting.reports.read accounting.settings.read offline_access`
   (el `offline_access` es obligatorio para obtener refresh token).
5. Para probar usá la **Demo Company** del sandbox de Xero.

### C) Variables de entorno (Render → Environment, o `.env` local)
Ver `.env.example`. Las mínimas:
```
TOKEN_ENCRYPTION_KEY=  (64 hex — genera una y NO la cambies después, o los tokens guardados dejan de desencriptarse)
AUTH_SECRET=           (32+ chars — firma el "state" OAuth contra CSRF)
QBO_CLIENT_ID=         QBO_CLIENT_SECRET=         QBO_ENVIRONMENT=sandbox
QBO_REDIRECT_URI=https://rag-prueba-web.onrender.com/auth/accounting/quickbooks/callback
XERO_CLIENT_ID=        XERO_CLIENT_SECRET=
XERO_REDIRECT_URI=https://rag-prueba-web.onrender.com/auth/accounting/xero/callback
```

> La **redirect URI de la variable de entorno** y la **registrada en el portal**
> deben coincidir EXACTO (incluido `https`, dominio y path), o el login falla con
> `redirect_uri_mismatch`.

## Detalles de seguridad ya implementados
- Tokens encriptados en reposo (AES-256-GCM con `TOKEN_ENCRYPTION_KEY`).
- `client_secret` y tokens nunca viajan al browser.
- Parámetro `state` **firmado con HMAC** (previene CSRF / login-CSRF).
- **Refresh automático**: QBO (~1 h) y Xero (~30 min) se refrescan antes de vencer.
  Xero **rota el refresh token** en cada uso → se guarda siempre el nuevo.
- **Reintento ante 401**: si el token vence justo en medio de una llamada, refresca
  y reintenta una sola vez (sin loops).
- **Desconexión del lado del cliente** (revocó la app, o venció por inactividad —
  QBO 100 días / Xero 60): se detecta `invalid_grant`, se marca la conexión como
  "desconectada - reconectar" y se muestra de nuevo el botón Connect.
- **Disconnect** llama al endpoint de **revocación oficial** del proveedor además de
  borrar el token local.

## Probar contra sandbox
1. Cargá las variables (sandbox) y reiniciá la app.
2. Tab Preparer → **Connect QuickBooks** / **Connect Xero** → autorizá con la
   sandbox/demo company.
3. Elegí empresa + período + reportes → **Pull Selected Reports**.

> Nota: el round-trip real del login solo se puede probar con las credenciales ya
> registradas (paso A/B). Sin ellas, la app muestra "Setup required" en el botón.
