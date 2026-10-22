"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalJson, researchIntegrityDigest } = require("../src/infinity/research-integrity");

test("integrity digest is stable across object key order", () => {
  const a = { question: "Q", evidence: ["A", "B"], source: { url: "https://example.org", title: "T" } };
  const b = { source: { title: "T", url: "https://example.org" }, evidence: ["A", "B"], question: "Q" };
  assert.equal(researchIntegrityDigest(a), researchIntegrityDigest(b));
  assert.match(researchIntegrityDigest(a), /^sha256:[0-9a-f]{64}$/);
});

test("integrity digest changes when evidence changes", () => {
  assert.notEqual(researchIntegrityDigest({ evidence: ["A"] }), researchIntegrityDigest({ evidence: ["B"] }));
  assert.notEqual(researchIntegrityDigest({ evidence: ["A", "B"] }), researchIntegrityDigest({ evidence: ["B", "A"] }));
});

test("integrity rejects cycles and non-JSON or unsafe values", () => {
  const cycle = {}; cycle.self = cycle;
  for (const value of [cycle, { x: undefined }, { x: NaN }, { x: 1n }, new Date(), Object.defineProperty({}, "__proto__", { value: "bad", enumerable: true })]) {
    assert.throws(() => canonicalJson(value));
  }
  assert.throws(() => researchIntegrityDigest(null));
});
