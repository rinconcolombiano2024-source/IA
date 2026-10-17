"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createResearchRecord } = require("../src/infinity/research-record");
const valid = { question: "Can algorithm X reduce latency?", hypothesis: "X may reduce latency", sourceUrl: "https://example.org/study", sourceTitle: "Study" };
test("creates immutable unverified hypothesis with provenance", () => {
  const record = createResearchRecord(valid, { now: "2026-10-17T00:00:00Z" });
  assert.equal(record.evidenceState, "hypothesis");
  assert.equal(record.verified, false);
  assert.equal(record.createdAt, "2026-10-17T00:00:00.000Z");
  assert.ok(Object.isFrozen(record.source));
  assert.ok(Object.isFrozen(record.evidence));
});
test("rejects unsupported evidence claims and empty supporting evidence", () => {
  assert.throws(() => createResearchRecord({ ...valid, evidenceState: "proven" }), /Invalid evidenceState/);
  assert.throws(() => createResearchRecord({ ...valid, evidenceState: "clinically_validated" }), /Evidence is required/);
});
test("rejects unsafe source schemes and embedded credentials", () => {
  assert.throws(() => createResearchRecord({ ...valid, sourceUrl: "http://example.org" }), /HTTPS/);
  assert.throws(() => createResearchRecord({ ...valid, sourceUrl: "https://user:pass@example.org" }), /HTTPS/);
});
test("requires bounded text and validates evidence", () => {
  assert.throws(() => createResearchRecord({ ...valid, question: "" }), /Invalid question/);
  assert.throws(() => createResearchRecord({ ...valid, evidence: [""] }), /Invalid evidence/);
});
