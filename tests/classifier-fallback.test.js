"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const serverSource=fs.readFileSync(
  path.join(__dirname,"..","server.js"),
  "utf8"
);

test("auto classifier executes through generic fallback executor",()=>{
  assert.match(
    serverSource,
    /executeWithFallback\(\{[\s\S]*?intent:\s*"router"[\s\S]*?classifyIntent/
  );
});

test("invalid structured classifier output becomes provider fallback error",()=>{
  assert.match(
    serverSource,
    /error\.code\s*=\s*"PROVIDER_INVALID_RESPONSE"/
  );
  assert.doesNotMatch(
    serverSource,
    /safeJsonParse\(provider\.extractText\(data\)\)\s*\|\|\s*inferIntent/
  );
});

test("routing response exposes safe classification trace",()=>{
  assert.match(
    serverSource,
    /classification:\s*classifierRouting/
  );
  assert.match(
    serverSource,
    /source:\s*"local_inference"/
  );
});
