"use strict";

/**
 * package-trim.js — decidir QUE se le saca a una declaracion cuando no entra entera.
 *
 * El problema que resuelve, medido y no supuesto. La revision recortaba cada documento por el
 * medio a 160.000 caracteres. Una declaracion 1040 real de este estudio tiene 264 paginas y
 * 795.000 caracteres. El recorte por el medio conserva el principio y el final, asi que lo que
 * llegaba al modelo eran las paginas 1 a 31 y las 232 a 264: la carta al cliente, los resumenes
 * estatales, los consentimientos y las hojas de estimados de 2026. El Formulario 1040 empieza
 * en la pagina 48. Es decir: el modelo nunca vio el 1040, ni el Schedule A, B, C, D o E, ni el
 * 8960, ni el 8582, ni un solo K-1. Se le pidio revisar una declaracion y se le mando la carta
 * de presentacion.
 *
 * Sobre los siete paquetes de prueba, solo el mas chico llegaba completo. Los otros perdian
 * entre el 20% y el 82%. Cualquier medicion de "que tan bien lee el modelo" hecha antes de esto
 * estaba midiendo otra cosa.
 *
 * Que hace este modulo: corta por PAGINA y por PRIORIDAD, nunca por posicion. Primero saca lo
 * que no es materia de revision (vouchers del año que viene, consentimientos, autorizaciones de
 * e-file). Si todavia no entra, saca por orden de menor valor y DEJA CONSTANCIA EXACTA de que
 * saco, con numero de pagina y nombre de formulario, para que el modelo pueda decir "no vi el
 * Schedule E" en vez de inventar que lo vio.
 *
 * Fail-safe, no fail-closed: si el clasificador no reconoce la estructura del documento, o si
 * quisiera sacar mas de lo razonable, no toca nada y devuelve el texto original. Un clasificador
 * que se come la declaracion es peor que ningun clasificador.
 */

/** El marcador que pone el extractor de pdf.js entre paginas. */
const PAGE_MARKER = /^--- Page (\d+) ---$/gm;

/**
 * Prioridad de una pagina. Mas alto se conserva primero.
 *
 *   3 CORE   formularios y anexos federales, K-1, W-2, 1099, depreciacion, statements
 *   2 STATE  declaraciones estatales
 *   1 ADMIN  carta al cliente, resumenes, informacion general
 *   0 DROP   nada de esto es materia de revision de la declaracion del año en curso
 *
 * Tres niveles mas que solo existen adentro de un ZIP de soporte (ver classifySupportPage):
 *
 *   2.5 HOME_STATE  K-1 estatal del estado por el que el paquete presenta declaracion
 *   0.6 K3          paginas del Schedule K-3 de un K-1 recibido
 *   0.3 LEGAL       contratos y documentos societarios, que no son un formulario
 */
const TIER = { CORE: 3, HOME_STATE: 2.5, STATE: 2, ADMIN: 1, K3: 0.6, LEGAL: 0.3, DROP: 0 };

/**
 * Lo unico que se saca siempre. Todo lo de aca describe el año SIGUIENTE, o es un tramite de
 * presentacion, o es un consentimiento: ninguno puede contener un error de la declaracion que
 * se esta revisando.
 *
 * Ojo con una excepcion que no es obvia: "Record of Estimated Tax Payments" NO entra aca. Esa
 * pagina dice lo que el contribuyente efectivamente pago, y hace falta para el safe harbor del
 * §6654. Lo que se saca es la HOJA DE CALCULO de los estimados del año que viene.
 *
 * Se evaluan contra el ENCABEZADO de la pagina, no contra su cuerpo. La primera version miraba
 * los primeros 900 caracteres y se comio dos cosas que no debia: la carta de presentacion, que
 * dice "mail your payment voucher" y por eso parecia un voucher, y una declaracion de Georgia
 * entera, porque en el cuerpo traia la direccion de envio del estado. Una pagina se clasifica
 * por lo que ES, y eso lo dice su titulo.
 */
const DROP_ALWAYS = [
  { re: /20\d{2}\s+ESTIMATED TAX WORKSHEET|ESTIMATED TAX (?:WORKSHEETS?|COMPUTATION WORKSHEE)/i, why: "hoja de estimados del año siguiente" },
  { re: /FILE ONLY IF YOU ARE MAKING A PAYMENT|^\s*Form 1040-ES\b|^\s*Form 1040-V\b|PAYMENT VOUCHER\s*$/i, why: "voucher de pago" },
  { re: /Agency Disclosure Statement|Consent to (?:Disclose|Use) Tax Return Information/i, why: "consentimiento de divulgacion" },
  { re: /e-file Signature Authorization|^\s*(?:Form\s*)?8879\b|^\s*[A-Z]{2}-8879\b/i, why: "autorizacion de e-file" },
  { re: /^\s*Mail to:/i, why: "instrucciones de envio" },
];

/** Una pagina que no es del año que se revisa y no es del anterior no es materia de revision. */
const STATE_PAGE = /\b(?:ARIZONA|CALIFORNIA|COLORADO|CONNECTICUT|GEORGIA|ILLINOIS|NEW JERSEY|NEW YORK|OREGON|SOUTH CAROLINA|WISCONSIN|MASSACHUSETTS|MARYLAND|VIRGINIA|PENNSYLVANIA|MICHIGAN|MINNESOTA|OHIO|NORTH CAROLINA|MISSOURI|INDIANA|ALABAMA|LOUISIANA|KENTUCKY|IOWA|KANSAS|OKLAHOMA|ARKANSAS|UTAH|IDAHO|MONTANA|NEBRASKA|MAINE|VERMONT|RHODE ISLAND|DELAWARE|HAWAII|WEST VIRGINIA|MISSISSIPPI|NEW MEXICO|DISTRICT OF COLUMBIA)\b|Franchise Tax Board|Department of Taxation and Finance|\bIT-2\d{2}\b|\bCA 540\b|\bAZ 140\b|\bIL-1040\b|\bNJ-1040\b|\bOR-40\b|\bSC1040\b/i;

const ADMIN_PAGE = /INCOME TAX SUMMARY|FINANCIAL TRANSACTION SUMMARY|GENERAL INFORMATION PAGE|TAX SUMMARY PAGE|^\s*Dear /im;

const CORE_PAGE = /\bForm\s*(?:1040|1065|1120|990|709|706|3115|4562|4797|8582|8825|8949|8959|8960|8995|7203|8308|2555|1116|6251|8283|8863|5471|8865|8938|1125)|SCHEDULE\s+[A-Z0-9]|Schedule\s+[A-Z0-9]\s*\(Form|Schedule K-1|\bW-2\b|\b1099-[A-Z]{1,4}\b|Depreciation and Amortization|Statement\s+\d+/;

/**
 * Cuanto puede sacar el paso de limpieza antes de que se lo tome por un error del clasificador.
 * En la muestra el maximo real fue 20%; 45% es holgura, no una expectativa.
 */
const MAX_TRIM_SHARE = 0.45;
/** Debajo de esto no hay estructura de paginas que valga la pena analizar. */
const MIN_PAGES = 8;

/** Corta el texto en paginas conservando el marcador. Devuelve [] si no hay estructura. */
function splitPages(text) {
  const source = String(text || "");
  const marks = [...source.matchAll(PAGE_MARKER)];
  if (marks.length < MIN_PAGES) return [];
  const pages = [];
  // Lo que viene antes de la primera marca es preambulo: se conserva siempre, pegado a la
  // primera pagina, porque ahi suele estar el encabezado del documento.
  const preamble = source.slice(0, marks[0].index);
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : source.length;
    pages.push({
      number: Number(marks[i][1]),
      text: (i === 0 ? preamble : "") + source.slice(start, end),
    });
  }
  return pages;
}

/** Las primeras lineas con contenido de una pagina: su encabezado. */
function headingOf(pageText) {
  const out = [];
  for (const raw of String(pageText || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^--- Page \d+ ---$/.test(line)) continue;
    out.push(line);
    if (out.length >= 3) break;
  }
  return out.join("\n");
}

/**
 * En que se convierte una pagina para el que decide que sacar.
 *
 * Lo que se saca siempre se decide por el encabezado — un titulo dice que ES la pagina. Lo que
 * se conserva se decide mirando mas texto, porque ahi el sesgo tiene que ir hacia conservar: es
 * preferible dejar entrar una pagina administrativa que dejar afuera un Schedule.
 */
function classifyPage(pageText) {
  const heading = headingOf(pageText);
  for (const rule of DROP_ALWAYS) {
    if (rule.re.test(heading)) return { tier: TIER.DROP, why: rule.why };
  }
  const head = String(pageText || "").slice(0, 900);
  if (CORE_PAGE.test(head) && !STATE_PAGE.test(heading)) return { tier: TIER.CORE, why: "formulario federal" };
  if (STATE_PAGE.test(head)) return { tier: TIER.STATE, why: "declaracion estatal" };
  if (ADMIN_PAGE.test(head)) return { tier: TIER.ADMIN, why: "resumen o carta" };
  // Sin señal, se trata como nucleo. El sesgo va siempre hacia conservar.
  return { tier: TIER.CORE, why: "sin clasificar, se conserva" };
}

/* ---------------------------------------------------------------------------
 * El ZIP de soporte: muchos documentos en un solo archivo.
 *
 * El navegador manda el ZIP como UN archivo cuyo texto es cada documento de adentro, uno
 * detras del otro, con un encabezado "--- ZIP ENTRY: nombre ---" delante de cada uno. Todo lo
 * de arriba se escribio pensando en una declaracion, y aplicado a ese archivo fallaba de tres
 * maneras, medidas sobre un paquete real de 79 archivos y 936 paginas que no entraba entero:
 *
 *   1. Recortaba desde el final del ZIP. El orden de un ZIP es el de la carpeta del cliente,
 *      no el de importancia: los dos W-2 y nueve de los dieciseis K-1 estaban al final y no se
 *      mandaron, mientras dos contratos de 55.000 caracteres cada uno se mandaron enteros.
 *   2. El encabezado de cada archivo viajaba pegado a la ultima pagina del anterior. Al
 *      sacar esa pagina se iba el encabezado, y el modelo leia el transcript del IRS debajo
 *      del nombre del resumen de la hipoteca.
 *   3. Una pagina con "New York" en la direccion del contribuyente era una "declaracion
 *      estatal": asi cayeron las caras de los W-2.
 *
 * Lo que cambia, y solo para un archivo que trae esos encabezados:
 *
 *   - se corta por ARCHIVO y por pagina, y el encabezado de cada archivo se manda siempre,
 *     con una linea debajo que dice que paginas suyas no se mandaron;
 *   - lo primero que se resigna son los contratos y las paginas del Schedule K-3, despues
 *     los K-1 de otros estados, y al final el resto;
 *   - dentro de un mismo nivel se sacan primero las paginas mas profundas de cada archivo,
 *     de modo que a todos les queda el principio — la cara del formulario — antes de que a
 *     alguno le falte todo.
 *
 * Una declaracion que viene ADENTRO del ZIP se clasifica con las reglas de siempre.
 * ------------------------------------------------------------------------- */

/** Como marca el navegador cada archivo de un ZIP dentro del texto unico del paquete. */
const ZIP_ENTRY_LINE = /^--- ZIP ENTRY: (.+?) ---[ \t]*$/gm;
/** Un Word, un Excel o un texto no tienen paginas: se parten en tramos de este tamaño. */
const CHUNK_CHARS = 3000;
/** Lo que ocupa la linea que avisa, debajo del encabezado, que paginas no se mandaron. */
const NOTE_RESERVE = 260;

/** El archivo es una declaracion: sus paginas se clasifican como las de cualquier declaracion. */
const RETURN_ENTRY = /U\.S\. Individual Income Tax Return|U\.S\. Return of Partnership Income|U\.S\. Income Tax Return for an S Corporation|U\.S\. Corporation Income Tax Return|U\.S\. Income Tax Return for Estates and Trusts/i;

/**
 * Un contrato se reconoce por como esta escrito, no por su extension ni por su nombre: una
 * nota del cliente en Word es materia de revision y un acuerdo de accionistas en PDF no.
 * Hacen falta varias de estas palabras, repartidas por todo el archivo, y que pesen mucho mas
 * que las marcas de formulario — un K-1 con notas al pie en lenguaje legal sigue siendo un K-1.
 *
 * Las marcas se cuentan, no alcanza con encontrar una, y van con la mayuscula con que las
 * imprime un formulario: la primera version se quedaba con cualquier "recipient's" o
 * "transcript", y los cinco contratos mas largos del paquete — "on the recipient's next
 * business day" — pasaban por comprobantes.
 */
const LEGAL_WORDS = /\bWHEREAS\b|\bIN WITNESS WHEREOF\b|\bNOW,? THEREFORE\b|\bRESOLVED\b|\bhereinafter\b|\bhereto\b|\bhereof\b|\bhereunder\b|\bherein\b|\bthereof\b|\bDocuSign Envelope ID\b/gi;
const LEGAL_MIN_HITS = 3;
const LEGAL_CHARS_PER_HIT = 5000;
/** Cuantas palabras de contrato hacen falta por cada marca de formulario para seguir siendo un contrato. */
const LEGAL_HITS_PER_MARK = 4;
const TAX_FORM_MARK = /\bOMB N[Oo]\b|\b(?:Form|FORM)\s+(?:W-2|1099|1098|1095|1042|5498|1040|1065|1120|1041)\b|\b(?:Schedule|SCHEDULE) K-[123]\b|Wage and Tax Statement|(?:Wage and Income|Account|Tax Return) Transcript|PAYER[’']S|RECIPIENT[’']S|\bCopy [ABC12]\b/g;

/** Una pagina del Schedule K-3: el detalle internacional de un K-1, que casi nunca se cruza. */
const K3_PAGE = /^\s*Schedule K-3\b|\bSchedule K-3\s*\((?:Form\s+)?(?:1065|1120-?S|8865)\)/im;

/**
 * Un comprobante federal — W-2, 1099, 1098, 5498, 1095, transcript del IRS. Se busca en toda
 * la pagina y no en el encabezado: la cara de un W-2 empieza por "a Employee's social
 * security number" y el nombre del formulario aparece al pie.
 */
const FEDERAL_INFO = /Wage and Tax Statement|\bForm\s+W-2\b|\bForm\s+1099\b|\b1099-(?:INT|DIV|B|R|G|MISC|NEC|K|OID|SA|Q|S|DA|LTC|PATR|C|A)\b|\bForm\s+1098\b|Mortgage Interest Statement|\b1098-[TE]\b|\bForm\s+5498\b|\bForm\s+1095-[ABC]\b|\bForm\s+1042-S\b|Wage and Income Transcript|Account Transcript/i;

/**
 * Lo que tiene que decir una pagina, ademas del nombre de un estado, para ser un formulario
 * estatal. Sin esto alcanzaba con la direccion: toda pagina de un contribuyente de la ciudad
 * de Nueva York nombra "New York". Con mayuscula inicial a proposito — "in the form of" no es
 * un formulario.
 */
const STATE_FORM_WORDS = /\b(?:Schedule|SCHEDULE|Form|FORM|K-1|Partner[’']s|PARTNER|Member[’']s|MEMBER|Shareholder|SHAREHOLDER|Beneficiary|BENEFICIARY|Pass-Through|PASS-THROUGH|Nonresident|NONRESIDENT|Apportion\w*|APPORTION\w*|Composite|COMPOSITE|Taxable Year|TAXABLE YEAR|Department of Revenue|DEPARTMENT OF REVENUE|Department of Taxation|Franchise Tax Board|Division of Taxation)\b/;

/** Los identificadores de formulario que nombran un estado sin escribir su nombre. */
const STATE_ALIASES = [
  [/Franchise Tax Board|\bCA 540\b/i, "CALIFORNIA"],
  [/Department of Taxation and Finance|\bIT-2\d{2}\b/i, "NEW YORK"],
  [/\bAZ 140\b/i, "ARIZONA"],
  [/\bIL-1040\b/i, "ILLINOIS"],
  [/\bNJ-1040\b/i, "NEW JERSEY"],
  [/\bOR-40\b/i, "OREGON"],
  [/\bSC1040\b/i, "SOUTH CAROLINA"],
];

/** De que estado es una pagina estatal: el primero que nombra. "" si no nombra ninguno. */
function stateOf(head) {
  const match = STATE_PAGE.exec(String(head || ""));
  if (!match) return "";
  for (const [re, name] of STATE_ALIASES) if (re.test(match[0])) return name;
  return match[0].toUpperCase().replace(/\s+/g, " ");
}

const WHY = {
  LEGAL: "contrato o documento societario",
  K3: "Schedule K-3",
  STATE_FORM: "formulario estatal de un K-1",
  HOME_STATE: "formulario del estado de la declaracion",
  BUDGET: "no entraba en el presupuesto",
};

/** Los motivos, como se le dicen al modelo y al que lee el informe. */
const WHY_EN = {
  [WHY.LEGAL]: "contracts and corporate documents, which are not tax forms",
  [WHY.K3]: "Schedule K-3 pages",
  [WHY.STATE_FORM]: "state K-1 and other state form pages",
  [WHY.HOME_STATE]: "state K-1 pages for the state of this return",
  [WHY.BUDGET]: "pages beyond the size one review can read",
  "declaracion estatal": "state return pages",
  "resumen o carta": "cover letters and summaries",
  "hoja de estimados del año siguiente": "next-year estimated tax worksheets",
  "voucher de pago": "payment vouchers",
  "consentimiento de divulgacion": "disclosure consents",
  "autorizacion de e-file": "e-file signature authorizations",
  "instrucciones de envio": "mailing instructions",
};
const whyInEnglish = (why) => WHY_EN[why] || String(why || "");

/** Parte un texto sin paginas en tramos, siempre en un fin de linea. Unidos dan el original. */
function chunkLines(body) {
  const out = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(body.length, start + CHUNK_CHARS);
    if (end < body.length) {
      const newline = body.indexOf("\n", end);
      end = newline < 0 ? body.length : newline + 1;
    }
    out.push(body.slice(start, end));
    start = end;
  }
  return out;
}

/**
 * Las unidades que se pueden conservar o sacar.
 *
 * En un documento comun son sus paginas, tal cual las devuelve splitPages. En un ZIP son las
 * paginas de cada archivo, y cada una sabe de que archivo es y que tan adentro esta (`depth`).
 * El encabezado del archivo va aparte, en `header` de su primera unidad, porque se manda
 * siempre. Unidas en orden — encabezado y texto — dan el original caracter por caracter.
 */
function splitUnits(text) {
  const source = String(text || "");
  const heads = [...source.matchAll(ZIP_ENTRY_LINE)];
  if (!heads.length) return splitPages(source).map((page, index) => ({ ...page, depth: index }));
  const units = [];
  const preamble = source.slice(0, heads[0].index);
  heads.forEach((head, entryIndex) => {
    const lineEnd = source.indexOf("\n", head.index);
    const bodyStart = lineEnd < 0 ? source.length : lineEnd + 1;
    const bodyEnd = entryIndex + 1 < heads.length ? heads[entryIndex + 1].index : source.length;
    const header = (entryIndex === 0 ? preamble : "") + source.slice(head.index, bodyStart);
    const body = source.slice(bodyStart, bodyEnd);
    const marks = [...body.matchAll(PAGE_MARKER)];
    let pieces = marks.length
      ? marks.map((mark, i) => ({
        number: Number(mark[1]),
        // Lo que haya antes de la primera marca va pegado a la primera pagina.
        text: body.slice(i === 0 ? 0 : mark.index, i + 1 < marks.length ? marks[i + 1].index : body.length),
      }))
      : chunkLines(body).map((chunk, i) => ({ number: i + 1, text: chunk, pseudo: true }));
    if (!pieces.length) pieces = [{ number: 1, text: "", pseudo: true }];
    pieces.forEach((piece, depth) => {
      units.push({ ...piece, entry: head[1], entryIndex, entryPages: pieces.length, depth, header: depth === 0 ? header : "" });
    });
  });
  return units.length >= MIN_PAGES ? units : [];
}

/** Que es cada archivo de un ZIP: una declaracion, un contrato o un documento de soporte. */
function kindOfEntry(text) {
  if (RETURN_ENTRY.test(text)) return "return";
  const hits = (text.match(LEGAL_WORDS) || []).length;
  if (hits >= LEGAL_MIN_HITS && hits * LEGAL_CHARS_PER_HIT >= text.length) {
    const marks = (text.match(TAX_FORM_MARK) || []).length;
    if (marks * LEGAL_HITS_PER_MARK <= hits) return "legal";
  }
  return "support";
}

function entryKinds(units) {
  const texts = new Map();
  for (const unit of units) {
    if (unit.entry === undefined) return new Map();
    texts.set(unit.entryIndex, (texts.get(unit.entryIndex) || "") + unit.text);
  }
  const kinds = new Map();
  for (const [entryIndex, text] of texts) kinds.set(entryIndex, kindOfEntry(text));
  return kinds;
}

/**
 * Una pagina de un documento de soporte dentro de un ZIP.
 *
 * Es classifyPage con cuatro diferencias, todas hacia conservar lo que se cruza:
 *   - una pagina del Schedule K-3 baja al nivel que se resigna primero;
 *   - un comprobante federal es nucleo aunque su encabezado no lo diga;
 *   - para ser estatal no alcanza con nombrar un estado, tiene que ser un formulario;
 *   - la carta que acompaña un K-1 es nucleo: ahi se explican sus notas al pie.
 */
function classifySupportPage(pageText, homeStates) {
  const heading = headingOf(pageText);
  for (const rule of DROP_ALWAYS) {
    if (rule.re.test(heading)) return { tier: TIER.DROP, why: rule.why };
  }
  if (K3_PAGE.test(heading)) return { tier: TIER.K3, why: WHY.K3 };
  const text = String(pageText || "");
  const head = text.slice(0, 900);
  if (CORE_PAGE.test(head) && !STATE_PAGE.test(heading)) return { tier: TIER.CORE, why: "formulario federal" };
  if (FEDERAL_INFO.test(text.slice(0, 8000))) return { tier: TIER.CORE, why: "comprobante federal" };
  if (STATE_PAGE.test(head) && STATE_FORM_WORDS.test(head)) {
    return homeStates && homeStates.has(stateOf(head))
      ? { tier: TIER.HOME_STATE, why: WHY.HOME_STATE }
      : { tier: TIER.STATE, why: WHY.STATE_FORM };
  }
  return { tier: TIER.CORE, why: "sin clasificar, se conserva" };
}

/** Todas las unidades de un documento, clasificadas. [] si el documento no tiene estructura. */
function classifyDocument(text, options = {}) {
  const units = splitUnits(text);
  if (!units.length) return [];
  const kinds = entryKinds(units);
  return units.map((unit) => {
    const kind = unit.entry === undefined ? "return" : kinds.get(unit.entryIndex);
    let verdict;
    if (kind === "legal") verdict = { tier: TIER.LEGAL, why: WHY.LEGAL };
    else if (kind === "support") verdict = classifySupportPage(unit.text, options.homeStates);
    else verdict = classifyPage(unit.text);
    return { ...unit, ...verdict, kind };
  });
}

/**
 * Por que estados presenta declaracion el paquete: los que tienen paginas de declaracion
 * estatal en alguna de las declaraciones. Sirve para que, si hay que sacar K-1 estatales del
 * soporte, se vayan primero los de los estados por los que no se presenta nada.
 *
 * El estado se lee del encabezado de la pagina y hacen falta dos: la carta al cliente nombra
 * todos los estados en el cuerpo, y una mencion suelta no es una declaracion.
 */
function returnStates(texts) {
  const counts = new Map();
  for (const text of Array.isArray(texts) ? texts : [texts]) {
    for (const unit of classifyDocument(text)) {
      if (unit.kind !== "return" || unit.tier !== TIER.STATE) continue;
      const state = stateOf(headingOf(unit.text));
      if (state) counts.set(state, (counts.get(state) || 0) + 1);
    }
  }
  return new Set([...counts].filter(([, pages]) => pages >= 2).map(([state]) => state));
}

/** Numeros de pagina como rangos: 14, 15, 16, 20 -> "14-16, 20". */
function rangeList(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return out.join(", ");
}

/** "all 35" o "pages 14-34" — cuanto de un archivo falta. Un Word no tiene paginas, tiene partes. */
function extentOf(items) {
  const total = items[0].entryPages;
  const word = items[0].part ? "part" : "page";
  if (items.length >= total) return total > 1 ? `all ${total} ${word}s` : "all of it";
  return `${word}${items.length > 1 ? "s" : ""} ${rangeList(items.map((item) => item.page))} of ${total}`;
}

/** Los renglones sacados, agrupados por archivo y en el orden del ZIP. */
function byEntry(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.entryIndex)) groups.set(item.entryIndex, []);
    groups.get(item.entryIndex).push(item);
  }
  return [...groups.values()];
}

/** La linea que queda debajo del encabezado de un archivo al que se le sacaron paginas. */
function entryNote(items) {
  const reasons = [...new Set(items.map((item) => whyInEnglish(item.why)))].join("; ");
  return `\n[SERVER NOTE: not sent to you from this file — ${extentOf(items)} (${reasons}). See the note at the end of this document.]\n\n`;
}

/** Como se nombra una pagina en el manifiesto, para que el manifiesto sirva de algo. */
function pageLabel(pageText) {
  const lines = String(pageText || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^--- Page \d+ ---$/.test(line)) continue;
    return line.slice(0, 70);
  }
  return "pagina en blanco";
}

/**
 * Elige que paginas entran en el presupuesto.
 *
 * Devuelve siempre { text, removed, trimmed, pageCount }. Si no puede analizar el documento, o
 * si el resultado seria sospechoso, devuelve el texto original con trimmed:false — el que llama
 * decide entonces que hacer, normalmente recortar por el medio como antes.
 */
function selectPages(text, budget, options = {}) {
  const source = String(text || "");
  const limit = Number(budget || 0);
  const classified = classifyDocument(source, options);
  if (!classified.length) return { text: source, removed: [], trimmed: false, pageCount: 0 };

  // En un ZIP cada renglon dice ademas de que archivo es la pagina: el numero solo no
  // identifica nada, porque la numeracion vuelve a empezar en cada archivo.
  const zipped = classified[0].entry !== undefined;
  const describe = (p, why, intentional) => ({
    page: p.number,
    why,
    label: pageLabel(p.text),
    ...(intentional ? { intentional: true } : {}),
    ...(zipped ? { entry: p.entry, entryIndex: p.entryIndex, entryPages: p.entryPages, part: Boolean(p.pseudo) } : {}),
  });
  const total = classified.reduce((sum, p) => sum + p.text.length, 0);

  // Paso 1: sacar lo que nunca es materia de revision, entre entero o no.
  const alwaysGone = classified.filter((p) => p.tier === TIER.DROP);
  const goneChars = alwaysGone.reduce((sum, p) => sum + p.text.length, 0);
  const cleanupSuspicious = goneChars > total * MAX_TRIM_SHARE;
  let keep = cleanupSuspicious ? classified.slice() : classified.filter((p) => p.tier !== TIER.DROP);
  // `intentional` separa lo que se saca por ser tramite de lo que se saca por no entrar: el
  // aviso al modelo tiene que decir cosas distintas de cada uno. Ver removalNotice.
  const removed = cleanupSuspicious
    ? []
    : alwaysGone.map((p) => describe(p, p.why, true));

  // Paso 2: si todavia no entra, sacar por prioridad — primero lo administrativo, despues lo
  // estatal, y el nucleo federal solo si no queda otra. Dentro de cada nivel, las ultimas
  // paginas primero, que es donde estan los anexos repetidos.
  if (!zipped) {
    let kept = keep.reduce((sum, p) => sum + p.text.length, 0);
    if (Number.isFinite(limit) && limit > 0 && kept > limit) {
      const order = keep
        .map((p, index) => ({ p, index }))
        .sort((a, b) => (a.p.tier - b.p.tier) || (b.index - a.index));
      const doomed = new Set();
      for (const { p } of order) {
        if (kept <= limit) break;
        doomed.add(p);
        kept -= p.text.length;
        removed.push(describe(p, p.tier === TIER.CORE ? WHY.BUDGET : p.why));
      }
      keep = keep.filter((p) => !doomed.has(p));
    }
    removed.sort((a, b) => a.page - b.page);
    return {
      text: keep.map((p) => p.text).join(""),
      removed,
      trimmed: removed.length > 0,
      pageCount: classified.length,
    };
  }

  // El ZIP. El mismo orden, con una diferencia: dentro de un nivel las "ultimas" son las mas
  // profundas de cada archivo, no las del final del ZIP. Asi a ningun archivo le falta la cara
  // del formulario mientras a otro le sobran paginas de detalle.
  //
  // Ademas del texto de cada pagina se paga, por cada archivo del que queda algo, su
  // encabezado, y si le falta alguna pagina la linea que lo avisa. De un archivo del que no
  // queda nada no va ni el encabezado: lo nombra el aviso del final. Contarlo de otro modo
  // hacia que con un presupuesto chico los encabezados solos no dejaran entrar una pagina.
  const ledger = new Map();
  for (const p of classified) {
    if (!ledger.has(p.entryIndex)) ledger.set(p.entryIndex, { header: 0, kept: 0, gone: 0 });
    ledger.get(p.entryIndex).header += p.header.length;
  }
  for (const p of keep) ledger.get(p.entryIndex).kept += 1;
  for (const item of removed) ledger.get(item.entryIndex).gone += 1;
  const overhead = (entry) => (entry.kept > 0 ? entry.header + (entry.gone > 0 ? NOTE_RESERVE : 0) : 0);
  /** Lo que cambia el total si la pagina sale (step -1) o vuelve (step +1). */
  const move = (p, step) => {
    const entry = ledger.get(p.entryIndex);
    const before = overhead(entry);
    entry.kept += step;
    entry.gone -= step;
    return overhead(entry) - before + step * p.text.length;
  };
  let kept = keep.reduce((sum, p) => sum + p.text.length, 0) + [...ledger.values()].reduce((sum, entry) => sum + overhead(entry), 0);
  if (Number.isFinite(limit) && limit > 0 && kept > limit) {
    const order = keep
      .map((p, index) => ({ p, index }))
      .sort((a, b) => (a.p.tier - b.p.tier) || (b.p.depth - a.p.depth) || (b.index - a.index));
    const doomed = [];
    for (const { p } of order) {
      if (kept <= limit) break;
      doomed.push(p);
      kept += move(p, -1);
    }
    // Lo ultimo que se saco es lo mas valioso de lo que se saco, y la ultima pagina puede
    // haber liberado mucho mas de lo que faltaba. Con lo que sobra vuelve lo que entre,
    // empezando por ahi.
    const gone = new Set(doomed);
    for (let i = doomed.length - 1; i >= 0; i -= 1) {
      const cost = move(doomed[i], +1);
      if (kept + cost <= limit) {
        kept += cost;
        gone.delete(doomed[i]);
      } else {
        move(doomed[i], -1);
      }
    }
    for (const p of doomed) {
      if (gone.has(p)) removed.push(describe(p, p.tier === TIER.CORE ? WHY.BUDGET : p.why));
    }
    keep = keep.filter((p) => !gone.has(p));
  }

  removed.sort((a, b) => (a.entryIndex - b.entryIndex) || (a.page - b.page));
  const notes = new Map(byEntry(removed).map((items) => [items[0].entryIndex, entryNote(items)]));
  const kepts = new Set(keep);
  const out = [];
  classified.forEach((unit, index) => {
    const entry = ledger.get(unit.entryIndex);
    if (!entry.kept) return;
    if (unit.header) out.push(unit.header);
    if (kepts.has(unit)) out.push(unit.text);
    const lastOfEntry = index + 1 === classified.length || classified[index + 1].entryIndex !== unit.entryIndex;
    if (lastOfEntry && notes.has(unit.entryIndex)) out.push(notes.get(unit.entryIndex));
  });
  return {
    text: out.join(""),
    removed,
    trimmed: removed.length > 0,
    pageCount: classified.length,
  };
}

/**
 * La constancia que va al prompt. No es decorativa: es lo unico que separa "el modelo no vio el
 * Schedule E" de "el modelo dijo que el Schedule E estaba bien". Lista las paginas por numero y
 * por lo que decia su encabezado, agrupadas, y en ingles porque el prompt esta en ingles.
 *
 * Son dos avisos, no uno, porque piden conductas opuestas.
 *
 * Lo que no entro en el presupuesto es un hueco en la revision: el modelo no lo vio y tiene que
 * decirlo si algo depende de eso. Lo que se saco por ser tramite — autorizaciones de e-file,
 * vouchers, hojas de estimados del año siguiente — esta en la declaracion y no es materia de
 * revision. Con un solo aviso para las dos cosas, el modelo hacia lo que se le pedia para la
 * primera con la segunda: dos informes seguidos, un 1065 y un 1040, listaron el 8879 como
 * "documento faltante — page not provided", y el formulario estaba en la pagina 11 de uno y en
 * la 21 del otro. Un faltante falso manda al preparador a buscar algo que ya tiene.
 */
function removalNotice(removed, pageCount) {
  const list = Array.isArray(removed) ? removed : [];
  if (!list.length) return "";
  if (list.some((item) => item.entry !== undefined)) return packageRemovalNotice(list, pageCount);
  const describe = (items) => {
    const byReason = new Map();
    for (const item of items) {
      if (!byReason.has(item.why)) byReason.set(item.why, []);
      byReason.get(item.why).push(item);
    }
    const lines = [];
    for (const [why, group] of byReason) {
      const numbers = group.map((i) => i.page).join(", ");
      const examples = [...new Set(group.map((i) => i.label))].slice(0, 4).join(" | ");
      lines.push(`  - ${group.length} page(s) [${why}]: pages ${numbers}. Headings: ${examples}`);
    }
    return lines;
  };
  const intentional = list.filter((i) => i.intentional);
  const budget = list.filter((i) => !i.intentional);
  const out = ["", ""];
  if (intentional.length) {
    out.push(
      `[SERVER NOTE — FILING PAPERWORK LEFT OUT ON PURPOSE. ${intentional.length} of this document's ${pageCount} pages are part of the return but are not review material, so they were not sent:`,
      ...describe(intentional),
      "These pages EXIST in the return. They are e-file signature authorizations (Forms 8879, 8879-PE, 8879-CORP, 8878, 8453 and state equivalents), payment vouchers, next-year estimated-tax worksheets, disclosure consents or mailing instructions. Do NOT list them in missingDocuments, do NOT ask for them in openQuestions, and do NOT write that they were not provided — signatures are collected after the review. Do not state anything about their contents either.]",
    );
  }
  if (budget.length) {
    if (intentional.length) out.push("");
    out.push(
      `[SERVER NOTE — PAGES NOT INCLUDED. ${budget.length} of this document's ${pageCount} pages were not sent to you:`,
      ...describe(budget),
      "You have NOT seen the pages listed above. Do not state or imply anything about their contents.",
      "If a check you were asked to perform depends on one of them, say the page was not provided and stop there — never infer what it contained.]",
    );
  }
  return out.join("\n");
}

/**
 * El mismo aviso para un ZIP de soporte, que es un paquete de archivos y no un documento.
 *
 * Dos diferencias con el de arriba, las dos aprendidas del mismo paquete. Los numeros de pagina
 * solos no dicen nada — "pages 1, 1, 1, 2, 2" — asi que cada renglon nombra el archivo. Y lo
 * que no entro NO es un documento que falte: esta en la carpeta del cliente. Decirle al modelo
 * "page not provided" termina en un pedido al cliente de algo que ya mando.
 */
function packageRemovalNotice(list, pageCount) {
  const describe = (items) => {
    const byReason = new Map();
    for (const item of items) {
      if (!byReason.has(item.why)) byReason.set(item.why, []);
      byReason.get(item.why).push(item);
    }
    const lines = [];
    for (const [why, group] of byReason) {
      const files = byEntry(group).map((entryItems) => `"${entryItems[0].entry}" (${extentOf(entryItems)})`);
      lines.push(`  - ${group.length} page(s), ${whyInEnglish(why)}: ${files.join("; ")}`);
    }
    return lines;
  };
  const intentional = list.filter((i) => i.intentional);
  const budget = list.filter((i) => !i.intentional);
  const out = ["", ""];
  if (intentional.length) {
    out.push(
      `[SERVER NOTE — FILING PAPERWORK LEFT OUT ON PURPOSE. ${intentional.length} of this package's ${pageCount} pages are not review material, so they were not sent:`,
      ...describe(intentional),
      "These pages EXIST in the package. They are e-file signature authorizations, payment vouchers, next-year estimated-tax worksheets, disclosure consents or mailing instructions. Do NOT list them in missingDocuments, do NOT ask for them in openQuestions, and do NOT write that they were not provided. Do not state anything about their contents either.]",
    );
  }
  if (budget.length) {
    if (intentional.length) out.push("");
    out.push(
      `[SERVER NOTE — PAGES NOT INCLUDED. This package is larger than one review can read, so ${budget.length} of its ${pageCount} pages were not sent to you, least important first:`,
      ...describe(budget),
      "These pages ARE in the client's package, and each file is marked in place above. You have NOT seen them: do not state or imply anything about their contents.",
      "Do NOT list them in missingDocuments and do NOT ask the client for them. If a check you were asked to perform depends on one of them, say that the page was not sent to this review and has to be checked by hand, and stop there — never infer what it contained.]",
    );
  }
  return out.join("\n");
}

/**
 * Lo que no se le mando al modelo por tamaño, archivo por archivo: para el que LEE el informe.
 *
 * El aviso de arriba le dice al modelo que no opine sobre lo que no vio. Esto le dice al
 * revisor que parte del paquete nadie reviso. Sin esto un informe sobre la mitad de la carpeta
 * se lee igual que uno sobre la carpeta entera.
 *
 * Lo que se saca a proposito — vouchers, autorizaciones de e-file — no entra aca: no es
 * materia de revision y nombrarlo seria mandar a alguien a revisar un tramite.
 */
function omittedFiles(removed, pageCount, name) {
  const budget = (Array.isArray(removed) ? removed : []).filter((item) => !item.intentional);
  if (!budget.length) return [];
  const summarize = (items, file, total) => {
    const reasons = new Map();
    for (const item of items) reasons.set(item.why, (reasons.get(item.why) || 0) + 1);
    return {
      name: file,
      pages: items.length,
      of: total,
      whole: items.length >= total,
      reasons: [...reasons].map(([why, pages]) => ({ why, pages })),
    };
  };
  if (budget[0].entry === undefined) return [summarize(budget, String(name || ""), Number(pageCount) || budget.length)];
  return byEntry(budget).map((items) => summarize(items, items[0].entry, items[0].entryPages));
}

/** Hasta cuantos archivos se nombran en cada grupo antes de decir "y N mas". */
const OMISSION_MAX_NAMES = 12;
/** A cuantos archivos de un mismo motivo se les sigue poniendo el nombre cuando solo perdieron paginas. */
const OMISSION_NAMED_PARTIALS = 3;

/**
 * La frase para el informe. Recibe lo que devolvio omittedFiles para cada documento del
 * paquete, todo junto. "" si no se dejo nada afuera.
 *
 * Dice dos cosas distintas, porque piden cosas distintas del revisor. Un archivo que no se
 * mando ENTERO se nombra: hay que abrirlo. De uno al que le faltan paginas alcanza con saber
 * que clase de paginas y de cuantos archivos — dieciseis K-1 sin su Schedule K-3 son una
 * linea, no dieciseis nombres.
 */
function omissionNote(omitted) {
  const list = (Array.isArray(omitted) ? omitted : []).filter((item) => item && item.pages > 0);
  if (!list.length) return "";
  const order = [WHY.LEGAL, WHY.K3, "resumen o carta", WHY.STATE_FORM, "declaracion estatal", WHY.HOME_STATE, WHY.BUDGET];
  const rank = (why) => (order.indexOf(why) < 0 ? order.length : order.indexOf(why));
  const short = (name) => String(name || "").split(/[\\/]/).pop();
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const group = (rows) => {
    const byReason = new Map();
    for (const row of rows) {
      if (!byReason.has(row.why)) byReason.set(row.why, []);
      byReason.get(row.why).push(row);
    }
    return [...byReason].sort((a, b) => rank(a[0]) - rank(b[0]));
  };

  // Enteros: cada archivo una vez, bajo el motivo por el que se fue la mayor parte.
  const whole = list.filter((file) => file.whole).map((file) => ({
    name: file.name,
    why: [...file.reasons].sort((a, b) => b.pages - a.pages || rank(a.why) - rank(b.why))[0].why,
  }));
  // Con paginas de menos: un renglon por archivo y por motivo.
  const partial = list.filter((file) => !file.whole).flatMap((file) => file.reasons.map((reason) => ({ name: file.name, why: reason.why, pages: reason.pages })));

  const sentences = [];
  if (whole.length) {
    const groups = group(whole).map(([why, rows]) => {
      const names = rows.slice(0, OMISSION_MAX_NAMES).map((row) => short(row.name));
      if (rows.length > OMISSION_MAX_NAMES) names.push(`and ${rows.length - OMISSION_MAX_NAMES} more`);
      return `${whyInEnglish(why)}: ${names.join("; ")}`;
    });
    sentences.push(`Not sent at all — ${groups.join(". Also ")}.`);
  }
  if (partial.length) {
    const groups = group(partial).map(([why, rows]) => {
      const pages = rows.reduce((sum, row) => sum + row.pages, 0);
      const files = rows.length <= OMISSION_NAMED_PARTIALS ? rows.map((row) => short(row.name)).join("; ") : plural(rows.length, "file");
      return `${whyInEnglish(why)}, ${plural(pages, "page")} of ${files}`;
    });
    sentences.push(`Sent without some pages — ${groups.join("; ")}.`);
  }
  const pages = list.reduce((sum, file) => sum + file.pages, 0);
  return `NOT READ BY THIS REVIEW: the package is larger than one review can read, so ${plural(pages, "page")} of ${plural(list.length, "file")} were left out, least important first. ${sentences.join(" ")} Everything else in the package was sent to the review. Check these by hand if they bear on the return.`;
}

/**
 * Cuanto pesa el nucleo federal de un documento, y cuanto pesa entero.
 *
 * Sirve para repartir presupuesto entre documentos SIN que el reparto por rol le quite al año
 * anterior paginas del 1040 para darle al corriente paginas de una declaracion estatal. Cada
 * dolar de entrada tiene que comprar primero el formulario federal de todos los documentos, y
 * recien despues lo estatal de cualquiera de ellos.
 *
 * `main` es todo menos lo que se resigna primero — los contratos y las paginas K-3 de un ZIP
 * de soporte. En un documento que no es un ZIP, `main` y `full` son el mismo numero.
 */
function sizes(text, options = {}) {
  const source = String(text || "");
  const classified = classifyDocument(source, options);
  if (!classified.length) return { core: source.length, main: source.length, full: source.length, structured: false };
  // Los encabezados de archivo de un ZIP se mandan siempre: cuentan en los tres.
  const headers = classified.reduce((sum, p) => sum + (p.header ? p.header.length : 0), 0);
  const weigh = (test) => headers + classified.filter(test).reduce((sum, p) => sum + p.text.length, 0);
  const full = weigh((p) => p.tier !== TIER.DROP);
  const core = weigh((p) => p.tier === TIER.CORE);
  const main = weigh((p) => p.tier >= TIER.ADMIN);
  // El mismo resguardo que selectPages: si la limpieza se comeria demasiado, no hubo limpieza.
  const total = weigh(() => true);
  const dropped = total - full;
  if (dropped > total * MAX_TRIM_SHARE) return { core, main: source.length, full: source.length, structured: true };
  return { core, main, full, structured: true };
}

/**
 * Colapsa las guias de puntos de los formularios.
 *
 * Un formulario impreso une la etiqueta con su casilla asi:
 *
 *   Check here if this is a publicly traded partnership . . . . . . . . . . . . . . . . . >
 *
 * Esos puntos son tipografia, no informacion: el modelo lee la etiqueta y lee el valor, la
 * guia no le dice nada. Y se pagan a precio de token de entrada.
 *
 * Medido sobre el paquete mas grande del estudio — dos declaraciones de 610 paginas mas 42
 * PDF de soporte de 500 — las guias son 551.000 caracteres, el 21% de todo lo que se manda.
 * Sacarlas es lo que hace que ese paquete entre entero en la ventana del modelo.
 *
 * Que NO se toca, y por que. La primera version tambien colapsaba las corridas de espacios y
 * las de guiones. Las dos se descartaron: en un formulario una columna vacia ES el espacio
 * que la separa, y una fila de rayas suele significar cero. Ademas, una vez sacadas las guias
 * de puntos, colapsar espacios ahorraba 770 caracteres mas sobre 1.837.000. No valia el riesgo.
 *
 * Comprobado sobre el paquete real: los 53.214 importes sobreviven identicos, y tambien las 48
 * marcas [ANSWER:], las 770 tildes X de casilla y los 1.046 Yes/No. Ver test/package-trim.test.js.
 *
 * Se aplica SOLO al texto que va al modelo. Los cruces deterministas leen originalText, que
 * queda crudo — varios de ellos limpian las guias por su cuenta con su propio criterio.
 */
const LEADER_RUN = /(?:[ \t]*[.·]){4,}/g;

function collapseLeaders(text) {
  return String(text || "").replace(LEADER_RUN, " . ");
}

/**
 * Debajo de esto una pagina no se compara con ninguna otra.
 *
 * Una pagina corta puede repetirse por casualidad, y sacarla no ahorra nada. La version que
 * ademas descartaba paginas casi vacias se comio dos paginas del unico PDF escaneado del
 * paquete: no tenian mas que el numero de lote del escaner, pero eran lo unico que ese
 * documento aportaba. Ahorraba el 0,3% y podia perder algo. Una pagina se saca SOLO si otra
 * pagina del paquete dice exactamente lo mismo.
 */
const DEDUPE_MIN_CHARS = 200;

/** La forma normalizada con la que se comparan dos paginas: sin marca de pagina y sin espaciado. */
function pageFingerprint(pageText) {
  return String(pageText || "")
    .replace(PAGE_MARKER, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Saca las paginas cuyo texto exacto ya aparecio antes en el MISMO paquete.
 *
 * Un paquete de soporte real trae el mismo K-1 dos veces (suelto y dentro de una carpeta), y
 * trae la misma plantilla de formulario en blanco en cada uno de los cuarenta y tres K-1. Sobre
 * el paquete mas grande del estudio son 110 paginas y 225.000 caracteres.
 *
 * La comparacion es por texto EXACTO, cifras incluidas. Una version anterior normalizaba
 * sacando los digitos y con eso dos K-1 con las mismas etiquetas y distintos importes hasheaban
 * igual — justo lo que no se puede perder. Comprobado sobre el paquete real: de las 110 paginas
 * descartadas, ninguna tenia una cifra que no quedara en otra pagina del paquete.
 *
 * El deduplicado es entre documentos, no dentro de uno, asi que corre una vez sobre la lista
 * entera antes de repartir presupuesto. La primera aparicion se queda; las siguientes se van.
 *
 * Recibe [{ name, text }] y devuelve { documents, removedPages, removedChars }, donde cada
 * documento trae ademas `duplicates` con lo que se le saco y de donde ya estaba.
 */
function dedupePages(documents) {
  const list = Array.isArray(documents) ? documents : [];
  const seen = new Map();
  let removedPages = 0;
  let removedChars = 0;

  const out = list.map((doc) => {
    const text = String(doc.text || "");
    // En un ZIP se compara pagina por pagina de cada archivo, y el encabezado del archivo se
    // conserva aunque todas sus paginas ya esten en otro lado: es lo que le dice al modelo que
    // ese archivo existe. Antes el encabezado viajaba pegado a la ultima pagina del archivo
    // anterior, y esa pagina nunca coincidia con ninguna otra.
    const pages = splitUnits(text);
    if (!pages.length) return { ...doc, text, duplicates: [] };
    const zipped = pages[0].entry !== undefined;
    const keep = [];
    const duplicates = [];
    for (const page of pages) {
      if (page.header) keep.push(page.header);
      const key = pageFingerprint(page.text);
      if (key.length >= DEDUPE_MIN_CHARS) {
        const first = seen.get(key);
        if (first) {
          removedPages += 1;
          removedChars += page.text.length;
          duplicates.push({
            page: page.number,
            label: pageLabel(page.text),
            sameAs: first,
            ...(zipped ? { entry: page.entry, entryIndex: page.entryIndex, entryPages: page.entryPages, part: Boolean(page.pseudo) } : {}),
          });
          continue;
        }
        seen.set(key, { name: zipped ? page.entry : doc.name || "", page: page.number });
      }
      keep.push(page.text);
    }
    return { ...doc, text: keep.join(""), duplicates };
  });

  return { documents: out, removedPages, removedChars };
}

/**
 * La constancia de lo deduplicado.
 *
 * Es distinta de removalNotice y no se pueden mezclar: aquella dice "no viste esta pagina, no
 * opines sobre ella", y aca el modelo SI vio el contenido — una sola vez, en otro archivo. Si
 * se le dijera que no lo vio, dejaria de cruzar un K-1 que tiene delante.
 */
function duplicateNotice(duplicates) {
  const list = Array.isArray(duplicates) ? duplicates : [];
  if (!list.length) return "";
  if (list[0].entry !== undefined) {
    // En un ZIP el numero de pagina solo no identifica nada: se nombra el archivo.
    const files = byEntry(list).map((items) => `"${items[0].entry}" (${extentOf(items)})`);
    return [
      "",
      "",
      `[SERVER NOTE — DUPLICATE PAGES SENT ONCE. ${list.length} page(s) of this package are character-for-character identical to pages already included elsewhere in it, so they were sent a single time: ${files.join("; ")}`,
      "You HAVE seen this content — it is present in another document of this package. Treat it as available and cross-check against it normally. Do not report these pages or files as missing.]",
    ].join("\n");
  }
  const numbers = list.map((d) => d.page).join(", ");
  const examples = [...new Set(list.map((d) => d.label))].slice(0, 4).join(" | ");
  return [
    "",
    "",
    `[SERVER NOTE — DUPLICATE PAGES SENT ONCE. ${list.length} page(s) of this document are character-for-character identical to pages already included elsewhere in this package, so they were sent a single time: pages ${numbers}. Headings: ${examples}`,
    "You HAVE seen this content — it is present in another document of this package. Treat it as available and cross-check against it normally. Do not report these pages as missing.]",
  ].join("\n");
}

module.exports = {
  selectPages, splitPages, classifyPage, removalNotice, pageLabel, sizes,
  collapseLeaders, dedupePages, duplicateNotice, pageFingerprint,
  splitUnits, classifyDocument, returnStates, omittedFiles, omissionNote,
  TIER, MAX_TRIM_SHARE, MIN_PAGES, DEDUPE_MIN_CHARS,
};