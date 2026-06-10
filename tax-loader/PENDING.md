# PENDING — RAG Tax Drake Loader v2.1

Items marcados con 🔴 son **bloqueantes** para producción.
Items marcados con 🟡 son necesarios pero el sistema funciona sin ellos en modo degradado.
Items marcados con 🟢 son mejoras opcionales.

---

## ✅ Templates de Drake — COMPLETADO

Los templates de Drake fueron extraídos, convertidos a .xlsx (ExcelJS-compatible) y verificados.

- [x] `drake_tb_1120S_template.xlsx` — S-Corp (extraído de `SBSTEMP.TBI`, convertido via Excel COM)
- [x] `drake_tb_1065_template.xlsx` — Partnership (extraído de `PTRTEMP.TBI`, convertido)
- [x] `drake_tb_1120_template.xlsx` — C-Corp (extraído de `CRPTEMP.TBI`, convertido)
- [x] Templates en `templates/` — DrakeLoader los detecta automáticamente
- [x] Verificado: `generateOnly()` usa templates reales (no modo sintético)

**Estructura verificada (idéntica en los 3 templates):**
- Row 1 col B → Company Name | Row 3 col B → Year End
- Row 5: headers (col C = Account Title, col E = Debit, col H = Credit)
- Data rows start at Row 7 (1120S/1065) / Row 8 (1120)
- Sheet names: "SBS TB" (1120S) / "PTR TB" (1065) / "Corp TB" (1120)

**Config actualizada:** `config/drakeFormat.js` apunta a `templates/*.xlsx`.

---

## ✅ Verificación de column order — Form 8949 — COMPLETADO

**Fuente:** `C:\DRAKE25\HELP\DRAKEHLP.CHM` → `form-8949-import-gruntworx-trade.htm` + `IMPORTD.DLL` strings

- [x] 40 columnas en orden exacto verificado contra DRAKEHLP.CHM
- [x] Fechas: **MMDDYYYY** (8 dígitos sin separadores) — confirmado por docs Drake
- [x] Box codes: 1=BoxA/D | 2=BoxB/E | 3=BoxC/F (no A/B/C)
- [x] `generators/form8949Generator.js` actualizado
- [x] Tests actualizados: `01152024` (era `01/15/2024`)

**Columnas clave (orden verificado):**
TSJ, F, State, City, Form_8949_Box(1/2/3), Description, Date_Acquired(MMDDYYYY),
Date_Sold(MMDDYYYY), Type(S/L), Ordinary, Proceeds, Cost, AMT_Cost_Basis,
Accrued_Discount, Wash_Sale_Loss, US_Real_Property, Adj_1_Code..Adj_3_AMT,
Fed_WH, Loss_Not_Allowed, Collectibles, QSBS_Code, QSBS_Amount,
State_1..State_2_WH, State_Use_Code, State_Adjustment, State_Cost_Basis, LLC_Number

---

## ✅ Verificación de column order — Form 4562 — COMPLETADO

**Fuente:** `IMPORT4562.DLL` strings (secuencia de nombres exacta extraída de la memoria del DLL)

- [x] 23 columnas federales core en orden exacto
- [x] Columnas exactas: `Description, Date_Acquired, Cost_Basis, Business_Use, Used_Property, Listed_Prop_Type, Property_Type, Building_Qualifies_for_Section_1263, Method, Life, Prior_depreciation, Salvage_value, Override_regular_depreciation, SEC179_expense_elected_this_year, ...`
- [x] Distingue `Date_Acquired` (col 2) de `Date_placed_in_service` (col 23)
- [x] `generators/form4562Generator.js` actualizado con headers exactos Drake
- [x] Template oficial disponible en: https://support.drakesoftware.com/Import4562

---

## ✅ Rutas de Drake para 8949 y 4562 (companion) — COMPLETADO

Verificado vía extracción de strings de `IMPORTD.DLL` + `IMPORT4562.DLL`:

```js
paths: {
  trialBalance: "C:\\DRAKE25\\TB\\",      // SBSTEMP.TBI source
  form8949:     "C:\\DRAKE25\\IMPORT\\",  // IMPORTD.DLL confirmed
  form4562:     "C:\\DRAKE25\\IMPORT\\",  // IMPORT4562.DLL confirmed
  scheduleC:    "C:\\DRAKE25\\IMPORT\\",
}
```

`companion/companion.js` actualizado con estas rutas.

---

## 🟡 Field maps — drakeSection/drakeLine reales

Los field maps actualmente tienen `"drakeSection": "PENDING"` y `"drakeLine": "PENDING"`. Estos valores se usan como metadata/referencia pero **no bloquean** el Trial Balance import (que usa account title matching, no section/line numbers).

- [ ] Completar `fieldMaps/drake_1120S.json` con los valores reales del template
- [ ] Completar `fieldMaps/drake_1065.json`
- [ ] Completar `fieldMaps/drake_1120.json`
- [ ] Actualizar `_verified: true` cuando estén completos

---

## 🟡 Field maps CCH Axcess

Requieren credenciales del CCH Axcess Developer Portal (Wolters Kluwer Open Integration Platform).

- [ ] `fieldMaps/cch_axcess_1040.json` — form/field/line reales
- [ ] `fieldMaps/cch_axcess_1065.json`
- [ ] `fieldMaps/cch_axcess_1120.json`
- [ ] `fieldMaps/cch_axcess_1120S.json`
- [ ] `config/cchEndpoints.js` — baseUrl, OAuth, paths reales

---

## 🟡 Workpaper Generator (app existente)

Para que el pipeline funcione end-to-end, el workpaper debe tener:

- [ ] Tab `Cover` con: Cliente, EIN, Entity (1040/1065/1120/1120-S), Year
- [ ] Columna `canonical_key` en cada tab de datos
- [ ] Columna `tax_amount` con el monto aprobado por el CPA
- [ ] Columna `flag` con: `ok` | `review` | `manual` | `error`
- [ ] (Opcional) Tab `8949_Transactions` con columnas: description, dateAcquired, dateSold, proceeds, basis, adjCode, form8949Box
- [ ] (Opcional) Tab `4562_Assets` con columnas: description, dateInService, cost, method, life, priorDepreciation

---

## ✅ Guía de Entry Manual W2/1099 (1040) — COMPLETADO

`generators/manualEntryGuideGenerator.js` — genera Excel con guía visual para data entry manual en Drake.

- [x] Hoja de resumen con conteo de formularios y códigos de pantalla Drake
- [x] Hoja por tipo: W2, 1099-INT, 1099-DIV, 1099-R, SSA-1099, 1099-NEC, 1099-MISC
- [x] Cada entry muestra: Box label, campo de Drake, **valor a ingresar** (fondo amarillo), notas
- [x] Códigos de acceso rápido: W2 → `"W2"`, INT → `"INT"`, DIV → `"DIV"`, 1099-R → `"1099"`, SSA → `"SSA"`, NEC → `"99N"`, MISC → `"99M"`
- [x] Wired en `index.js` `generateFiles()` — generado automáticamente para todos los returns 1040
- [x] Tests actualizados y passing (`[ok] DrakeLoader 1040`)
- [x] Output: `{client}_1040_{year}_manual_entry.xlsx`

**Pendiente para activar datos reales:** actualizar `workpaperParser.js` para leer tabs W2/1099 del workpaper (ver sección abajo).

---

## 🔴 Workpaper Parser — tabs W2/1099 para 1040

Para que la guía tenga datos reales, el workpaper parser necesita leer tabs opcionales del workpaper 1040:

- [ ] Tab `W2`: columnas `employer, ein, box1, box2, box3, box4, box5, box6, box12_code, box12_amount, box13_retirement, box15_state, box16_state_wages, box17_state_wh, tsj`
- [ ] Tab `1099_INT`: `payer, ein, box1, box2, box3, box4, tsj`
- [ ] Tab `1099_DIV`: `payer, ein, box1a, box1b, box2a, box4, tsj`
- [ ] Tab `1099_R`: `payer, ein, box1, box2a, box4, box7, box7_ira, tsj`
- [ ] Tab `1099_SSA`: `box3 (o box5), box4, tsj`
- [ ] Tab `1099_NEC`: `payer, ein, box1, box4, tsj`
- [ ] Tab `1099_MISC`: `payer, ein, box3, box7, box4, tsj`

Agregar estos al resultado de `parseApprovedWorkpaper()` como `data.w2s`, `data.int_1099s`, etc.

---

## ✅ GruntWorx XML Generator — COMPLETADO

`generators/gruntWorxGenerator.js` — genera XML nativo de GruntWorx Populate que Drake importa directamente sin pagar el servicio.

**Schema reverse-engineered de:**
- `C:\DRAKE25\FT\IMPORTGW.DLL` — XPaths + dispatch table de classTypes
- `C:\DRAKE25\HELP\GRUNTWORX.KEY` — 708 entradas field-name → Drake form code

**Validación de Drake confirmada (sin firma criptográfica):**
- `taxYear` attribute debe empezar con "20"
- XML bien formado (Msxml2.DOMDocument.6.0)
- Atributo `Class` en `<classData>` debe ser un `CL_*` conocido
- ✘ Sin HMAC, sin token de servidor, sin firma digital

**classTypes soportados:**
- [x] `CL_W_2` — W-2 completo (Boxes 1-17, Box 12 codes, Box 13 booleans)
- [x] `CL_1099_INT` — 1099-INT (Boxes 1, 2, 4, 6, 8-11 + state)
- [x] `CL_1099_DIV` — 1099-DIV (Boxes 1a, 1b, 2a, 2b, 3, 4, 5, 7, 12, 13 + state)
- [x] `CL_1099_NEC` — 1099-NEC (Boxes 1, 4 + state)
- [x] `CL_1099_MISC` — 1099-MISC (Boxes 1-4, 6, 9, 10, 12, 14 + state)
- [x] `CL_1099_SSA` — SSA-1099 (Box 5/Net benefits, Box 6/WH, Medicare premiums)
- ⚠ `CL_1099_R` — en KEY file pero NO en DLL dispatch; usar Manual Entry Guide

**Wiring:**
- [x] `server.js` `/api/preparation/drake-generate` — nuevo `fileType: "gruntworx_xml"`
- [x] `app.js` `renderDrakeInputsPanel()` — nueva fila "GruntWorx XML" con badge "Auto-Import"
- [x] `app.js` `downloadDrakeGruntWorx()` — handler de descarga
- [x] Botón activo cuando hay W-2/1099 data; dimmed cuando no hay datos

**Instrucciones para el usuario:**
1. Abrir el return del cliente en Drake Tax 2025
2. Menú: Import ▸ GruntWorx Populate Job
3. Seleccionar el archivo XML descargado → Open
4. Drake auto-popula todas las pantallas W-2 y 1099

---

## 🟢 Mejoras opcionales

- [ ] Instalar `@nut-tree/nut-js` para habilitar extracción automática de templates: `npm install @nut-tree/nut-js`
- [ ] Parser automático de tabs 8949 y 4562 en `workpaperParser.js`
- [ ] Soporte para Form 990 (organizaciones sin fines de lucro)
- [ ] Retry automático en companion si Drake está ocupado
- [ ] Logs persistentes en companion (actualmente solo stdout)
- [ ] `.gitignore` entry para `templates/*.xls` (no subir templates con metadata de licencia Drake)
- [ ] 🤖 Script de automatización UI para W2/1099 en Drake (usar `companion/drake_ui.py` — explícitamente diferido mientras GruntWorx XML sea la opción primaria)
- [ ] Soporte `CL_1099_R` en GruntWorx XML si Drake añade soporte en futura versión

---

## Estado del módulo

| Componente | Estado |
|---|---|
| `workpaperParser.js` | ✅ Completo |
| `canonical.js` (vocabulario) | ✅ Completo |
| `drakeFieldMap.js` | ✅ Completo |
| `trialBalanceGenerator.js` | ✅ Lógica completa, pendiente templates reales |
| `form8949Generator.js` | ✅ Completo — 40 cols verificadas, fechas MMDDYYYY |
| `form4562Generator.js` | ✅ Completo — 23 cols verificadas contra DLL |
| `scheduleCGenerator.js` | ✅ Completo |
| `manualEntryGuideGenerator.js` | ✅ Completo — guía Excel W2/1099 para 1040 |
| `gruntWorxGenerator.js` | ✅ Completo — XML nativo GruntWorx Populate, 6 classTypes |
| `DrakeLoader` class | ✅ Completo |
| `companion.js` | ✅ Completo |
| `drakeLocator.js` | ✅ Completo |
| `drakeTemplateExtractor.js` | ✅ Completo (requiere @nut-tree/nut-js) |
| `drakeSetup.js` | ✅ Completo |
| Drake field maps | 🟡 Pendiente drakeSection/drakeLine reales |
| CCH field maps | 🟡 Pendiente datos del Developer Portal |
| Drake TB templates | ✅ Completado — 3 templates extraídos y verificados |
| 8949 column order | ✅ Completado — 40 cols verificadas (DRAKEHLP.CHM) |
| 4562 column order | ✅ Completado — 23 cols verificadas (IMPORT4562.DLL) |
| GruntWorx XML schema | ✅ Completado — reverse-engineered de IMPORTGW.DLL + GRUNTWORX.KEY |
