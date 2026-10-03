"use strict";

/**
 * firm-drive.js — lo que no depende de Google para guardar las revisiones de una firma en Drive.
 *
 * Como funciona (lo decidio el estudio): el administrador de la firma (firm_admin) conecta su
 * propia cuenta de Google una vez, la app crea una carpeta en su Drive, y cada Word que
 * descarga cualquier usuario de esa firma se sube ahi, ademas de bajarse a la computadora. Si
 * la subida falla, la copia local ya esta: nunca se pierde el informe.
 *
 * La app tiene de Google solo el permiso "drive.file" (el que ya esta aprobado): ve y escribe
 * unicamente los archivos que ella crea. Por eso la carpeta la crea la app, y no se puede pegar
 * el link de una carpeta cualquiera.
 */

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const REVIEW_FOLDER_NAME = "RAG Tax AI - Reviews";
/** Un Word de revision pesa cientos de KB; esto deja margen y frena un envio absurdo. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Nombre de archivo apto para Drive: sin barras ni caracteres de control, con extension. */
function safeDriveFileName(name, extension = ".docx") {
  const clean = String(name || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const base = clean || "Review";
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

/**
 * El nombre con que se guarda una revision: el mismo que la descarga local, mas quien la
 * genero y cuando, para que en una carpeta de toda la firma se sepa de quien es cada una.
 */
function reviewDriveFileName(baseName, userName, when = new Date()) {
  // La hora local del navegador ("2026-10-03 1415") si vino bien formada; si no, la del servidor.
  const given = String(when instanceof Date ? "" : when || "");
  const d = when instanceof Date ? when : new Date();
  const stamp = /^\d{4}-\d{2}-\d{2} \d{4}$/.test(given)
    ? given
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const base = String(baseName || "Review").replace(/\.docx$/i, "");
  return safeDriveFileName(`${base} - ${String(userName || "user").trim()} - ${stamp}`);
}

/** El cuerpo multipart/related que pide la API de subida de Drive: metadatos JSON y el archivo. */
function driveMultipartBody(metadata, buffer, mimeType = DOCX_MIME, boundary = `rag${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`) {
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
    + `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  return { body: Buffer.concat([head, Buffer.from(buffer), tail]), contentType: `multipart/related; boundary=${boundary}` };
}

module.exports = { DOCX_MIME, REVIEW_FOLDER_NAME, MAX_UPLOAD_BYTES, safeDriveFileName, reviewDriveFileName, driveMultipartBody };
