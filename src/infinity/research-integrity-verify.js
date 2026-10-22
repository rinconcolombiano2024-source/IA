"use strict";

const { timingSafeEqual } = require("node:crypto");
const { researchIntegrityDigest } = require("./research-integrity");

/**
 * Check that a research record still matches a previously stored digest.
 * This does not authenticate the digest or verify scientific correctness.
 * The expected digest MUST come from a trusted, access-controlled store.
 */
function verifyResearchIntegrity(record, expectedDigest) {
  if (typeof expectedDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(expectedDigest)) {
    throw new TypeError("Invalid expected research digest");
  }
  const actual = Buffer.from(researchIntegrityDigest(record).slice(7), "hex");
  const expected = Buffer.from(expectedDigest.slice(7), "hex");
  return timingSafeEqual(actual, expected);
}

module.exports = { verifyResearchIntegrity };
