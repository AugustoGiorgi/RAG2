"use strict";
// Las imagenes de un paquete y lo que del paquete nadie leyo (lib/review-attachments.js).
//
// El caso que lo motiva: una carpeta de cliente con los comprobantes de los pagos estimados al
// estado guardados como capturas PNG. No tienen texto que extraer, nadie los leyo, y la
// declaracion salio con esa linea en cero. Nombres y contenidos de aca son inventados.
const { test } = require("node:test");
const assert = require("node:assert");
const { collectImages, unreadFilesOf, unreadNote, imageMediaTypeOf, MAX_IMAGES, MAX_IMAGE_BYTES } = require("../lib/review-attachments");

/** Los primeros bytes de un JPEG y de un PNG, con relleno: alcanza para reconocerlos. */
const jpeg = (size = 600) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]).toString("base64");
const png = (size = 600) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size, 7)]).toString("base64");
const zipWith = (scannedImages, extra = {}) => ({ name: "Docs.zip", scannedImages, ...extra });

test("un JPEG y un PNG se reconocen por sus primeros bytes, no por lo que dice el navegador", () => {
  assert.strictEqual(imageMediaTypeOf(jpeg()), "image/jpeg");
  assert.strictEqual(imageMediaTypeOf(png()), "image/png");
  assert.strictEqual(imageMediaTypeOf(Buffer.from("%PDF-1.7 not a picture").toString("base64")), "");
  assert.strictEqual(imageMediaTypeOf("not base64 at all!"), "");
  assert.strictEqual(imageMediaTypeOf(""), "");
});

test("las imagenes del ZIP se adjuntan con su nombre y su tipo real", () => {
  const { images, skipped } = collectImages({ files: [
    { name: "return.pdf", text: "Form 1040" },
    zipWith([
      { name: "Docs/Payments/state estimated payments.png", mediaType: "image/jpeg", data: jpeg() },
      { name: "Docs/Payments/receipt.png", mediaType: "image/png", data: png() },
    ]),
  ] });
  assert.deepStrictEqual(images.map((i) => [i.name, i.mediaType]), [
    ["Docs/Payments/state estimated payments.png", "image/jpeg"],
    ["Docs/Payments/receipt.png", "image/png"],
  ]);
  assert.deepStrictEqual(skipped, []);
  assert.ok(images.every((i) => i.bytes > 0 && typeof i.data === "string"));
});

test("lo que no es una imagen de verdad no se adjunta: la API rechazaria la revision entera", () => {
  const { images, skipped } = collectImages({ files: [zipWith([
    { name: "Docs/photo.jpg", mediaType: "image/jpeg", data: Buffer.from("this is not a picture").toString("base64") },
    { name: "Docs/ok.jpg", mediaType: "image/jpeg", data: jpeg() },
    { name: "Docs/empty.jpg", mediaType: "image/jpeg", data: "" },
  ])] });
  assert.deepStrictEqual(images.map((i) => i.name), ["Docs/ok.jpg"]);
  assert.deepStrictEqual(skipped, ["Docs/photo.jpg"], "y queda anotada para el informe");
});

test("hay un tope de imagenes y de tamaño, y lo que pasa el tope queda anotado", () => {
  const many = Array.from({ length: MAX_IMAGES + 3 }, (_, i) => ({ name: `Docs/photo ${i + 1}.jpg`, data: jpeg() }));
  const capped = collectImages({ files: [zipWith(many)] });
  assert.strictEqual(capped.images.length, MAX_IMAGES);
  assert.deepStrictEqual(capped.skipped, ["Docs/photo 11.jpg", "Docs/photo 12.jpg", "Docs/photo 13.jpg"]);
  const heavy = collectImages({ files: [zipWith([{ name: "Docs/huge.jpg", data: jpeg(MAX_IMAGE_BYTES + 1000) }, { name: "Docs/small.jpg", data: jpeg() }])] });
  assert.deepStrictEqual(heavy.images.map((i) => i.name), ["Docs/small.jpg"]);
  assert.deepStrictEqual(heavy.skipped, ["Docs/huge.jpg"]);
});

test("un paquete sin imagenes no cambia nada", () => {
  assert.deepStrictEqual(collectImages({ files: [{ name: "return.pdf", text: "Form 1040" }, { name: "Docs.zip", scannedPdfs: [{ name: "scan.pdf", data: "AAAA" }] }] }), { images: [], skipped: [] });
  assert.deepStrictEqual(collectImages({}), { images: [], skipped: [] });
  assert.deepStrictEqual(collectImages(), { images: [], skipped: [] });
});

test("lo que no se leyo: lo que no pudo el navegador y lo que paso los limites del servidor, sin repetir", () => {
  const payload = {
    metadata: { scanDropped: ["Docs/big scan.pdf"] },
    files: [
      { name: "return.pdf" },
      zipWith([], { unreadEntries: ["Docs/envelope.heic", "Docs/notes.pages", "Docs/big scan.pdf"] }),
    ],
  };
  assert.deepStrictEqual(unreadFilesOf(payload, ["Docs/photo 11.jpg", "Docs/envelope.heic"]), [
    "Docs/envelope.heic", "Docs/notes.pages", "Docs/big scan.pdf", "Docs/photo 11.jpg",
  ]);
  assert.deepStrictEqual(unreadFilesOf({ files: [{ name: "return.pdf" }] }), []);
  assert.deepStrictEqual(unreadFilesOf(), []);
});

test("el informe nombra los archivos que no se leyeron, sin la carpeta", () => {
  const note = unreadNote(["Docs/Payments/envelope.heic", "Docs\\notes.pages"]);
  assert.strictEqual(note, "2 file(s) in the package were NOT read by this review — a format that cannot be read, or an attachment over the size limits: envelope.heic; notes.pages. Open them by hand before concluding that a document is missing.");
  assert.strictEqual(unreadNote([]), "", "si se leyo todo no se agrega nada al informe");
  assert.strictEqual(unreadNote(undefined), "");
  const long = unreadNote(Array.from({ length: 26 }, (_, i) => `Docs/file ${i + 1}.heic`));
  assert.match(long, /^26 file\(s\)/);
  assert.match(long, /file 20\.heic; and 6 more\./);
});
