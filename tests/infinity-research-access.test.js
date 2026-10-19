"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { assertResearchOwnership } = require("../src/infinity/research-access");
const identity = { authenticated: true, tenantId: "org_1", userId: "user-1" };

test("allows exact owner", () => {
  assert.equal(assertResearchOwnership(identity, { tenant_id: "org_1", owner_user_id: "user-1" }), true);
});

test("denies other tenant and other user without leaking existence", () => {
  for (const row of [
    { tenant_id: "org_2", owner_user_id: "user-1" },
    { tenant_id: "org_1", owner_user_id: "user-2" },
    null
  ]) {
    assert.throws(() => assertResearchOwnership(identity, row), {
      code: "RESEARCH_NOT_FOUND", message: "Research record not found"
    });
  }
});

test("rejects unauthenticated identity", () => {
  assert.throws(() => assertResearchOwnership(
    { tenantId: "org_1", userId: "user-1" },
    { tenant_id: "org_1", owner_user_id: "user-1" }
  ), /Authenticated/);
});
