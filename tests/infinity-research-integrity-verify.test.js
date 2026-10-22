"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { researchIntegrityDigest } = require("../src/infinity/research-integrity");
const { verifyResearchIntegrity } = require("../src/infinity/research-integrity-verify");

test("accepts identical research with reordered object keys", () => {
  const original = { question: "Q", evidence: ["A"], source: { title: "T", url: "https://example.org" } };
  const reordered = { source: { url: "https://example.org", title: "T" }, evidence: ["A"], question: "Q" };
  assert.equal(verifyResearchIntegrity(reordered, researchIntegrityDigest(original)), true);
});

test("detects changed evidence and order", () => {
  const original = { evidence: ["A", "B"] };
  const digest = researchIntegrityDigest(original);
  assert.equal(verifyResearchIntegrity({ evidence: ["A", "C"] }, digest), false);
  assert.equal(verifyResearchIntegrity({ evidence: ["B", "A"] }, digest), false);
});

test("rejects malformed or untrusted digest values", () => {
  const record = { evidence: ["A"] };
  for (const digest of [null, "", "sha1:" + "a".repeat(40), "sha256:" + "A".repeat(64), "sha256:" + "z".repeat(64), "sha256:" + "0".repeat(63)]) {
    assert.throws(() => verifyResearchIntegrity(record, digest), /Invalid expected research digest/);
  }
});
