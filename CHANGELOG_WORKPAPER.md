# Registro de cambios — Generación de Workpaper

Este archivo documenta los cambios hechos sobre la generación de workpapers, para
poder revertir fácilmente si algo deja de funcionar.

> Para revertir un cambio puntual: `git revert <hash>` (crea un commit que deshace ese cambio sin borrar historial).
> Para volver a un punto anterior completo: `git checkout <hash> -- server.js app.js` y commitear.

---

## 2026-06-17 / 2026-06-18 — Fix: el workpaper usaba datos del año anterior

Síntoma: al preparar 2025, el workpaper salía con los números de 2024 (solo cambiaba
la etiqueta del año). Causa final: la respuesta de Claude se truncaba por falta de
tokens y el servidor caía en un fallback que copiaba el workpaper anterior.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `ce9033c` | server.js | Primer intento: detección de rol por año en `detectPreparationFileRole` | `git revert ce9033c` |
| `74870a8` | server.js | Regex `workpapers?` (plural) + headers de bloque por rol en `buildPreparerContent` | `git revert 74870a8` |
| `5382f58` | server.js | `reconcilePreparationYear()`: toma el año más nuevo de los nombres de archivo (corrige el campo oculto `prepCurrentYear=2024` stale) | `git revert 5382f58` |
| `cab3d3e` | server.js | Strip de montos del workpaper anterior antes de mandarlo a Claude (`stripAmountsFromTemplate`, `csvTextFromTemplates`, etc.) | `git revert cab3d3e` |
| `28948ef` | server.js | **Fix raíz**: subir `maxTokens` 20000→48000 (thinking 10000→6000); fallback seguro (borra montos + advertencia); diagnóstico "engine v4" en pestaña AI Notes | `git revert 28948ef` |

Resultado verificado en output 19: 10 hojas generadas por AI, números 2025 reales,
"AI-generated workbook used", "not truncated".

---

## 2026-06-18 — Feature: fórmulas de Excel en el workpaper

Objetivo: que los montos base sean numéricos (hoy son texto) y que totales/subtotales/
diferencias/tie-outs sean fórmulas, para que al editar un monto se recalculen solos.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `bf8d77d` | app.js + server.js | `downloadWorkbook`: coerciona montos a números reales (`coerceWorkpaperCell`) y convierte strings `=...` en celdas fórmula de Excel (`isWorkpaperFormula`). Prompt de `buildPreparerContent`: instruye a Claude a emitir fórmulas A1 en celdas derivadas (totales/subtotales/diferencias/tie-outs) y montos base como números. | `git revert bf8d77d` |

> Si las fórmulas dan referencias mal calculadas y preferís volver al comportamiento anterior (solo texto, sin fórmulas), revertí `bf8d77d`. El resto de los fixes (datos 2025 correctos) quedan intactos.

### Fix de fórmulas (continuación)

Síntoma del output 20: los totales aparecían VACÍOS y no había fórmulas en el archivo.
Causa: SheetJS **descarta** las celdas que tienen fórmula pero no tienen valor cacheado
(`v`) al escribir el xlsx. El frontend creaba las celdas fórmula sin `v`, así que cada
total se perdía.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `d8956e4` | app.js + server.js | `evaluateWorkpaperFormula` + `safeEvalArithmetic` calculan el valor de las fórmulas SUM/aritmética y lo guardan como `v` (sino SheetJS las descarta). Prompt reducido: fórmulas SOLO en subtotales/totales (SUM). | `git revert d8956e4` |

Verificado: subtotal `=SUM(B2:B5)` y total `=B6+B7` sobreviven al round-trip
write→read con los valores correctos y siguen siendo fórmulas vivas (editás un monto y
Excel recalcula).

---

## 2026-06-18 — ROLLBACK de fórmulas

Las fórmulas no funcionaban como se esperaba en el uso real, así que se revirtió TODA
la feature de fórmulas. `app.js` y `server.js` se restauraron al estado del commit
`28948ef` (el output 19, que funcionaba: datos 2025 correctos, generado por AI, sin
truncamiento, celdas de texto sin fórmulas).

- Se eliminó del frontend: `coerceWorkpaperCell`, `isWorkpaperFormula`,
  `parseWorkpaperAmount`, `evaluateWorkpaperFormula`, `safeEvalArithmetic` y la inyección
  de fórmulas en `downloadWorkbook` (vuelve a usar `sanitizeExcelCell`).
- Se eliminó del prompt del server el bloque de fórmulas (vuelve a "Do not include
  formulas unless obvious and safe").

Los fixes de datos (datos 2025 correctos, reconciliación de año, fallback seguro,
diagnóstico engine v4) **se mantienen intactos**. La feature de fórmulas queda en el
historial (`bf8d77d`, `d8956e4`) por si se retoma más adelante con otro enfoque.

---

## 2026-06-18 — Fix: generación inestable (a veces "0 hojas" → fallback en blanco)

Síntoma (output 22): con el mismo código que generó bien el output 19, a veces Claude
devolvía "AI returned 0 sheet(s); TEMPLATE FALLBACK USED" (esqueleto en blanco con
advertencia), aunque la respuesta NO estaba truncada.

Causa: `parseClaudeJson` agarraba el PRIMER bloque JSON que parseaba. Cuando Claude
escribe un fragmento de ejemplo (o el thinking filtra uno) antes del workbook real, ese
fragmento ganaba → 0 hojas → fallback.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `38a9065` | server.js | `parseWorkpaperJson`: entre todos los bloques JSON parseables, elige el que realmente contiene hojas usables (no el primer fragmento). Usado en `handlePrepareWorkpaper`. | `git revert 38a9065` |

Verificado: con un fragmento señuelo antes del workbook real, ahora elige el workbook real.

Nota sobre el error 504: es un timeout del proxy del VPS (nginx) cuando la generación
tarda más que `proxy_read_timeout`. Es intermitente y no se arregla desde el código; el
fix durable es subir ese timeout en el VPS (a ~300s). Este fix de parseo asegura que
cuando la llamada SÍ completa, se entregue el workbook real en vez del fallback.

---

## 2026-06-18 — Feature: botón "Add from Google Drive" en todas las secciones de carga

Antes solo el tab Deliverable mostraba Drive funcionando. Causa: los botones genéricos
(`.drive-upload-btn`) estaban ocultos hasta `status.connected`, y faltaban 3 zonas activas.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `3c07119` | app.js | (1) Registradas 3 zonas nuevas en `setupDriveUploadButtons`: `presentation`, `calculation`, `estimated-reviewed-workbook`. (2) Entradas en `DRIVE_ZONE_CONFIG` y ramas en `addFilesToZone` para esas zonas. (3) `refreshDriveStatus` ahora muestra los botones cuando Drive está **enabled** (no solo connected). (4) `openDriveForZone` dispara la conexión si no está conectado. | `git revert 3c07119` |
| `3c07119` | index.html | `data-drive-button-host` en la caja de reviewed-workbook para ubicar bien el botón. | (incluido en el mismo commit) |

Zonas que ya tenían Drive (sin cambios): review, prep-package, knowledge, examples, notice,
notice-prior-return, diagnostics, estimated (zonas principales), deliverable.
Inputs legacy/ocultos sin handler (no se tocan): taxReturns/workpapers/documents,
prepPriorWorkpaper/prepFinancialReports, organizerPriorReturn.

---

## 2026-06-18 — Fix: error 504 en Review (y Workpaper) por timeout del proxy

Síntoma: el tab Review fallaba con "Backend returned 504" (también el workpaper antes).
Causa: el proxy del VPS (nginx) corta la conexión si la generación de Claude tarda más
que `proxy_read_timeout` (~60s). Reviews/workpapers grandes tardan más → 504. No se puede
arreglar desde el VPS (sin acceso).

Fix (heartbeat / keep-alive, sin tocar el VPS): el server manda 200 + headers enseguida y
escribe un espacio cada 15s mientras Claude trabaja, con `X-Accel-Buffering: no` para que
nginx no buffere. `JSON.parse` ignora los espacios iniciales, así que el cliente parsea el
JSON final normalmente. Verificado con un round-trip HTTP real.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `8c08346` | server.js | `startHeartbeatResponse` / `endHeartbeatResponse`; aplicados a `handleReview` y `handlePrepareWorkpaper` (envuelven la llamada larga a Claude). | `git revert 8c08346` |
| `8c08346` | app.js | Como el heartbeat siempre responde 200, `requestClaudeReview` y `runPreparerWorkflow` ahora detectan `error` en el body aunque el status sea 200. | (mismo commit) |

---

## 2026-06-18 — Feature: sección de respuestas a Instructions / Client Facts en la review

Pedido: al inicio de la review, debajo de "ISSUES & ITEMS TO REVIEW SUMMARY", una sección
que responda las preguntas/afirmaciones de "Client Facts / Expected Information" y "User
Review Notes / Specific Instructions".

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `d27c2b5` | server.js | Schema de review: nuevo campo `instructionResponses` ([{prompt, response, status}]). Prompt: instruye a Claude a responder cada nota/fact. `normalizeDirectReview` normaliza el campo. | `git revert d27c2b5` |
| `d27c2b5` | app.js | `normalizeReviewForExport` incluye `instructionResponses` (+ helper `normalizeInstructionResponses`). `toCleanWrittenReview` renderiza la sección "RESPONSES TO INSTRUCTIONS & CLIENT FACTS" debajo del summary (aparece en memo en pantalla, .txt y .docx). | (mismo commit) |

---

## 2026-06-18 — Fix: Misc Calculations no podía leer PDFs escaneados/imagen

Síntoma: en Misc Calculations, un PDF sin capa de texto ('Tax summary.pdf') daba "No fue
posible extraer el contenido legible del archivo". Causa: la extracción de texto (cliente
con pdf.js y servidor con regex) falla en PDFs escaneados/imagen.

Fix: `buildUploadedFileContext` ahora adjunta los PDFs como bloques `document` (base64), y
`buildCalculationContent` los envía a Claude, que lee PDFs nativamente (incluso escaneados,
vía visión). El prompt aclara que debe leer los documentos/imágenes adjuntos directamente y
nunca decir que un archivo es ilegible si está adjunto.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `f24ac78` | server.js | `buildUploadedFileContext` recolecta `documents` (PDFs base64); `buildCalculationContent` emite bloques `document`; prompt de calculation instruye a leer adjuntos directamente. | `git revert f24ac78` |

---

## 2026-06-18 — Fix (real) botones de Google Drive en TODAS las tabs

Causa raíz encontrada: los botones hardcodeados de Estimated/Deliverable tienen clase
`ghost-button` (siempre visibles), mientras que los botones genéricos (`drive-upload-btn`)
solo se mostraban cuando `status.enabled` era true. En el setup del usuario `enabled` es
false, así que solo aparecían Estimated y Deliverable.

Fix: los botones genéricos ahora son **siempre visibles** (igual que los hardcodeados), sin
gating por `enabled`/`connected`. Si no está conectado, al hacer click se dispara la
conexión (`openDriveForZone`). Además `refreshDriveStatus` re-ejecuta `setupDriveUploadButtons()`
(idempotente) para garantizar que el botón exista en cada sección.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `32f3f44` | app.js | `addDriveButtonAfterInput` crea el botón visible (no `display:none`). `refreshDriveStatus` re-crea los botones y los mantiene `inline-flex` siempre (sin gating por `enabled`). | `git revert 32f3f44` |

Secciones cubiertas: Review, Preparer, Presentation, Calculation, Estimated (zonas + reviewed
workbook), Notice (doc + prior return), Diagnostics, Knowledge, Examples, Deliverable.

---

## 2026-06-18 — Fix: review volcaba JSON crudo y no detectaba errores (truncamiento)

Síntoma: el review dejó de armar el Word formateado y copiaba el JSON crudo; no mostraba
issues. Causa real (verificada): la respuesta de Claude se **truncaba** — `REVIEW_MAX_TOKENS`
era 8000, y un review grande (Creative Child Care: 7 archivos, 1120 + Texas) generó ~28.000
caracteres y se cortó a la mitad ("Unterminated string"). El JSON incompleto no parseaba →
caía al rawFallback (vuelca el JSON). NO fue el feature instructionResponses (estaba vacío
en ese review); el review es grande de por sí.

Fix:
1. `REVIEW_MAX_TOKENS` 8000 → 24000 (el heartbeat ya evita el 504 con generaciones largas).
2. Revertido el feature `instructionResponses` (a pedido del usuario, volver a antes del
   cambio d27c2b5): quitado del schema, prompt, `normalizeDirectReview`,
   `normalizeReviewForExport`, el helper y la sección en `toCleanWrittenReview`.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| `689be77` | server.js, app.js | Sube REVIEW_MAX_TOKENS a 24000; revierte instructionResponses. | `git revert 689be77` |

---

## 2026-06-18 — Feature: favicon (Google) + fix meta description

Tarea 1: favicon para que aparezca en Google. Tarea 2: el snippet de Google mostraba
"AIAI-powered... WPAutomated..." porque NO había meta description y Google scrapeaba el
texto visible de la login (badges de íconos "AI"/"WP" + label pegados).

Favicons generados desde `assets/rag-r-logo.png` (220x220) con Pillow → `assets/icons/`:
favicon-48/96/144/192.png (cuadrados, múltiplos de 48), apple-touch-icon.png (180, sin
transparencia), favicon.ico (16/32/48). Servidos en rutas raíz estables y PÚBLICAS
(`/favicon-48.png`, `/favicon.ico`, `/apple-touch-icon.png`, etc.) vía `serveFavicon` antes
del gate de auth, para que el crawler de Google los pueda leer sin login.

Fix meta: agregado `<meta name="description">` limpio + Open Graph en el `<head>` de la
login page (server.js `buildLoginPage`) e `index.html`. No había JSON-LD. Title ya estaba
limpio. No hay robots.txt que bloquee.

| Commit | Archivo | Qué cambió | Cómo revertir |
|---|---|---|---|
| _(pendiente)_ | server.js, index.html, assets/icons/* | Rutas públicas de favicon + tags en head + meta description/OG. | `git revert <hash>` |

Verificado con server local: los 6 favicons devuelven 200 sin auth; login page tiene el
meta description y los link tags.
