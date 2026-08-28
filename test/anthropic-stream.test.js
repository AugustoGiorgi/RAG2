"use strict";
// readAnthropicStream: reconstruye la respuesta no-streaming a partir del SSE.
//
// La review pide max_tokens 16000 y genera ~14k tokens, que tardan 4-5 minutos. Contra un
// timeout TOTAL de 5 minutos se abortaba casi terminada, y el manejador de timeout volvia a
// armar el pedido entero y lo corria de nuevo: de ahi los 15 minutos por corrida. Con
// streaming el timeout pasa a medir silencio entre chunks, no duracion total.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
// eslint-disable-next-line no-eval
const readAnthropicStream = eval(`(${src.match(/async function readAnthropicStream[\s\S]*?\n}/)[0]})`);

/** Un cuerpo de respuesta que entrega el SSE partido en trozos arbitrarios. */
function bodyFrom(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return { getReader: () => ({ read: async () => (i < chunks.length ? { done: false, value: encoder.encode(chunks[i++]) } : { done: true }) }) };
}
const frame = (type, obj) => `event: ${type}\ndata: ${JSON.stringify({ type, ...obj })}\n\n`;

const HAPPY = [
  frame("message_start", { message: { model: "claude-sonnet-4-5-20250929", usage: { input_tokens: 12, cache_read_input_tokens: 900 } } }),
  frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
  frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: '{"issues":' } }),
  frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: "[]}" } }),
  frame("content_block_stop", { index: 0 }),
  frame("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3400 } }),
  frame("message_stop", {}),
];

test("arma content, usage, stop_reason y model como la respuesta no-streaming", async () => {
  const data = await readAnthropicStream({ body: bodyFrom(HAPPY) });
  assert.deepStrictEqual(data.content, [{ type: "text", text: '{"issues":[]}' }]);
  assert.strictEqual(data.stop_reason, "end_turn");
  assert.strictEqual(data.model, "claude-sonnet-4-5-20250929");
  // El usage se acumula entre message_start y message_delta: el costo depende de eso.
  assert.strictEqual(data.usage.input_tokens, 12);
  assert.strictEqual(data.usage.cache_read_input_tokens, 900);
  assert.strictEqual(data.usage.output_tokens, 3400);
});

test("no depende de dónde caigan los límites de chunk", async () => {
  // TCP parte donde quiere: un evento puede llegar cortado por la mitad.
  const entero = HAPPY.join("");
  for (const corte of [1, 7, 31, 150, entero.length - 1]) {
    const data = await readAnthropicStream({ body: bodyFrom([entero.slice(0, corte), entero.slice(corte)]) });
    assert.strictEqual(data.content[0].text, '{"issues":[]}', `falla partiendo en ${corte}`);
  }
  // Byte por byte, el caso extremo.
  const porByte = await readAnthropicStream({ body: bodyFrom(entero.split("")) });
  assert.strictEqual(porByte.content[0].text, '{"issues":[]}');
});

test("re-arma el temporizador de inactividad en cada chunk", async () => {
  let latidos = 0;
  await readAnthropicStream({ body: bodyFrom(HAPPY) }, () => { latidos += 1; });
  assert.strictEqual(latidos, HAPPY.length, "cada chunk recibido es señal de vida");
});

test("varios bloques de texto se concatenan en orden", async () => {
  const data = await readAnthropicStream({ body: bodyFrom([
    frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: "uno" } }),
    frame("content_block_start", { index: 1, content_block: { type: "text", text: "" } }),
    frame("content_block_delta", { index: 1, delta: { type: "text_delta", text: "dos" } }),
  ]) });
  assert.deepStrictEqual(data.content.map((b) => b.text), ["uno", "dos"]);
});

test("un evento de error del stream se propaga", async () => {
  await assert.rejects(
    () => readAnthropicStream({ body: bodyFrom([frame("error", { error: { message: "overloaded_error" } })]) }),
    /overloaded_error/
  );
});

test("ignora keep-alives, [DONE] y JSON corrupto sin romperse", async () => {
  const data = await readAnthropicStream({ body: bodyFrom([
    ": ping\n\n",
    frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
    "data: {esto no es json}\n\n",
    frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: "ok" } }),
    "data: [DONE]\n\n",
  ]) });
  assert.strictEqual(data.content[0].text, "ok");
});
