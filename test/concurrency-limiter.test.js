"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createConcurrencyLimiter } = require("../lib/concurrency-limiter");

test("a slot is released only once even if finish and close both fire", async () => {
  const limiter = createConcurrencyLimiter({ maxActive: 1, maxQueue: 2, waitMs: 1000 });
  const releaseFirst = await limiter.acquire();
  const waiting = limiter.acquire();
  assert.deepEqual(limiter.stats(), { active: 1, queued: 1 });
  releaseFirst();
  const releaseSecond = await waiting;
  releaseFirst();
  assert.deepEqual(limiter.stats(), { active: 1, queued: 0 });
  releaseSecond();
  assert.deepEqual(limiter.stats(), { active: 0, queued: 0 });
});

test("the queue is bounded and cancelled requests leave it", async () => {
  const limiter = createConcurrencyLimiter({ maxActive: 1, maxQueue: 1, waitMs: 1000 });
  const release = await limiter.acquire();
  const abortController = new AbortController();
  const queued = limiter.acquire(abortController.signal);
  await assert.rejects(limiter.acquire(), { code: "QUEUE_FULL" });
  abortController.abort();
  await assert.rejects(queued, { code: "ABORTED" });
  assert.deepEqual(limiter.stats(), { active: 1, queued: 0 });
  release();
  assert.deepEqual(limiter.stats(), { active: 0, queued: 0 });
});

test("queued requests time out without consuming a slot", async () => {
  const limiter = createConcurrencyLimiter({ maxActive: 1, maxQueue: 1, waitMs: 20 });
  const release = await limiter.acquire();
  await assert.rejects(limiter.acquire(), { code: "QUEUE_TIMEOUT" });
  assert.deepEqual(limiter.stats(), { active: 1, queued: 0 });
  release();
});

test("20 simultaneous AI jobs complete without exceeding ten active slots", async () => {
  const limiter = createConcurrencyLimiter({ maxActive: 10, maxQueue: 40, waitMs: 1000 });
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 20 }, async () => {
    const release = await limiter.acquire();
    active += 1;
    peak = Math.max(peak, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      active -= 1;
      release();
    }
  }));
  assert.equal(peak, 10);
  assert.deepEqual(limiter.stats(), { active: 0, queued: 0 });
});
