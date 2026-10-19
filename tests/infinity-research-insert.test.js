"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createResearchRecord } = require("../src/infinity/research-record");
const { buildResearchInsert } = require("../src/infinity/research-insert");
const principal = { authenticated: true, tenantId: "lab_1", userId: "researcher-1" };
const input = { question: "Does A outperform B?", hypothesis: "A may outperform B", sourceUrl: "https://example.org/paper", sourceTitle: "Example" };

test("insert binds server principal and keeps evidence unverified", () => {
  const record = createResearchRecord(input);
  const payload = buildResearchInsert(principal, record, { projectId: "study_1" });
  assert.equal(payload.tenant_id, "lab_1");
  assert.equal(payload.owner_user_id, "researcher-1");
  assert.equal(payload.project_id, "study_1");
  assert.equal(payload.evidence_verified, false);
  assert.equal(payload.record.verified, false);
});

test("insert rejects forged verified research and invalid principals", () => {
  const record = createResearchRecord(input);
  assert.throws(() => buildResearchInsert(principal, { ...record, verified: true }), /Invalid unverified/);
  assert.throws(() => buildResearchInsert({ ...principal, authenticated: false }, record), /Authenticated/);
  assert.throws(() => buildResearchInsert(principal, record, { projectId: "../bad" }), /project/);
});

test("insert does not mutate the original record", () => {
  const record = createResearchRecord(input);
  const payload = buildResearchInsert(principal, record);
  assert.notEqual(payload.record, record);
  assert.deepEqual(payload.record, record);
});
