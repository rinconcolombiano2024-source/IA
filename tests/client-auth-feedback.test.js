"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("public client preserves the submitted prompt on authentication denial", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  assert.match(source, /promptInput\.value = prompt;/);
  assert.match(source, /response\.status === 401/);
  assert.match(source, /data\.code === "AUTH_NOT_CONFIGURED"/);
  assert.match(source, /No se generó contenido/);
  assert.doesNotMatch(source, /Authorization:\s*["'`]/);
  new vm.Script(source, { filename: "public/app.js" });
});
