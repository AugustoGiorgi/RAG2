/**
 * drakeSetup.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orquesta el proceso de setup del companion.
 * Expone handlers para:
 *   GET  /setup/status             — informa el estado del setup
 *   POST /setup/extract-templates  — dispara la extracción automática
 */

const fs   = require('fs');
const path = require('path');
const { locateDrake }           = require('./drakeLocator');
const { extractDrakeTemplates } = require('./drakeTemplateExtractor');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

const NEEDED_TEMPLATES = [
  { entityType: '1120S', filename: 'drake_tb_1120S_template.xls' },
  { entityType: '1065',  filename: 'drake_tb_1065_template.xls'  },
  { entityType: '1120',  filename: 'drake_tb_1120_template.xls'  },
];

/**
 * Check which templates already exist in the templates directory.
 * @returns {{ allFound: boolean, files: Array }}
 */
function checkExistingTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    return { allFound: false, files: NEEDED_TEMPLATES.map(t => ({ ...t, exists: false })) };
  }
  const files = NEEDED_TEMPLATES.map(t => ({
    ...t,
    exists: fs.existsSync(path.join(TEMPLATES_DIR, t.filename)),
    path:   path.join(TEMPLATES_DIR, t.filename),
  }));
  return { allFound: files.every(f => f.exists), files };
}

/**
 * Build the manual fallback instructions for when automation fails.
 * @returns {string[]}
 */
function buildManualInstructions() {
  return [
    '1. Abrí Drake Tax',
    '2. Abrí cualquier return tipo 1120-S',
    '3. Hacé click en Import → Trial Balance Import → Create New',
    `4. Guardá el archivo que se abre como "drake_tb_1120S_template.xls"`,
    '5. Repetí para un return 1065 → guardá como "drake_tb_1065_template.xls"',
    '6. Repetí para un return 1120 → guardá como "drake_tb_1120_template.xls"',
    `7. Copiá los 3 archivos a: ${TEMPLATES_DIR}`,
    '8. Llamá GET /setup/status para verificar',
  ];
}

/**
 * Handler para GET /setup/status
 */
function handleSetupStatus(req, res) {
  const drake     = locateDrake();
  const templates = checkExistingTemplates();

  const payload = {
    drakeFound:          drake.found,
    drakePath:           drake.path,
    drakeYear:           drake.year,
    drakeVersion:        drake.version,
    templatesExtracted:  templates.allFound,
    templateFiles:       templates.files,
    setupComplete:       drake.found && templates.allFound,
    templatesDir:        TEMPLATES_DIR,
    manualInstructions:  templates.allFound ? [] : buildManualInstructions(),
  };

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * Handler para POST /setup/extract-templates
 * Body JSON (optional): { "force": true }
 */
function handleExtractTemplates(req, res) {
  // Parse body first, then act
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    let parsedBody = {};
    try { parsedBody = body ? JSON.parse(body) : {}; } catch (_) {}

    const drake = locateDrake();
    if (!drake.found) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: false,
        error: 'Drake Tax no encontrado en este sistema.',
        manualInstructions: buildManualInstructions(),
      }));
    }

    // Skip if already extracted (unless force=true)
    const existing = checkExistingTemplates();
    if (existing.allFound && !parsedBody.force) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok:        true,
        message:   'Templates ya extraídos previamente.',
        templates: existing.files,
        skipped:   true,
      }));
    }

    // Run the extraction (can take 30–60 seconds)
    const progressLog = [];
    const onProgress  = p => {
      progressLog.push(p);
      console.log(`[setup] ${p.message}`);
    };

    let results;
    let extractionError = null;
    try {
      results = await extractDrakeTemplates(TEMPLATES_DIR, onProgress);
    } catch (err) {
      extractionError = err.message;
      results = [];
    }

    const allOk = !extractionError && results.every(r => r.ok);

    if (extractionError || !allOk) {
      const failedTypes = results.filter(r => !r.ok).map(r => r.entityType);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok:           false,
        error:        extractionError || `Falló la extracción de: ${failedTypes.join(', ')}`,
        results,
        progressLog,
        fallback:     'manual',
        manualInstructions: buildManualInstructions(),
      }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok:           true,
        results,
        progressLog,
        drakePath:    drake.path,
        templatesDir: TEMPLATES_DIR,
      }));
    }
  });
}

module.exports = { handleSetupStatus, handleExtractTemplates, checkExistingTemplates, TEMPLATES_DIR };
