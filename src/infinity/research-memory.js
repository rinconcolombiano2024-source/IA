"use strict";

/**
 * In-memory, tenant-isolated research memory prototype.
 * Not durable, not encrypted, not a replacement for authenticated storage.
 */
const { randomUUID } = require("node:crypto");
const { createResearchRecord } = require("./research-record");

function validTenant(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw new TypeError("Invalid tenant identifier");
  }
  return value;
}

function createResearchMemory(options = {}) {
  const maxEntries = Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0 && options.maxEntries <= 10000
    ? options.maxEntries : 200;
  const byTenant = new Map();
  function records(tenantId) {
    const key = validTenant(tenantId);
    if (!byTenant.has(key)) byTenant.set(key, new Map());
    return byTenant.get(key);
  }
  function add(tenantId, input) {
    const tenant = records(tenantId);
    if (tenant.size >= maxEntries) throw new RangeError("Tenant memory capacity exceeded");
    const record = createResearchRecord(input);
    const id = randomUUID();
    tenant.set(id, record);
    return Object.freeze({ id, record });
  }
  function get(tenantId, id) {
    if (typeof id !== "string") return null;
    const item = records(tenantId).get(id);
    return item ? Object.freeze({ id, record: item }) : null;
  }
  function list(tenantId, limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError("Invalid list limit");
    return Object.freeze(Array.from(records(tenantId), ([id, record]) => Object.freeze({ id, record })).slice(-limit).reverse());
  }
  function remove(tenantId, id) {
    if (typeof id !== "string") return false;
    return records(tenantId).delete(id);
  }
  function clear(tenantId) {
    const key = validTenant(tenantId);
    byTenant.delete(key);
  }
  return Object.freeze({ add, get, list, remove, clear, durable: false });
}

module.exports = { createResearchMemory };
