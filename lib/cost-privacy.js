"use strict";
// What the app costs is for its owners only. Whatever a handler puts in a response about what
// a run cost — dollars, or the token counts dollars can be worked out from — is taken out
// before it reaches a browser that is not a global admin's. It runs on every JSON response,
// so it also covers data saved before this existed (a session that stored a whole review
// response) and any handler written later.
//
// It goes by exact names and by shape, never by "anything called cost": a strategy's
// extraCost, a penalty table's monthlyCost and a fixed asset's cost are the client's own
// figures and stay.

const ALWAYS = new Set(["costEstimate", "ceilingUsd", "ceilingClamped", "tokensUsed"]);

function isPlain(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// The API's usage object: { input_tokens, output_tokens, ... }.
function isTokenUsage(value) {
  return isPlain(value) && ("input_tokens" in value || "output_tokens" in value);
}

// What estimateClaudeCost and calculateCost return.
function isCostEstimate(value) {
  if (!isPlain(value)) return false;
  if ("totalUsd" in value && ("inputUsd" in value || "outputUsd" in value)) return true;
  return "totalCost" in value && ("inputCost" in value || "outputCost" in value);
}

function isCostData(value) {
  if (isTokenUsage(value) || isCostEstimate(value)) return true;
  return Array.isArray(value) && value.length > 0 && value.every((item) => isTokenUsage(item) || isCostEstimate(item));
}

// Returns the same value when there is nothing to remove; never changes its input.
function stripCostData(value) {
  if (Array.isArray(value)) {
    let out = null;
    for (let i = 0; i < value.length; i += 1) {
      const next = stripCostData(value[i]);
      if (next !== value[i]) {
        if (!out) out = value.slice();
        out[i] = next;
      }
    }
    return out || value;
  }
  if (!isPlain(value)) return value;
  let out = null;
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (ALWAYS.has(key) || isCostData(item)) {
      if (!out) out = { ...value };
      delete out[key];
      continue;
    }
    const next = stripCostData(item);
    if (next !== item) {
      if (!out) out = { ...value };
      out[key] = next;
    }
  }
  return out || value;
}

module.exports = { stripCostData };
