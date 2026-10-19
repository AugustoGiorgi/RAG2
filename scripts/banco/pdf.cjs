// Un escritor de PDF minimo: paginas carta, Helvetica y Helvetica-Bold, texto y lineas.
// Lo justo para imprimir formularios como los imprime un software de preparacion.

const WIDTHS = { " ": 278, ".": 278, ",": 278, "-": 333, "(": 333, ")": 333, "$": 556, "%": 889, "/": 278, ":": 278, "'": 191, "&": 667 };
const charWidth = (c, bold) => {
  if (WIDTHS[c] !== undefined) return WIDTHS[c];
  if (/[0-9]/.test(c)) return 556;
  if (/[A-Z]/.test(c)) return bold ? 722 : 667;
  if (/[il]/.test(c)) return 222;
  if (/[mw]/.test(c)) return 833;
  return bold ? 611 : 556;
};
const textWidth = (s, size = 8, bold = false) => [...String(s)].reduce((w, c) => w + charWidth(c, bold), 0) * size / 1000;
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

class Page {
  constructor() { this.items = []; this.rules = []; this.y = 756; }
  text(x, s, { size = 8, bold = false, y = this.y } = {}) { if (s !== "" && s !== null && s !== undefined) this.items.push({ x, y, s: String(s), size, bold }); return this; }
  right(xRight, s, opts = {}) { return this.text(xRight - textWidth(s, opts.size || 8, opts.bold), s, opts); }
  rule(y = this.y + 9, x1 = 36, x2 = 576, w = 0.5) { this.rules.push([x1, y, x2, y, w]); return this; }
  down(dy = 12) { this.y -= dy; return this; }
}

function buildPdf(pages) {
  const objs = [null, null];
  const add = (s) => { objs.push(s); return objs.length; };
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const page of pages) {
    let stream = "";
    for (const [x1, y1, x2, y2, w] of page.rules) stream += `${w} w ${x1} ${y1} m ${x2} ${y2} l S\n`;
    for (const it of page.items) stream += `BT /${it.bold ? "F2" : "F1"} ${it.size} Tf 1 0 0 1 ${it.x.toFixed(2)} ${it.y.toFixed(2)} Tm (${esc(it.s)}) Tj ET\n`;
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/**
 * Un formulario: titulo, renglones con numero, rotulo con guia de puntos, casilla e importe al
 * margen derecho, como los imprime el software ("1a Total amount ... 1a 46,000.").
 */
class Form {
  constructor(footer) { this.footer = footer; this.pages = []; this.newPage(); }
  newPage() { this.page = new Page(); this.pages.push(this.page); return this; }
  title(s, size = 11) { this.page.text(36, s, { size, bold: true }); this.page.down(size + 5); return this; }
  line(s, opts = {}) { this.page.text(opts.x || 36, s, opts); this.page.down(opts.dy || 11); return this; }
  lines(list, opts = {}) { for (const s of list) this.line(s, opts); return this; }
  rule() { this.page.rule(); return this; }
  leaders(label, x, until) {
    let s = label;
    const dot = textWidth(" .", 8);
    let w = textWidth(s, 8);
    while (x + w + dot < until) { s += " ."; w += dot; }
    return s;
  }
  row(num, label, box, amount, { indent = 0 } = {}) {
    const labels = Array.isArray(label) ? label : [label];
    const hasAmount = amount !== undefined && amount !== null && amount !== "";
    labels.forEach((text, i) => {
      const last = i === labels.length - 1;
      if (i === 0 && num) this.page.text(36, num, { bold: true });
      const x = 56 + indent;
      // Un rotulo largo se achica para no pisar la casilla, como hace el formulario.
      const size = textWidth(text, 8) > 452 - x - 8 ? 7 : 8;
      this.page.text(x, last && (box || hasAmount) ? this.leaders(text, x, 452) : text, { size });
      if (last) {
        if (box) this.page.text(460, box, { bold: true });
        if (hasAmount) this.page.right(576, amount);
      }
      this.page.down(11);
    });
    return this;
  }
  pair(num, labelA, boxA, amountA, letterB, labelB, boxB, amountB) {
    this.page.text(36, num, { bold: true });
    this.page.text(56, this.leaders(labelA, 56, 228));
    this.page.text(232, boxA, { bold: true });
    if (amountA) this.page.right(318, amountA);
    this.page.text(326, letterB, { bold: true });
    this.page.text(336, this.leaders(labelB, 336, 452));
    this.page.text(460, boxB, { bold: true });
    if (amountB) this.page.right(576, amountB);
    this.page.down(11);
    return this;
  }
  space(dy = 6) { this.page.down(dy); return this; }
  done(pageLabel) {
    this.pages.forEach((p, i) => {
      p.text(36, this.footer, { y: 28, size: 7, bold: true });
      p.right(576, pageLabel ? `${pageLabel} ${i + 1}` : `Page ${i + 1}`, { y: 28, size: 7 });
    });
    return this.pages;
  }
}

module.exports = { Page, Form, buildPdf, textWidth };
