"use strict";

/**
 * cost-ceiling.js — que una revision no pueda costar mas de lo que el estudio decidio.
 *
 * Por que existe: subir el presupuesto de entrada para que entren las declaraciones estatales
 * es lo correcto para la calidad de la revision, y es tambien la unica variable que mueve el
 * precio — con el razonamiento apagado la salida son ~13.000 tokens y trece centavos, y el 92%
 * del costo es la entrada. Sin un techo, "presupuesto mas grande" significa "factura mas
 * grande" sin limite conocido, y una corrida ya salio $2,14.
 *
 * Como funciona: se cuentan los tokens del prompt ANTES de mandarlo — /v1/messages/count_tokens
 * es exacto y gratis — se calcula lo que costaria, y si se pasa del techo se recorta el
 * presupuesto de entrada y se vuelve a medir. Lo que se recorta lo elige lib/package-trim.js,
 * que saca declaraciones estatales antes que formularios federales, asi que el techo se paga
 * con lo menos importante primero.
 *
 * El precio se calcula contra el modelo que efectivamente va a correr — ver primaryRates, que
 * explica por que no contra el mas caro de la lista.
 *
 * Fail-safe: si count_tokens no responde, se estima con una relacion caracteres/token
 * deliberadamente pesimista y se sigue. Un techo aproximado es mejor que ninguno; lo que no
 * puede pasar es que la revision no corra porque el contador de tokens se cayo.
 */

/**
 * Caracteres por token cuando hay que estimar en vez de contar.
 *
 * Medido con count_tokens sobre una declaracion real: 700.000 caracteres dieron 319.332
 * tokens, o sea 2,19. Aca se usa 2,00 a proposito — subestimar la relacion sobreestima los
 * tokens, y un techo que se equivoca tiene que equivocarse hacia abajo.
 */
const PESSIMISTIC_CHARS_PER_TOKEN = 2.0;

/** Debajo de esto el informe no entra y hay que recortar la entrada, no la salida. */
const MIN_OUTPUT_TOKENS = 24000;

/** Cuantas veces se reintenta ajustar antes de aceptar lo que haya. */
const MAX_PASSES = 3;

/**
 * Con que precio se calcula el techo.
 *
 * Con el del modelo que efectivamente va a correr, que es el primero de la lista — no con el
 * del mas caro. Calcular con el peor caso parece prudente y sale caro al reves: sobre Dayani,
 * dimensionar a precio de Sonnet 4.5 ($3/M) y correr en Sonnet 5 ($2/M) gasto $0,89 de $1,54
 * disponibles y dejo afuera declaraciones estatales que estaban pagas. El 42% del presupuesto
 * se perdia protegiendo contra un fallback que casi nunca ocurre.
 *
 * Lo que queda expuesto: si el primario falla y la corrida cae a un modelo mas caro, esa
 * corrida puede pasarse del techo — hasta un 50% con la lista de hoy. Es raro, y desde que el
 * fallback dejo de ser silencioso queda escrito en el log con nombre y motivo.
 */
function primaryRates(models, ratesFor) {
  for (const model of Array.isArray(models) ? models : []) {
    const rates = ratesFor(model);
    if (rates) return rates;
  }
  return null;
}

/** Cuanto podria pasarse una corrida que cae al modelo mas caro de la lista. */
function fallbackExposure(models, ratesFor) {
  const primary = primaryRates(models, ratesFor);
  if (!primary) return 1;
  let worst = primary;
  for (const model of Array.isArray(models) ? models : []) {
    const rates = ratesFor(model);
    if (rates && rates.inputPerMTok > worst.inputPerMTok) worst = rates;
  }
  return worst.inputPerMTok / primary.inputPerMTok;
}

/**
 * Cuantos tokens de entrada se pueden pagar dejando lugar a un informe.
 * Devuelve null cuando el techo no esta configurado.
 */
function inputTokenAllowance({ ceilingUsd, rates, outputTokens, passes = 1 }) {
  if (!ceilingUsd || !(ceilingUsd > 0) || !rates) return null;
  const n = Math.max(1, Number(passes) || 1);
  const outputUsd = (Number(outputTokens || 0) / 1e6) * rates.outputPerMTok * n;
  const forInput = ceilingUsd - outputUsd;
  if (forInput <= 0) return 0;
  return Math.floor((forInput / inputRateFor(rates, n)) * 1e6);
}

/**
 * El precio por millon de tokens de entrada para N pasadas del MISMO paquete.
 *
 * Una sola pasada paga la entrada al precio normal. Dos o mas usan el cache de prompt: la
 * primera lo escribe (con recargo) y las siguientes lo leen al 10%. Con Sonnet 5 eso son $2,50
 * mas $0,20 = $2,70 por millon para dos pasadas, contra $2,00 para una — o sea que la segunda
 * pasada cuesta un 35% mas de entrada, no el doble.
 */
function inputRateFor(rates, passes = 1) {
  const n = Math.max(1, Number(passes) || 1);
  if (n === 1) return rates.inputPerMTok;
  return rates.cacheWritePerMTok + (n - 1) * rates.cacheReadPerMTok;
}

/** Lo que costaria la revision completa, con todas sus pasadas. */
function priceOf({ inputTokens, outputTokens, rates, passes = 1 }) {
  if (!rates) return null;
  const n = Math.max(1, Number(passes) || 1);
  return (Number(inputTokens || 0) / 1e6) * inputRateFor(rates, n)
    + (Number(outputTokens || 0) / 1e6) * rates.outputPerMTok * n;
}

/**
 * Ajusta el paquete hasta que entre en el techo.
 *
 * `build(totalChars, perFileChars)` arma el pedido con ese presupuesto y devuelve
 * { systemBlocks, messages, documentChars }. `count(systemBlocks, messages)` devuelve los
 * tokens de entrada, o null si no se pudo contar.
 *
 * Devuelve { built, inputTokens, maxTokens, estimatedUsd, passes, counted, clamped }.
 */
async function fitToCeiling({
  ceilingUsd, rates, maxOutputTokens, totalChars, perFileChars, build, count, passes: runPasses = 1,
}) {
  // El techo cubre la REVISION, no la llamada: si se corre el paquete dos veces para ganar
  // cobertura, las dos pasadas entran en el mismo limite. Es lo que se factura.
  const runs = Math.max(1, Number(runPasses) || 1);
  let total = totalChars;
  let perFile = perFileChars;
  let built = await build(total, perFile);
  let clamped = false;
  let counted = true;
  let inputTokens = 0;
  let outputTokens = Math.min(maxOutputTokens, Math.max(MIN_OUTPUT_TOKENS, maxOutputTokens));
  let passes = 1;

  for (; passes <= MAX_PASSES; passes += 1) {
    const measured = await count(built.systemBlocks, built.messages);
    if (measured === null || measured === undefined) {
      counted = false;
      inputTokens = Math.ceil((built.documentChars + built.overheadChars) / PESSIMISTIC_CHARS_PER_TOKEN);
    } else {
      inputTokens = measured;
    }
    if (!ceilingUsd || !rates) break;

    // Primero se intenta pagar el techo con la salida: si alcanza para un informe entero,
    // no hace falta tocar los documentos.
    const allowance = inputTokenAllowance({ ceilingUsd, rates, outputTokens: MIN_OUTPUT_TOKENS, passes: runs });
    if (allowance === null) break;
    if (inputTokens <= allowance) {
      const spent = (inputTokens / 1e6) * inputRateFor(rates, runs);
      const room = Math.floor(((ceilingUsd - spent) / (rates.outputPerMTok * runs)) * 1e6);
      outputTokens = Math.max(MIN_OUTPUT_TOKENS, Math.min(maxOutputTokens, room));
      break;
    }

    // No alcanza: se recorta la entrada en la proporcion que falta, con un poco de margen,
    // y se vuelve a armar. package-trim decide QUE se va: primero lo estatal.
    clamped = true;
    if (passes === MAX_PASSES) { outputTokens = MIN_OUTPUT_TOKENS; break; }
    const ratio = Math.max(0.2, (allowance / inputTokens) * 0.97);
    total = Math.max(60000, Math.floor(total * ratio));
    perFile = Math.max(30000, Math.floor(perFile * ratio));
    built = await build(total, perFile);
    outputTokens = MIN_OUTPUT_TOKENS;
  }

  return {
    built,
    inputTokens,
    maxTokens: Math.max(MIN_OUTPUT_TOKENS, Math.min(maxOutputTokens, outputTokens)),
    estimatedUsd: priceOf({ inputTokens, outputTokens, rates, passes: runs }),
    totalChars: total,
    perFileChars: perFile,
    passes,
    counted,
    clamped,
  };
}

module.exports = {
  fitToCeiling, primaryRates, fallbackExposure, inputTokenAllowance, priceOf, inputRateFor,
  PESSIMISTIC_CHARS_PER_TOKEN, MIN_OUTPUT_TOKENS, MAX_PASSES,
};
