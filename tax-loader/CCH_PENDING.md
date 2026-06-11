# CCH Axcess Tax — Integración (pendiente de credenciales OIP)

La **lógica de la integración está construida y cableada**. Lo único que falta
es el contrato oficial de la API, que solo entrega Wolters Kluwer a través del
**Open Integration Platform (OIP)**. No se puede inventar: endpoints, OAuth,
scopes, forma de los requests, métodos HTTP ni los nombres de campos vienen de
la documentación oficial. Hasta cargarlos, las guardas del adaptador bloquean
cualquier llamada en vivo a propósito.

## Lo que ya está hecho (código)

- `adapters/cchAxcessAdapter.js` — flujo completo: auth → buscar/crear cliente →
  crear declaración → cargar inputs → leer diagnostics.
- `config/cchEndpoints.js` — configurable 100% por variables de entorno.
- `fieldMaps/cch_axcess_{1040,1065,1120,1120S}.json` — estructura lista; faltan
  los valores `form`/`field`/`line`.
- Cableado en la app:
  - `GET  /api/cch/status` — reporta qué falta para activar la integración.
  - `POST /api/cch/push-return` — recibe un CanonicalReturn `{ client, taxYear, fields[] }`
    (por ejemplo lo que normaliza QBO) y lo empuja a CCH. Devuelve 503 con la lista
    de faltantes mientras no esté configurado.

## Lo que tenés que conseguir vos (gated detrás de la licencia OIP)

### 1. Acceso al OIP
- [ ] La firma debe tener licencia de CCH Axcess + acceso al **Developer Portal**
      del Open Integration Platform (Wolters Kluwer).
- [ ] Crear la app en el portal y obtener **Client ID** y **Client Secret**
      (y API Key si aplica).

### 2. Variables de entorno (Render → Environment, o `.env` local)
Copiar los valores **de la documentación oficial del OIP**:

```
CCH_BASE_URL=
CCH_OAUTH_TOKEN_PATH=
CCH_OAUTH_GRANT_TYPE=
CCH_OAUTH_SCOPES=
CCH_CLIENTS_SEARCH_PATH=
CCH_CLIENTS_CREATE_PATH=
CCH_RETURNS_CREATE_PATH=
CCH_RETURN_INPUT_PATH=
CCH_RETURN_INPUT_METHOD=
CCH_DIAGNOSTICS_PATH=
CCH_CLIENT_ID=
CCH_CLIENT_SECRET=
CCH_API_KEY=          # solo si el OIP lo requiere
```

### 3. Field maps (diccionario de campos)
Completar en `fieldMaps/cch_axcess_{entidad}.json` el `form`/`field`/`line` de
cada clave canónica, según la referencia de campos del OIP. Al terminar cada
archivo, poner `"_verified": true` — `/api/cch/status` no marca la integración
como lista hasta que los cuatro estén verificados.

### 4. Confirmar la forma del request body
El adaptador hoy envía `{ fields: [{ form, field, line, value, canonicalKey }] }`
a `CCH_RETURN_INPUT_PATH`. **Verificar contra la doc oficial** si ese es el shape
que CCH espera; si no, ajustar `prepare()` en `cchAxcessAdapter.js`. No se asumió
un formato distinto para no inventar el contrato.

## Cómo verificar cuando esté todo cargado

```
GET /api/cch/status   →  { "configured": true, "missingEnv": [], "unverifiedFieldMaps": [] }
```

Recién cuando `configured: true`, `POST /api/cch/push-return` ejecuta el push real.
