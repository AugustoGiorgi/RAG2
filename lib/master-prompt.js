"use strict";

/**
 * master-prompt.js — que reglas del master prompt recibe cada revision.
 *
 * senior-review-master-prompt.txt tiene reglas comunes y despues una seccion por formulario,
 * cada una detras de un renglon de "═" y un titulo "FORM 1065 — ...". Una revision recibe las
 * comunes mas la seccion de su formulario, y nada de los otros.
 *
 * Por que vive aca y con tests. El separador estaba escrito en server.js con el "═" mal
 * codificado (sus tres bytes leidos como otro juego de caracteres), asi que el corte no
 * coincidia nunca: las reglas comunes se tomaban como los
 * primeros 18 mil caracteres (que ya incluian el 1040 y el 1041), la seccion del formulario se
 * estiraba hasta el final del archivo, y el total se recortaba a 26 mil sacando el medio — justo
 * donde estaba la seccion elegida. Un 1065, un 1120 y un 1120-S recibian reglas del 1040, del
 * 1041, del 709 y del 720, y nunca las suyas. Nada fallaba a la vista: el prompt salia igual de
 * largo y con reglas de verdad, solo que de otro formulario.
 */

// El "═" va como escape para que ninguna conversion de codificacion lo vuelva a romper.
const FORM_SEPARATOR = /\n\s*\u2550{3,}\s*\nFORM\s+/i;

/** Las reglas comunes: todo lo que esta antes de la primera seccion de formulario. */
function sharedRules(masterPrompt) {
  const text = String(masterPrompt || "");
  const first = text.search(FORM_SEPARATOR);
  return (first > 0 ? text.slice(0, first) : text).trim();
}

/**
 * La seccion de un formulario, sin la del siguiente. "1120" no puede tomar la seccion del
 * 1120-S, ni "1040" la del 1040-NR: despues del numero no puede seguir un guion ni una letra.
 */
function formSection(masterPrompt, formType) {
  const text = String(masterPrompt || "");
  const type = String(formType || "").trim();
  if (!text || !type) return "";
  const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = text.search(new RegExp(`\\n\\s*FORM\\s+${escaped}(?![\\w-])`, "i"));
  if (start < 0) return "";
  const from = start + 1;
  const next = text.slice(from).search(FORM_SEPARATOR);
  return text.slice(from, next >= 0 ? from + next : text.length).trim();
}

/** Las reglas que recibe una revision de este tipo: comunes + las de su formulario. */
function selectFormRules(masterPrompt, formType) {
  return { shared: sharedRules(masterPrompt), form: formSection(masterPrompt, formType) };
}

module.exports = { selectFormRules, sharedRules, formSection, FORM_SEPARATOR };
