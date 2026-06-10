/**
 * drakeTemplateExtractor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Extrae los templates de Trial Balance de Drake usando @nut-tree/nut-js.
 * Se ejecuta UNA SOLA VEZ durante el setup del companion.
 *
 * Estrategia:
 *   1. Abrir Drake (o traerlo al frente si ya está corriendo)
 *   2. Por cada entity type (1120S, 1065, 1120):
 *      a. Abrir o navegar a un return del tipo correcto
 *      b. Navegar a Import > Trial Balance Import > Create New
 *      c. Watchear la carpeta TB/ hasta que Drake cree el .xls
 *      d. Copiarlo a templates/drake_tb_{entityType}_template.xls
 *   3. Retornar { results: [...], allOk: bool }
 *
 * NOTA: Usa keyboard shortcuts en lugar de coordenadas para ser robusto
 *       ante cambios de resolución y DPI.  El watcheo de carpeta es más
 *       confiable que image-matching para detectar cuándo Drake termina.
 *
 * Dependencias: @nut-tree/nut-js (prebuilt para Windows, sin compilar C++)
 * Solo funciona en Windows (Drake es Windows-only).
 */

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { locateDrake } = require('./drakeLocator');

// @nut-tree/nut-js se carga condicionalmente para no romper en non-Windows
let nut;
function getNut() {
  if (!nut) {
    try {
      nut = require('@nut-tree/nut-js');
    } catch (e) {
      throw new Error(
        '@nut-tree/nut-js no está instalado. Ejecutar: npm install @nut-tree/nut-js\n' +
        'Error original: ' + e.message
      );
    }
  }
  return nut;
}

/** Pausa en ms. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Watchea una ruta hasta que el archivo aparece o se supera el timeout.
 * @param {string}   filePath
 * @param {number}   timeoutMs
 * @param {Function} [triggerFn]  Función asíncrona llamada UNA VEZ antes de watchear
 * @returns {Promise<boolean>}
 */
async function watchForFile(filePath, timeoutMs, triggerFn) {
  if (triggerFn) await triggerFn();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Abre Drake o lo trae al frente si ya está corriendo.
 * @param {string} exePath
 * @param {Function} onProgress
 */
async function openOrFocusDrake(exePath, onProgress) {
  const { keyboard, Key } = getNut();

  // Intentar traer Drake al frente con Alt+Tab (simple heuristic)
  // Si no está abierto, spawnearlo
  if (fs.existsSync(exePath)) {
    onProgress({ step: 'open', message: `Abriendo Drake: ${exePath}` });
    spawn(exePath, [], { detached: true, stdio: 'ignore' });
    await sleep(10000); // Drake tarda ~10s en cargar
  } else {
    onProgress({ step: 'focus', message: 'Drake ya debería estar abierto. Intentando enfocar...' });
    await sleep(2000);
  }
}

/**
 * Navega en Drake a Import > Trial Balance Import > Create New
 * usando keyboard shortcuts.
 * @param {string} dummyClientName  Nombre del cliente dummy para el return
 */
async function triggerTrialBalanceCreate(dummyClientName) {
  const { keyboard, Key } = getNut();

  keyboard.config.autoDelayMs = 100;

  // Intentar con Alt+I para abrir el menú Import
  // Drake 2025/2026: el menú Import es accesible via Alt+I o la barra de menú
  await keyboard.pressKey(Key.LeftAlt);
  await sleep(300);
  await keyboard.releaseKey(Key.LeftAlt);
  await keyboard.type('I'); // "I" para Import
  await sleep(800);

  // Navegar al primer item del menú (Trial Balance Import)
  await keyboard.type(Key.Return);
  await sleep(1000);

  // En el dialog: click en "Create New" (Alt+N es el acelerador típico)
  await keyboard.pressKey(Key.LeftAlt);
  await keyboard.type('N');
  await keyboard.releaseKey(Key.LeftAlt);
  await sleep(3000);

  // Drake abre Excel con el template en la carpeta TB/
  // El watcher detectará el archivo
}

/**
 * Extrae el template para un entity type.
 * @param {Object}   drake         resultado de locateDrake()
 * @param {string}   entityType    '1120S' | '1065' | '1120'
 * @param {string}   templatesDir
 * @param {Function} onProgress
 * @returns {Promise<string>}  ruta del template guardado
 */
async function extractSingleTemplate(drake, entityType, templatesDir, onProgress) {
  const dummyName = `TPLEXTRACT_${entityType}`;
  // Drake nombra los archivos como {ClientName}TB.xls en la carpeta TB/
  const expectedFile = path.join(drake.tbFolder, `${dummyName}TB.xls`);

  // Limpiar archivo previo
  if (fs.existsSync(expectedFile)) fs.unlinkSync(expectedFile);

  // Asegurar que TB/ existe
  if (!fs.existsSync(drake.tbFolder)) {
    fs.mkdirSync(drake.tbFolder, { recursive: true });
  }

  onProgress({ step: 'navigate', message: `Esperando archivo: ${expectedFile}` });

  const found = await watchForFile(expectedFile, 20000, async () => {
    await triggerTrialBalanceCreate(dummyName);
  });

  if (!found) {
    throw new Error(
      `Drake no creó el template en 20s. ` +
      `Verificar que Drake esté abierto con un return ${entityType} activo.`
    );
  }

  // Copiar al directorio de templates
  const destPath = path.join(templatesDir, `drake_tb_${entityType}_template.xls`);
  fs.copyFileSync(expectedFile, destPath);

  // Cerrar el dialog de Import (Escape)
  try {
    const { keyboard, Key } = getNut();
    await keyboard.type(Key.Escape);
    await sleep(500);
  } catch (_) { /* no crítico */ }

  return destPath;
}

/**
 * Extrae todos los templates de Drake necesarios (1120S, 1065, 1120).
 *
 * @param {string}   templatesDir   Donde guardar los templates
 * @param {Function} [onProgress]   Callback ({ step, message })
 * @returns {Promise<Array>}  Array de { entityType, path, ok, error? }
 */
async function extractDrakeTemplates(templatesDir, onProgress = () => {}) {
  const drake = locateDrake();
  if (!drake.found) {
    throw new Error(
      'Drake Tax no encontrado en este sistema. ' +
      'Verificar que Drake esté instalado en C:\\DrakeXX\\'
    );
  }

  onProgress({ step: 'locate', message: `Drake encontrado: ${drake.path} (${drake.version})` });

  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
  }

  await openOrFocusDrake(drake.exePath, onProgress);

  const ENTITY_TYPES = ['1120S', '1065', '1120'];
  const results = [];

  for (const entityType of ENTITY_TYPES) {
    onProgress({ step: 'extracting', message: `Extrayendo template ${entityType}...` });
    try {
      const templatePath = await extractSingleTemplate(drake, entityType, templatesDir, onProgress);
      results.push({ entityType, path: templatePath, ok: true });
      onProgress({ step: 'extracted', message: `✓ Template ${entityType} guardado: ${templatePath}` });
    } catch (err) {
      results.push({ entityType, ok: false, error: err.message });
      onProgress({ step: 'error', message: `✗ Error ${entityType}: ${err.message}` });
    }
    await sleep(1500);
  }

  return results;
}

module.exports = { extractDrakeTemplates };
