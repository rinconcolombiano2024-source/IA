"use strict";

const { createHash } = require("node:crypto");

/**
 * Deterministic integrity fingerprint for JSON-compatible research evidence.
 * A digest detects accidental changes; it is NOT a signature, provenance
 * verification, authentication or proof of scientific correctness.
 */
function canonicalJson(value) {
  const seen = new Set();
  function normalize(item) {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("Non-finite research value");
      return item;
    }
    if (!item || typeof item !== "object") throw new TypeError("Non-JSON research value");
    if (seen.has(item)) throw new TypeError("Cyclic research value");
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      result = item.map(normalize);
    } else {
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
        throw new TypeError("Research value must be a plain object");
      }
      result = {};
      for (const key of Object.keys(item).sort()) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          throw new TypeError("Unsafe research key");
        }
        Object.defineProperty(result, key, { value: normalize(item[key]), enumerable: true, writable: true, configurable: true });
      }
    }
    seen.delete(item);
    return result;
  }
  return JSON.stringify(normalize(value));
}

function researchIntegrityDigest(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Research record must be an object");
  }
  const json = canonicalJson(record);
  if (Buffer.byteLength(json, "utf8") > 65536) throw new RangeError("Research record exceeds integrity limit");
  return "sha256:" + createHash("sha256").update(json, "utf8").digest("hex");
}

module.exports = { canonicalJson, researchIntegrityDigest };
