# Drake Tax Import Templates

Esta carpeta contiene los templates propietarios de Drake para el import de Trial Balance.

## Estado actual

Los templates se obtienen corriendo el setup del companion:

```
POST http://localhost:7777/setup/extract-templates
```

O manualmente (ver abajo).

## Archivos esperados

| Archivo | Entity Type | Cómo obtenerlo |
|---|---|---|
| `drake_tb_1120S_template.xls` | S Corporation | Return 1120-S → Import → Trial Balance Import → Create New |
| `drake_tb_1065_template.xls` | Partnership | Return 1065 → Import → Trial Balance Import → Create New |
| `drake_tb_1120_template.xls` | C Corporation | Return 1120 → Import → Trial Balance Import → Create New |

## Extracción manual

Si el extractor automático falla:

1. Abrí Drake Tax 2025/2026
2. Abrí cualquier return tipo **1120-S**
3. Menú **Import → Trial Balance Import → Create New**
4. Drake abre un archivo Excel — guardalo como `drake_tb_1120S_template.xls` en esta carpeta
5. Repetí para un return **1065** → `drake_tb_1065_template.xls`
6. Repetí para un return **1120** → `drake_tb_1120_template.xls`
7. Verificar: `GET http://localhost:7777/setup/status`

## Importante

- **NO modificar** la estructura del template (rows, columnas, macros)
- ExcelJS solo escribe en las celdas de datos — la estructura original se preserva
- Drake valida la estructura al importar; cualquier modificación causa un import corrupto
- Los templates NO deben subirse al repositorio (contienen metadata de la licencia de Drake)

Agregar al `.gitignore`:
```
templates/*.xls
templates/*.xlsx
```
