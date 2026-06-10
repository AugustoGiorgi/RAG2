# RAG Tax — Companion Service

Servidor HTTP local en la PC del CPA. Recibe archivos desde el server remoto y los deposita en las carpetas de Drake para import con 3 clicks.

## Instalación

```bash
cd companion/
npm install
node companion.js
```

Escucha en `http://127.0.0.1:7777` (solo localhost).

## Variables de entorno

| Variable | Default | Descripción |
|---|---|---|
| `COMPANION_PORT` | 7777 | Puerto HTTP |
| `COMPANION_TOKEN` | `cambiar-este-token` | Token de autenticación (cambiar en producción) |
| `DRAKE_IMPORT_DIR` | `C:\DRAKE25\TB\` | Carpeta Trial Balance de Drake |
| `DRAKE_INSTALL_PATH` | auto-detect | Override path de instalación de Drake |

## Endpoints

| Método | URL | Descripción |
|---|---|---|
| GET | `/health` | Estado del companion + Drake instalado |
| GET | `/locate` | Detecta instalación de Drake |
| GET | `/setup/status` | Estado del setup (templates extraídos?) |
| POST | `/setup/extract-templates` | Extrae templates de Drake automáticamente |
| POST | `/import` | Recibe archivos y los deposita en Drake |

## Flujo de setup (una sola vez)

```
App server → POST /setup/extract-templates
Companion → abre Drake, navega Import > TB Import > Create New
Companion → guarda templates en templates/
Responde: { ok: true }
```

Si la extracción automática falla, el endpoint retorna instrucciones manuales.

## Flujo de producción

```
App server → POST /import  { software: "drake", files: [...] }
Companion → deposita archivos en C:\Drake26\TB\
CPA → Import > Trial Balance Import → Next → Finish  (3 clicks)
```

## Seguridad

- Solo escucha en `127.0.0.1`
- Header `X-Companion-Token` requerido en todos los POST
- Las credenciales de Drake nunca salen de la PC del CPA
