"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createResearchDossier } = require("../src/infinity/research-dossier");
const input = {
  question: "Does algorithm X reduce latency?",
  hypothesis: "X may reduce median latency",
  sourceUrl: "https://example.org/paper",
  sourceTitle: "Background paper",
  steps: [{ action: "Run benchmark with fixed input", expectedObservation: "Measured latency" }],
  successCriterion: "Median latency decreases against baseline"
};
test("dossier contains provenance and never claims verification", () => {
  const dossier = createResearchDossier(input, { now: "2026-10-17T00:00:00Z" });
  assert.equal(dossier.schemaVersion, 1);
  assert.equal(dossier.verificationStatus, "unverified");
  assert.equal(dossier.experiment.executionStatus, "not_executed");
  assert.equal(dossier.experiment.approvalRequired, true);
  assert.equal(dossier.experiment.externalExecutionAllowed, false);
  assert.equal(dossier.sources[0].url, "https://example.org/paper");
  assert.equal(dossier.generatedAt, "2026-10-17T00:00:00.000Z");
  assert.ok(Object.isFrozen(dossier.warnings));
});
test("dossier rejects invalid experiment definitions", () => {
  assert.throws(() => createResearchDossier({ ...input, steps: [] }), /1 to 12/);
  assert.throws(() => createResearchDossier({ ...input, sourceUrl: "file:///etc/passwd" }), /HTTPS/);
});
