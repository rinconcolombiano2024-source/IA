"use strict";

const fs = require("node:fs");
const path = require("node:path");

function clampLimit(value, fallback = 20, max = 200) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function createLocalStateStore(options = {}) {
  const dataDir = String(options.dataDir || "").trim();
  if (!dataDir) {
    throw new Error("Local state store requires dataDir.");
  }

  const historyPath = path.join(dataDir, "history.json");

  function ensureDataDir() {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  async function loadHistory(limit = 20) {
    ensureDataDir();
    if (!fs.existsSync(historyPath)) return [];

    try {
      const parsed = JSON.parse(fs.readFileSync(historyPath, "utf8"));
      return Array.isArray(parsed)
        ? parsed.slice(0, clampLimit(limit))
        : [];
    } catch {
      return [];
    }
  }

  async function appendHistory(entry) {
    ensureDataDir();
    const history = await loadHistory(200);
    history.unshift(entry);

    const serialized = JSON.stringify(history.slice(0, 200), null, 2);
    const tempPath = `${historyPath}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(tempPath, serialized, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, historyPath);
  }

  function summary() {
    return {
      provider: "local",
      durable: false,
      scope: "single-runtime",
      description: "Filesystem local; puede ser efimero en serverless."
    };
  }

  return Object.freeze({
    provider: "local",
    durable: false,
    loadHistory,
    appendHistory,
    summary
  });
}

module.exports = {
  createLocalStateStore,
  clampLimit
};
