"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildResearchListQuery } = require("../src/infinity/research-list-query");
const principal = { authenticated: true, tenantId: "team_1", userId: "user@example.com" };

test("research listing always scopes tenant and owner", () => {
  const params = new URLSearchParams(buildResearchListQuery(principal));
  assert.equal(params.get("tenant_id"), "eq.team_1");
  assert.equal(params.get("owner_user_id"), "eq.user@example.com");
  assert.equal(params.get("limit"), "20");
  assert.equal(params.get("order"), "created_at.desc");
});

test("research listing accepts bounded limits only", () => {
  assert.equal(new URLSearchParams(buildResearchListQuery(principal, { limit: 100 })).get("limit"), "100");
  for (const limit of [0, 101, -1, 1.5, "20", NaN]) {
    assert.throws(() => buildResearchListQuery(principal, { limit }), /limit/);
  }
});

test("research listing rejects untrusted principal", () => {
  assert.throws(() => buildResearchListQuery({ ...principal, authenticated: false }), /Authenticated/);
  assert.throws(() => buildResearchListQuery({ ...principal, tenantId: "bad;filter" }), /tenant/);
});
