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
