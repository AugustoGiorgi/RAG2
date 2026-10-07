"use strict";

/**
 * review-attachments.js — las imagenes de un paquete, y lo que del paquete nadie leyo.
 *
 * Una carpeta de cliente no trae solo PDF. Trae capturas de pantalla de la pagina del estado
 * con los pagos estimados, y fotos del sobre con que se mando una eleccion. No tienen texto que
 * extraer, asi que hasta aca desaparecian: en un paquete real los dos comprobantes de pagos
 * estimados al estado eran capturas PNG, nadie los leyo, y la declaracion tenia esa linea en
 * cero, con los pagos ya hechos y los comprobantes en la carpeta.
 *
 * El navegador achica cada imagen y la manda en `scannedImages` del archivo ZIP que la traia.
 * Aca se decide cuales se le adjuntan al modelo, y se arma la lista de lo que NO viajo — una
 * imagen de mas, un formato que no se lee, un escaneado que paso los limites — para que el
 * informe lo nombre en vez de callarlo.
 */

/** Hasta cuantas imagenes de un paquete se le adjuntan al modelo. */
const MAX_IMAGES = 10;
/** La API no acepta una imagen de mas de 5 MB; el navegador las manda de unos cientos de KB. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const MAX_NAME_CHARS = 300;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * "image/jpeg" o "image/png" segun los primeros bytes; "" si no es ninguna de las dos.
 *
 * No se le cree al tipo que declara el navegador. La API rechaza el pedido ENTERO por una
 * imagen que no puede abrir, y una foto no vale una revision: lo que no es de verdad un JPEG o
 * un PNG no se adjunta.
 */
function imageMediaTypeOf(base64) {
  const text = String(base64 || "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return "";
  const head = Buffer.from(text.slice(0, 16), "base64");
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  return "";
}

const cleanName = (name, fallback) => String(name || fallback || "").trim().slice(0, MAX_NAME_CHARS);

/**
 * Las imagenes que se adjuntan, y los nombres de las que no.
 * Devuelve { images: [{ name, mediaType, data, bytes }], skipped: [nombre] }.
 */
function collectImages(payload = {}) {
  const images = [];
  const skipped = [];
  let total = 0;
  for (const file of Array.isArray(payload.files) ? payload.files : []) {
    for (const candidate of Array.isArray(file?.scannedImages) ? file.scannedImages : []) {
      const data = String(candidate?.data || "");
      if (!data) continue;
      const name = cleanName(candidate?.name, "image");
      const mediaType = imageMediaTypeOf(data);
      const bytes = Math.floor(data.length * 0.75);
      if (!mediaType || images.length >= MAX_IMAGES || bytes > MAX_IMAGE_BYTES || total + bytes > MAX_TOTAL_BYTES) {
        skipped.push(name);
        continue;
      }
      total += bytes;
      images.push({ name, mediaType, data, bytes });
    }
  }
  return { images, skipped };
}

/**
 * Los archivos del paquete de los que no se le mando nada al modelo, por nombre y sin repetir:
 * los que el navegador no pudo leer ni adjuntar (`unreadEntries` de cada ZIP y `scanDropped`),
 * y los adjuntos que pasaron los limites del servidor (`skipped`).
 */
function unreadFilesOf(payload = {}, skipped = []) {
  const names = [];
  for (const file of Array.isArray(payload.files) ? payload.files : []) {
    for (const name of Array.isArray(file?.unreadEntries) ? file.unreadEntries : []) names.push(name);
  }
  for (const name of Array.isArray(payload.metadata?.scanDropped) ? payload.metadata.scanDropped : []) names.push(name);
  for (const name of Array.isArray(skipped) ? skipped : []) names.push(name);
  return [...new Set(names.map((name) => cleanName(name)).filter(Boolean))].slice(0, 200);
}

/** Hasta cuantos nombres se escriben en el informe antes de decir "y N mas". */
const NOTE_MAX_NAMES = 20;

/** La frase para el informe: que archivos del paquete no se leyeron. "" si se leyo todo. */
function unreadNote(unread) {
  const list = (Array.isArray(unread) ? unread : []).filter(Boolean);
  if (!list.length) return "";
  const named = list.slice(0, NOTE_MAX_NAMES).map((name) => String(name).split(/[\\/]/).pop());
  const more = list.length > named.length ? `; and ${list.length - named.length} more` : "";
  return `${list.length} file(s) in the package were NOT read by this review — a format that cannot be read, or an attachment over the size limits: ${named.join("; ")}${more}. Open them by hand before concluding that a document is missing.`;
}

module.exports = { collectImages, unreadFilesOf, unreadNote, imageMediaTypeOf, MAX_IMAGES, MAX_IMAGE_BYTES };
