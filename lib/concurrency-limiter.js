"use strict";

function createConcurrencyLimiter({ maxActive, maxQueue, waitMs }) {
  let active = 0;
  const queue = [];

  function release() {
    while (queue.length) {
      const waiter = queue.shift();
      if (waiter.done) continue;
      waiter.done = true;
      clearTimeout(waiter.timer);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      waiter.resolve(makeRelease());
      return;
    }
    active -= 1;
  }

  function makeRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }

  function acquire(signal) {
    if (signal?.aborted) return Promise.reject(Object.assign(new Error("Request cancelled."), { code: "ABORTED" }));
    if (active < maxActive) {
      active += 1;
      return Promise.resolve(makeRelease());
    }
    if (queue.length >= maxQueue) {
      return Promise.reject(Object.assign(new Error("Server is busy. Please retry shortly."), { code: "QUEUE_FULL" }));
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, done: false, timer: null, onAbort: null };
      const cancel = (code) => {
        if (waiter.done) return;
        waiter.done = true;
        clearTimeout(waiter.timer);
        signal?.removeEventListener("abort", waiter.onAbort);
        const index = queue.indexOf(waiter);
        if (index !== -1) queue.splice(index, 1);
        reject(Object.assign(new Error(code === "ABORTED" ? "Request cancelled." : "Server is busy. Please retry shortly."), { code }));
      };
      waiter.onAbort = () => cancel("ABORTED");
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      waiter.timer = setTimeout(() => cancel("QUEUE_TIMEOUT"), waitMs);
      queue.push(waiter);
      if (signal?.aborted) waiter.onAbort();
    });
  }

  return { acquire, stats: () => ({ active, queued: queue.length }) };
}

module.exports = { createConcurrencyLimiter };
