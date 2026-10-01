"use strict";

/**
 * planning-model.js — con que modelo corre Tax Planning y como se le pide que no piense.
 *
 * Tax Planning corre en Sonnet 5.5: $2/$10 por millon de tokens, contra $3/$15 de Sonnet 4.6.
 * El cambio de modelo trae dos cosas que estan resueltas aca:
 *
 * - Sonnet 5.5 razona antes de contestar si no se le dice lo contrario, y ese razonamiento se
 *   cobra como salida y sale del MISMO max_tokens que el JSON. La Review ya lo sufrio con
 *   Sonnet 5: gasto el tope pensando y devolvio cero texto. Planning no razonaba con 4.6 y sigue
 *   sin razonar. En 5.5 "disabled" da 400; lo mas bajo que acepta es "between_tools", que en un
 *   pedido sin herramientas devuelve solo texto, igual que "disabled" en Sonnet 5.
 * - Su tokenizador es el de Sonnet 5, que cuenta mas tokens por el mismo texto (hasta ~35%
 *   segun Anthropic): el mismo JSON necesita mas lugar. Se paga lo que se escribe, no el tope.
 *
 * VOLVER ATRAS NO NECESITA DEPLOY: CLAUDE_PLANNING_MODEL=claude-sonnet-4-6 en el entorno del
 * VPS, y la variable manda sobre el modelo por defecto.
 */

const PLANNING_DEFAULT_MODEL = "claude-sonnet-5-5";
/** Fallback de siempre de Planning, despues de los modelos de CLAUDE_MODEL. */
const PLANNING_LAST_RESORT = "claude-sonnet-4-5-20250929";
/** Lugar extra de salida por el tokenizador nuevo. */
const PLANNING_OUTPUT_HEADROOM = 1.35;

/** El modelo elegido primero, despues los de CLAUDE_MODEL, y al final Sonnet 4.5. */
function planningModels(preferred, fallbacks = []) {
  const first = String(preferred || "").trim() || PLANNING_DEFAULT_MODEL;
  return Array.from(new Set([first, ...fallbacks, PLANNING_LAST_RESORT].filter(Boolean)));
}

/**
 * Que mandar en `thinking` para que el modelo conteste sin razonar antes. null = no mandar nada:
 * los modelos 4.x no razonan si no se les pide, y ahi el pedido queda como estaba.
 */
function upfrontThinkingOff(model) {
  const id = String(model || "");
  if (/^claude-sonnet-5-5(?:$|-\d{8}$)/i.test(id)) return { type: "between_tools" };
  if (/^claude-sonnet-5(?:$|-\d{8}$)/i.test(id)) return { type: "disabled" };
  return null;
}

/** El tope de salida de un pedido de Planning, con el lugar extra del tokenizador. */
function planningMaxTokens(maxTokens) {
  return Math.round(Number(maxTokens || 0) * PLANNING_OUTPUT_HEADROOM);
}

module.exports = {
  PLANNING_DEFAULT_MODEL, PLANNING_LAST_RESORT, PLANNING_OUTPUT_HEADROOM,
  planningModels, upfrontThinkingOff, planningMaxTokens,
};
