/**
 * drakeLocator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects the Drake Tax installation directory on a Windows machine.
 *
 * Search order:
 *   1. Environment variable DRAKE_INSTALL_PATH (overrides everything)
 *   2. Default C:\DrakeXX\ folders for recent years (current year – 3)
 *   3. Windows Registry: HKLM\SOFTWARE\Drake Software
 *   4. Alternate drives (D:\, E:\)
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/** Candidate exe names to look for inside a Drake folder. */
const DRAKE_EXE_NAMES = [
  'ft\\draketax2025.exe',
  'ft\\draketax2026.exe',
  'DrakeTax.exe',
  'Drake26.exe',
  'Drake25.exe',
  'Drake24.exe',
];

/**
 * Build candidate folder paths for a given year and drive.
 * @param {number} year   4-digit year
 * @param {string} drive  'C:' | 'D:' etc.
 * @returns {string[]}
 */
function candidatePaths(year, drive) {
  const yy = String(year).slice(2);
  return [
    `${drive}\\Drake${yy}\\`,
    `${drive}\\DrakeTax${yy}\\`,
    `${drive}\\Drake${year}\\`,
  ];
}

/**
 * Check if a folder contains a Drake executable.
 * @param {string} dir
 * @returns {string|null}  Full path to exe, or null
 */
function findExeInDir(dir) {
  for (const exeName of DRAKE_EXE_NAMES) {
    const full = path.join(dir, exeName);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * Derive the folder year from the path string.
 * @param {string} installPath
 * @returns {number|null}
 */
function yearFromPath(installPath) {
  const m = installPath.match(/drake(\d{2,4})/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n < 100 ? 2000 + n : n;
}

/**
 * Locate Drake Tax on this Windows machine.
 *
 * @returns {{
 *   found:       boolean,
 *   path:        string|null,   — install directory (no trailing slash)
 *   year:        number|null,
 *   exePath:     string|null,
 *   tbFolder:    string|null,   — C:\DrakeXX\TB\
 *   version:     string,        — e.g. "Drake25" or "unknown"
 * }}
 */
function locateDrake() {
  // 0. Explicit override via env var
  const envPath = process.env.DRAKE_INSTALL_PATH;
  if (envPath && fs.existsSync(envPath)) {
    const exePath = findExeInDir(envPath) || null;
    const year    = yearFromPath(envPath);
    return {
      found:    true,
      path:     envPath.replace(/[/\\]+$/, ''),
      year,
      exePath,
      tbFolder: path.join(envPath, 'TB'),
      version:  exePath ? path.basename(exePath, '.exe') : 'unknown',
    };
  }

  const currentYear = new Date().getFullYear();
  const drives      = ['C:', 'D:', 'E:'];

  // 1. Check C:\DrakeXX\ for recent years
  for (let y = currentYear + 1; y >= currentYear - 3; y--) {
    for (const drive of drives) {
      for (const dir of candidatePaths(y, drive)) {
        if (!fs.existsSync(dir)) continue;
        const exePath = findExeInDir(dir);
        if (exePath) {
          return {
            found:    true,
            path:     dir.replace(/[/\\]+$/, ''),
            year:     y,
            exePath,
            tbFolder: path.join(dir, 'TB'),
            version:  `Drake${String(y).slice(2)}`,
          };
        }
      }
    }
  }

  // 2. Windows registry
  try {
    const reg = execSync(
      'reg query "HKLM\\SOFTWARE\\Drake Software" /s 2>nul',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const match = reg.match(/InstallPath\s+REG_SZ\s+(.+)/i);
    if (match) {
      const installPath = match[1].trim();
      const exePath     = findExeInDir(installPath);
      if (exePath) {
        const year = yearFromPath(installPath);
        return {
          found:    true,
          path:     installPath.replace(/[/\\]+$/, ''),
          year,
          exePath,
          tbFolder: path.join(installPath, 'TB'),
          version:  exePath ? path.basename(exePath, '.exe') : 'unknown',
        };
      }
    }
  } catch (_) {
    // Registry not available (non-Windows or locked) — ignore
  }

  return { found: false, path: null, year: null, exePath: null, tbFolder: null, version: 'not-found' };
}

module.exports = { locateDrake };
