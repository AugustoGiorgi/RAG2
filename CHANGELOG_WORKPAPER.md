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
