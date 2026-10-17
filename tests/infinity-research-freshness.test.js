"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { assessResearchFreshness } = require("../src/infinity/research-freshness");
const record = { recordedAt: "2026-01-01T00:00:00Z", reviewAt: "2026-06-01T00:00:00Z" };
test("flags overdue research for human review", () => {
  const r = assessResearchFreshness(record, { now: "2026-10-17T00:00:00Z" });
  assert.equal(r.reviewDue, true);
  assert.equal(r.evidenceVerified, false);
  assert.equal(r.status, "human_review_required");
  assert.ok(Object.isFrozen(r));
});
test("retains pending review without promoting evidence", () => {
  const r = assessResearchFreshness(record, { now: "2026-02-01T00:00:00Z" });
  assert.equal(r.reviewDue, false);
  assert.equal(r.evidenceVerified, false);
});
test("rejects missing or inconsistent dates", () => {
  assert.throws(() => assessResearchFreshness({ ...record, reviewAt: "2025-01-01T00:00:00Z" }), /precede/);
  assert.throws(() => assessResearchFreshness({ ...record, recordedAt: "yesterday" }), /ISO/);
  assert.throws(() => assessResearchFreshness({ ...record, reviewAt: "2026-99-99T00:00:00Z" }), /Invalid/);
});
