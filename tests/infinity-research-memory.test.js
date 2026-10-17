"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createResearchMemory } = require("../src/infinity/research-memory");
const input = { question: "Can X help?", hypothesis: "X may help", sourceUrl: "https://example.org/paper", sourceTitle: "Paper" };
test("tenant isolation, lookup and deletion", () => {
  const memory = createResearchMemory();
  const { id } = memory.add("tenantA", input);
  assert.equal(memory.get("tenantA", id).record.verified, false);
  assert.equal(memory.get("tenantB", id), null);
  assert.equal(memory.list("tenantB").length, 0);
  assert.equal(memory.remove("tenantB", id), false);
  assert.equal(memory.remove("tenantA", id), true);
  assert.equal(memory.get("tenantA", id), null);
});
test("limits entries and validates identifiers", () => {
  const memory = createResearchMemory({ maxEntries: 1 });
  memory.add("tenantA", input);
  assert.throws(() => memory.add("tenantA", input), /capacity/);
  assert.throws(() => memory.list("../bad"), /Invalid tenant/);
  assert.throws(() => memory.list("tenantA", 0), /Invalid list limit/);
});
test("clearing one tenant does not clear another", () => {
  const memory = createResearchMemory();
  memory.add("a", input); memory.add("b", input);
  memory.clear("a");
  assert.equal(memory.list("a").length, 0);
  assert.equal(memory.list("b").length, 1);
});
