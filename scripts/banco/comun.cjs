"use strict";

/**
 * Lo que comparten los casos del banco de pruebas: el formato de los importes, las paginas de
 * resumen que imprime el software del estudio (TAX RETURN SUMMARY, GENERAL INFORMATION) y los
 * documentos de una pagina (W-2, 1099, 1042-S).
 *
 * Todo es inventado: contribuyentes, empresas, numeros de identificacion (empiezan con 000 o 99)
 * y cifras. Ningun dato sale de un cliente del estudio.
 */

const { Form, Page, buildPdf } = require("./pdf.cjs");

/** "46,000." como lo imprime el software; vacio si no hay importe. */
const m = (n) => (n === null || n === undefined || n === "" ? "" : n < 0 ? `(${Math.abs(Number(n)).toLocaleString("en-US")}.)` : `${Number(n).toLocaleString("en-US")}.`);

/** Las dos paginas de resumen del software, con renglones [rotulo, importe] y lineas sueltas. */
function summaryPages(year, header, rows, general) {
  const s = new Form(`${year} TAX RETURN SUMMARY`);
  s.title(`${year} TAX RETURN SUMMARY PAGE 1`, 10).line(header).space().line("FEDERAL", { bold: true });
  for (const [label, amount] of rows) s.row("", label, "", amount);
  const g = new Form(`${year} GENERAL INFORMATION`);
  g.title(`${year} GENERAL INFORMATION PAGE 1`, 10).line(header).space();
  g.lines(general);
  return [...s.done("PAGE"), ...g.done("PAGE")];
}

/** Un documento de una pagina: [texto, opciones] por linea. */
function simpleDoc(lines) {
  const p = new Page();
  for (const [s, opts] of lines) { p.text(36, s, opts || {}); p.down(opts && opts.dy ? opts.dy : 13); }
  return buildPdf([p]);
}

/** Un W-2 con el formato que leen los cruces (rotulos de dos casillas y abajo los importes). */
function w2({ year, ssn, ein, employer, address, employee, box1, box2, ss = box1, box4 = 0, medicare = box1, box6 = 0, extra = [], state = "" }) {
  const cents = (n) => Number(n).toFixed(2);
  return simpleDoc([
    [`Form W-2 Wage and Tax Statement ${year}`, { bold: true, size: 11 }],
    ["Copy B - To Be Filed With Employee's FEDERAL Tax Return. Department of the Treasury - Internal Revenue Service", { size: 7 }],
    [`a Employee's social security number ${ssn}`],
    [`b Employer identification number (EIN) ${ein}`],
    ["c Employer's name, address, and ZIP code"],
    [employer], ...address.map((l) => [l]),
    ["e Employee's first name and initial Last name"], [employee],
    ["1 Wages, tips, other compensation 2 Federal income tax withheld"], [`${cents(box1)} ${cents(box2)}`],
    ["3 Social security wages 4 Social security tax withheld"], [`${cents(ss)} ${cents(box4)}`],
    ["5 Medicare wages and tips 6 Medicare tax withheld"], [`${cents(medicare)} ${cents(box6)}`],
    ...extra.map((l) => [l]),
    ["15 State Employer's state ID number 16 State wages, tips, etc. 17 State income tax"], [state],
  ]);
}

module.exports = { Form, Page, buildPdf, m, summaryPages, simpleDoc, w2 };
