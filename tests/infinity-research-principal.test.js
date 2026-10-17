"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { requireResearchPrincipal, researchOwnerFilter } = require("../src/infinity/research-principal");
test("derives immutable ownership scope from authenticated principal", () => {
  const scope = researchOwnerFilter({ authenticated: true, tenantId: "team_1", userId: "user-1" });
  assert.deepEqual(scope, { tenant_id: "team_1", owner_user_id: "user-1" });
  assert.equal(Object.isFrozen(scope), true);
});
test("rejects unauthenticated and malformed principals", () => {
  assert.throws(() => researchOwnerFilter({ tenantId: "team_1", userId: "user-1" }), /Authenticated/);
  assert.throws(() => requireResearchPrincipal({ authenticated: true, tenantId: "../bad", userId: "user-1" }), /tenant/);
  assert.throws(() => requireResearchPrincipal({ authenticated: true, tenantId: "team_1", userId: "" }), /user/);
});
