"use strict";
// Qué presupuesto paga las acciones de cada usuario (lib/spend-budget.js). El caso que pidieron:
// el dueño le da 15 USD al firm_admin y él más los usuarios de su firma comparten esos 15 USD.
// Usuarios, firmas y montos ficticios.
const { test } = require("node:test");
const assert = require("node:assert");
const { budgetPools } = require("../lib/spend-budget");

const helpers = {
  costOf: (entry) => entry.cost,
  round: (n) => Number(Number(n || 0).toFixed(6)),
  limitOf: (value) => {
    if (value === null || value === "" || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  },
  roleOf: (u) => (u.role === "admin" || u.role === "firm_admin" ? u.role : "user"),
  defaultTenantId: "owners",
};
const spend = (username, tenantId, cost) => ({ username, tenantId, cost });

function firm() {
  return {
    users: [
      { username: "boss", role: "firm_admin", tenantId: "firm-a", displayName: "Bea Boss", spendLimitUsd: 15, createdAt: "2026-10-01" },
      { username: "ana", role: "user", tenantId: "firm-a", spendLimitUsd: null },
      { username: "ben", role: "user", tenantId: "firm-a" },
      { username: "cam", role: "user", tenantId: "firm-a" },
      { username: "dan", role: "user", tenantId: "firm-a" },
      { username: "zoe", role: "user", tenantId: "firm-b" },
      { username: "rita", role: "user", tenantId: "owners" },
    ],
    budgetGroups: [],
    costEntries: [
      spend("boss", "firm-a", 1), spend("ana", "firm-a", 2), spend("ben", "firm-a", 3),
      spend("zoe", "firm-b", 50), spend("rita", "owners", 40),
    ],
  };
}

test("el firm_admin con 15 USD y los usuarios de su firma comparten esos 15 USD", () => {
  const pools = budgetPools(firm(), helpers);
  const boss = pools.forUser("boss");
  assert.deepStrictEqual([boss.limitUsd, boss.usedUsd, boss.remainingUsd, boss.poolMembers], [15, 6, 9, 5]);
  for (const name of ["ana", "ben", "cam", "dan"]) {
    const b = pools.forUser(name);
    assert.deepStrictEqual([b.limitUsd, b.usedUsd, b.remainingUsd, b.sharedFromUsername, b.sharedFromName], [15, 6, 9, "boss", "Bea Boss"], name);
  }
  assert.strictEqual(pools.forUser("ben").ownUsedUsd, 3, "lo que gasto cada uno se sigue viendo");
});

test("otra firma y la firma de los dueños no tocan ese presupuesto", () => {
  const pools = budgetPools(firm(), helpers);
  assert.deepStrictEqual([pools.forUser("zoe").hasLimit, pools.forUser("zoe").usedUsd], [false, 50]);
  assert.strictEqual(pools.forUser("rita").hasLimit, false);
  assert.strictEqual(pools.forUser("zoe").sharedFromUsername, undefined);
});

test("en la firma de los dueños nadie queda limitado por el presupuesto de otro", () => {
  const data = firm();
  data.users.push({ username: "tester", role: "firm_admin", tenantId: "owners", spendLimitUsd: 1 });
  const pools = budgetPools(data, helpers);
  assert.strictEqual(pools.forUser("rita").hasLimit, false);
  assert.deepStrictEqual([pools.forUser("tester").limitUsd, pools.forUser("tester").usedUsd], [1, 0]);
});

test("un usuario con presupuesto propio o en un grupo no entra al compartido", () => {
  const data = firm();
  data.users.find((u) => u.username === "ana").spendLimitUsd = 4;
  data.users.find((u) => u.username === "ben").budgetGroupId = "g1";
  data.budgetGroups.push({ id: "g1", name: "Pilot", limitUsd: 20 });
  const pools = budgetPools(data, helpers);
  assert.deepStrictEqual([pools.forUser("ana").limitUsd, pools.forUser("ana").usedUsd], [4, 2]);
  assert.deepStrictEqual([pools.forUser("ben").limitUsd, pools.forUser("ben").budgetGroupName], [20, "Pilot"]);
  const boss = pools.forUser("boss");
  assert.deepStrictEqual([boss.usedUsd, boss.poolMembers], [1, 3], "boss + cam + dan");
});

test("si el firm_admin no tiene presupuesto, sus usuarios siguen sin limite", () => {
  const data = firm();
  data.users.find((u) => u.username === "boss").spendLimitUsd = null;
  const pools = budgetPools(data, helpers);
  assert.strictEqual(pools.forUser("ana").hasLimit, false);
  assert.strictEqual(pools.forUser("ana").usedUsd, 2, "cada uno con lo suyo");
  assert.strictEqual(pools.forUser("ana").sharedFromUsername, undefined);
});

test("borrar un usuario no libera presupuesto: lo que gasto sigue contando para su firma", () => {
  const data = firm();
  data.costEntries.push(spend("gone", "firm-a", 4), spend("unknown", "firm-a", 7));
  const pools = budgetPools(data, helpers);
  assert.strictEqual(pools.forUser("boss").usedUsd, 10, "6 + 4 del usuario borrado; 'unknown' no es un usuario");
});

test("con dos firm_admin con presupuesto, se comparte el del primero creado", () => {
  const data = firm();
  data.users.push({ username: "boss2", role: "firm_admin", tenantId: "firm-a", spendLimitUsd: 99, createdAt: "2026-10-02" });
  const pools = budgetPools(data, helpers);
  assert.strictEqual(pools.forUser("ana").limitUsd, 15);
  assert.deepStrictEqual([pools.forUser("boss2").limitUsd, pools.forUser("boss2").poolMembers], [99, 1]);
});

test("si el firm_admin esta en un grupo, sus usuarios comparten el grupo", () => {
  const data = firm();
  const boss = data.users.find((u) => u.username === "boss");
  boss.spendLimitUsd = null;
  boss.budgetGroupId = "g1";
  data.budgetGroups.push({ id: "g1", name: "Pilot", limitUsd: 20 });
  const pools = budgetPools(data, helpers);
  assert.deepStrictEqual([pools.forUser("ana").limitUsd, pools.forUser("ana").usedUsd, pools.forUser("ana").sharedFromUsername], [20, 6, "boss"]);
  assert.deepStrictEqual([pools.forGroup("g1").usedUsd, pools.forGroup("g1").poolMembers], [6, 5]);
});

test("lo de antes no cambia: limite individual y grupo comun", () => {
  const pools = budgetPools({
    users: [
      { username: "solo", tenantId: "owners", spendLimitUsd: 10 },
      { username: "g-a", tenantId: "owners", budgetGroupId: "g" },
      { username: "g-b", tenantId: "firm-x", budgetGroupId: "g" },
    ],
    budgetGroups: [{ id: "g", name: "Shared", limitUsd: 5 }],
    costEntries: [spend("solo", "owners", 3), spend("g-a", "owners", 1), spend("g-b", "firm-x", 2)],
  }, helpers);
  assert.deepStrictEqual([pools.forUser("solo").limitUsd, pools.forUser("solo").usedUsd, pools.forUser("solo").remainingUsd], [10, 3, 7]);
  assert.deepStrictEqual([pools.forUser("g-b").usedUsd, pools.forUser("g-b").remainingUsd, pools.forUser("g-b").budgetGroupId], [3, 2, "g"]);
  assert.deepStrictEqual([pools.forUser("nadie").hasLimit, pools.forUser("nadie").usedUsd], [false, 0]);
});
