# Pendiente para funcionamiento completo de QBO

## Setup de la app en Intuit (vos, una sola vez)
- [ ] Crear cuenta en developer.intuit.com
- [ ] Crear la app "RAG Tax AI" → seleccionar "QuickBooks Online and Payments"
- [ ] Copiar Client ID → `QBO_CLIENT_ID` en .env del servidor
- [ ] Copiar Client Secret → `QBO_CLIENT_SECRET` en .env del servidor
- [ ] Agregar redirect URIs en el Developer Portal:
      - `http://localhost:3000/auth/qbo/callback` (desarrollo)
      - `https://rag-prueba-web.onrender.com/auth/qbo/callback` (producción)
- [ ] Agregar `TOKEN_ENCRYPTION_KEY` en .env (generar con crypto.randomBytes(32))

## Para producción con Intuit
- [ ] Completar el App Assessment de Intuit (revisión manual antes de cuentas reales)
- [ ] Cambiar `QBO_ENVIRONMENT=production` en .env de producción
- [ ] Actualizar redirect URI en el Developer Portal a la URL de producción

## Flujo del cliente (una sola vez por cliente)
1. El CPA hace click en "Connect QuickBooks" en el panel Preparer
2. Se abre una ventana de Intuit → el CPA aprueba el acceso
3. Intuit llama a `/auth/qbo/callback` → los tokens se guardan en `data/qbo_tokens.json`
4. El panel muestra "QuickBooks conectado — [Nombre de la empresa]"
5. El CPA selecciona la empresa, el período y los reportes
6. Click "Pull Selected Reports" → se descargan y normalizan automáticamente

## Normalización de datos
- `dataNormalizer.js` mapea nombres de cuentas QBO a claves canónicas
- Los nombres varían por cliente (cada uno configura su QBO diferente)
- Todos los campos importados tienen flag "review" — el CPA confirma antes de usar
- Para mejorar precisión: usar el Chart of Accounts de cada cliente para mapeo fino

## Endpoint disponible
POST /api/qbo/fetch-financials
Body: { realmId, taxYear, entityType }
Returns: CanonicalReturn con fields[] marcados "review"
