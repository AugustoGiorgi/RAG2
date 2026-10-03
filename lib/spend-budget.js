"use strict";
// Which budget pays for each user's AI actions, in this order:
//   1. a budget group the owners put the user in (its members share it);
//   2. the user's own limit;
//   3. a plain user of a client firm with no budget of their own shares the budget of the
//      firm's firm administrator: give the firm admin 15 USD and the firm admin plus those
//      users share the 15 USD. Never in the owners' own firm (the default tenant), where
//      nobody should be capped by somebody else's limit;
//   4. no limit.
// Spend is all-time, from the cost log. What a deleted user spent stays on their firm's
// shared budget, so deleting a user never frees budget.

const NOT_A_USER = new Set(["", "unknown", "anonymous"]);

// helpers: { costOf(entry), round(n), limitOf(value) -> number|null, roleOf(user), defaultTenantId }
function budgetPools({ users = [], budgetGroups = [], costEntries = [] } = {}, helpers) {
  const { costOf, round, limitOf, roleOf, defaultTenantId } = helpers;
  const tenantOf = (tenantId) => String(tenantId || defaultTenantId);
  const groups = new Map(budgetGroups.filter((g) => g && g.id).map((g) => [g.id, g]));
  const byName = new Map(users.filter((u) => u && u.username).map((u) => [u.username, u]));

  const ownKey = (user) => {
    if (user.budgetGroupId && groups.has(user.budgetGroupId)) return `group:${user.budgetGroupId}`;
    if (limitOf(user.spendLimitUsd) !== null) return `user:${user.username}`;
    return null;
  };

  // The firm admin whose budget each client firm shares: the first created that has one.
  const firmAdminOf = new Map();
  [...byName.values()]
    .filter((u) => roleOf(u) === "firm_admin" && tenantOf(u.tenantId) !== defaultTenantId && ownKey(u))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || a.username.localeCompare(b.username))
    .forEach((u) => { if (!firmAdminOf.has(tenantOf(u.tenantId))) firmAdminOf.set(tenantOf(u.tenantId), u); });

  const keyOf = new Map();
  const sharedFrom = new Map();
  for (const user of byName.values()) {
    const own = ownKey(user);
    const firmAdmin = firmAdminOf.get(tenantOf(user.tenantId));
    if (own) keyOf.set(user.username, own);
    else if (roleOf(user) === "user" && firmAdmin) {
      keyOf.set(user.username, ownKey(firmAdmin));
      sharedFrom.set(user.username, firmAdmin);
    } else keyOf.set(user.username, `user:${user.username}`);
  }

  const spent = new Map();
  const ownSpent = new Map();
  for (const entry of costEntries) {
    const name = String(entry?.username || "");
    const cost = Number(costOf(entry) || 0);
    let key = keyOf.get(name);
    if (!key) {
      const firmAdmin = NOT_A_USER.has(name) ? null : firmAdminOf.get(tenantOf(entry.tenantId));
      key = firmAdmin ? ownKey(firmAdmin) : `user:${name}`;
    }
    spent.set(key, (spent.get(key) || 0) + cost);
    ownSpent.set(name, (ownSpent.get(name) || 0) + cost);
  }

  const members = new Map();
  for (const key of keyOf.values()) members.set(key, (members.get(key) || 0) + 1);

  const limitOfKey = (key) => (key.startsWith("group:")
    ? limitOf(groups.get(key.slice(6))?.limitUsd)
    : limitOf(byName.get(key.slice(5))?.spendLimitUsd));

  function summary(key) {
    const limitUsd = limitOfKey(key);
    const usedUsd = round(spent.get(key) || 0);
    const hasLimit = limitUsd !== null;
    const remainingUsd = hasLimit ? round(Math.max(0, Number(limitUsd || 0) - usedUsd)) : null;
    return { hasLimit, limitUsd, usedUsd, remainingUsd, poolMembers: members.get(key) || 0 };
  }

  function forUser(username) {
    const key = keyOf.get(username) || `user:${username}`;
    const budget = { ...summary(key), ownUsedUsd: round(ownSpent.get(username) || 0) };
    if (!budget.poolMembers) budget.poolMembers = 1;
    if (key.startsWith("group:")) {
      const group = groups.get(key.slice(6));
      budget.budgetGroupId = group.id;
      budget.budgetGroupName = group.name;
    }
    const firmAdmin = sharedFrom.get(username);
    if (firmAdmin) {
      budget.sharedFromUsername = firmAdmin.username;
      budget.sharedFromName = firmAdmin.displayName || firmAdmin.username;
    }
    return budget;
  }

  const forGroup = (groupId) => summary(`group:${groupId}`);

  return { forUser, forGroup };
}

module.exports = { budgetPools };
