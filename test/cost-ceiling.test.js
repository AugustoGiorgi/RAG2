"use strict";
// El techo de gasto por revision.
//
// Existe porque una corrida salio $2,14 y devolvio un informe vacio, y porque subir el
// presupuesto de entrada — que es lo correcto para la calidad — es tambien lo unico que mueve
// el precio. Estas pruebas fijan que el techo sea una garantia y no una intencion: que se
// calcule contra el modelo que va a correr, que recorte la entrada y no el
// informe, y que si el contador de tokens no responde estime de mas y nunca de menos.
const { test } = require("node:test");
const assert = require("node:assert");
const {
  fitToCeiling, primaryRates, fallbackExposure, inputTokenAllowance, priceOf,
  PESSIMISTIC_CHARS_PER_TOKEN, MIN_OUTPUT_TOKENS,
} = require("../lib/cost-ceiling");

const SONNET5 = { inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 };
const SONNET45 = { inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 };
const HAIKU = { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 };
const RATES = { "claude-sonnet-5": SONNET5, "claude-sonnet-4-5": SONNET45, "claude-haiku-4-5": HAIKU };
const ratesFor = (m) => RATES[m] || null;

/** Un paquete simulado: tantos caracteres piden, tantos tokens cuestan. */
function harness({ chars, charsPerToken = 2.19, countFails = false }) {
  const seen = [];
  return {
    seen,
    build: async (totalChars, perFileChars) => {
      const sent = Math.min(chars, totalChars);
      seen.push(totalChars);
      return { request: { sent }, systemBlocks: [], messages: [], documentChars: sent, overheadChars: 0 };
    },
    count: async (_b, _m) => (countFails ? null : Math.ceil(seen[seen.length - 1] >= chars ? chars / charsPerToken : seen[seen.length - 1] / charsPerToken)),
  };
}

test("el techo se dimensiona con el modelo que va a correr, no con el mas caro", () => {
  // Dimensionar al peor caso desperdiciaba el 42% del presupuesto en cada corrida.
  const rates = primaryRates(["claude-sonnet-5", "claude-sonnet-4-5", "claude-haiku-4-5"], ratesFor);
  assert.strictEqual(rates.inputPerMTok, 2, "manda Sonnet 5, que es el primario");
});

test("la exposicion a un fallback caro queda cuantificada", () => {
  // Lo que se resigna al no dimensionar al peor caso: si cae a Sonnet 4.5, hasta 1,5x.
  const factor = fallbackExposure(["claude-sonnet-5", "claude-sonnet-4-5"], ratesFor);
  assert.strictEqual(factor, 1.5);
  assert.strictEqual(fallbackExposure(["claude-sonnet-5"], ratesFor), 1, "sin fallback caro no hay exposicion");
});

test("un modelo desconocido no rompe el calculo", () => {
  assert.strictEqual(primaryRates(["inventado"], ratesFor), null);
  assert.strictEqual(primaryRates([], ratesFor), null);
});

test("la asignacion de entrada descuenta el lugar del informe", () => {
  // $1,54 de techo, salida de 24.000 tokens a $10/M = $0,24; quedan $1,30 a $2/M.
  const allowance = inputTokenAllowance({ ceilingUsd: 1.54, rates: SONNET5, outputTokens: 24000 });
  assert.strictEqual(allowance, 650000);
});

test("sin techo configurado no hay asignacion", () => {
  assert.strictEqual(inputTokenAllowance({ ceilingUsd: 0, rates: SONNET5, outputTokens: 24000 }), null);
});

test("un paquete que entra en el techo no se toca", async () => {
  // 400.000 caracteres a 2,19 son ~182.649 tokens: $0,37 de entrada, sobra de sobra.
  const h = harness({ chars: 400000 });
  const out = await fitToCeiling({
    ceilingUsd: 1.54, rates: SONNET5, maxOutputTokens: 64000,
    totalChars: 1800000, perFileChars: 1000000, build: h.build, count: h.count,
  });
  assert.strictEqual(out.clamped, false, "no deberia haber recortado");
  assert.strictEqual(out.passes, 1);
  assert.ok(out.estimatedUsd <= 1.54, `costo estimado ${out.estimatedUsd}`);
});

test("un paquete que se pasa se recorta hasta entrar, y el costo respeta el techo", async () => {
  // 3.000.000 de caracteres son ~1,37M de tokens: $2,74 solo de entrada a $2/M.
  const h = harness({ chars: 3000000 });
  const out = await fitToCeiling({
    ceilingUsd: 1.54, rates: SONNET5, maxOutputTokens: 64000,
    totalChars: 1800000, perFileChars: 1000000, build: h.build, count: h.count,
  });
  assert.strictEqual(out.clamped, true, "tendria que haber recortado");
  assert.ok(out.estimatedUsd <= 1.54 + 0.001, `costo estimado ${out.estimatedUsd} supera el techo`);
  assert.ok(h.seen.length > 1, "tendria que haber vuelto a armar el pedido");
  assert.ok(h.seen[h.seen.length - 1] < h.seen[0], "el presupuesto tiene que haber bajado");
});

test("el informe nunca se recorta por debajo del minimo: se recorta la entrada", async () => {
  const h = harness({ chars: 3000000 });
  const out = await fitToCeiling({
    ceilingUsd: 1.54, rates: SONNET5, maxOutputTokens: 64000,
    totalChars: 1800000, perFileChars: 1000000, build: h.build, count: h.count,
  });
  assert.ok(out.maxTokens >= MIN_OUTPUT_TOKENS, `techo de salida ${out.maxTokens} por debajo del minimo`);
});

test("con el modelo caro el mismo paquete entra menos, y el techo igual se respeta", async () => {
  const h5 = harness({ chars: 3000000 });
  const h45 = harness({ chars: 3000000 });
  const barato = await fitToCeiling({ ceilingUsd: 1.54, rates: SONNET5, maxOutputTokens: 64000, totalChars: 1800000, perFileChars: 1000000, build: h5.build, count: h5.count });
  const caro = await fitToCeiling({ ceilingUsd: 1.54, rates: SONNET45, maxOutputTokens: 64000, totalChars: 1800000, perFileChars: 1000000, build: h45.build, count: h45.count });
  assert.ok(caro.totalChars < barato.totalChars, "el modelo mas caro tiene que dejar entrar menos documento");
  assert.ok(caro.estimatedUsd <= 1.54 + 0.001);
  assert.ok(barato.estimatedUsd <= 1.54 + 0.001);
});

test("si count_tokens no responde se estima de mas, nunca de menos", async () => {
  const chars = 400000;
  const h = harness({ chars, countFails: true });
  const out = await fitToCeiling({
    ceilingUsd: 1.54, rates: SONNET5, maxOutputTokens: 64000,
    totalChars: 1800000, perFileChars: 1000000, build: h.build, count: h.count,
  });
  assert.strictEqual(out.counted, false);
  // La relacion pesimista (2,0) tiene que dar MAS tokens que la real (2,19).
  assert.strictEqual(out.inputTokens, Math.ceil(chars / PESSIMISTIC_CHARS_PER_TOKEN));
  assert.ok(out.inputTokens > chars / 2.19, "estimar de menos haria que el techo no valga");
});

test("sin techo configurado se manda todo lo que el presupuesto permite", async () => {
  const h = harness({ chars: 3000000 });
  const out = await fitToCeiling({
    ceilingUsd: 0, rates: SONNET5, maxOutputTokens: 64000,
    totalChars: 1800000, perFileChars: 1000000, build: h.build, count: h.count,
  });
  assert.strictEqual(out.clamped, false);
  assert.strictEqual(out.totalChars, 1800000);
});

test("el precio se compone de entrada y salida", () => {
  assert.strictEqual(priceOf({ inputTokens: 1e6, outputTokens: 0, rates: SONNET5 }), 2);
  assert.strictEqual(priceOf({ inputTokens: 0, outputTokens: 1e6, rates: SONNET5 }), 10);
  assert.strictEqual(priceOf({ inputTokens: 0, outputTokens: 0, rates: null }), null);
});
