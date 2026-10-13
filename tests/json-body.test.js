"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const {
  isClientRequestError,
  normalizeContentType,
  isJsonContentType,
  parseContentLength,
  readJsonBody
} = require("../src/http/json-body");

function requestFrom(chunks, headers = {}) {
  const req = Readable.from(chunks);
  req.headers = headers;
  return req;
}

test("content type helpers accept JSON and +json only when declared", () => {
  assert.equal(normalizeContentType("application/json; charset=utf-8"), "application/json");
  assert.equal(isJsonContentType("application/json"), true);
  assert.equal(isJsonContentType("application/problem+json"), true);
  assert.equal(isJsonContentType(""), true);
  assert.equal(isJsonContentType("text/plain"), false);
});

test("content length parser returns non-negative values only", () => {
  assert.equal(parseContentLength("123"), 123);
  assert.equal(parseContentLength("0"), 0);
  assert.equal(parseContentLength("-1"), null);
  assert.equal(parseContentLength("bad"), null);
});

test("valid JSON is parsed without changing payload semantics", async () => {
  const req = requestFrom(
    [Buffer.from('{"prompt":"hola","mode":"auto"}', "utf8")],
    { "content-type": "application/json" }
  );

  const body = await readJsonBody(req, { limitBytes: 1_000 });
  assert.deepEqual(body, { prompt: "hola", mode: "auto" });
});

test("empty body resolves to an empty object", async () => {
  const req = requestFrom([], { "content-type": "application/json" });
  assert.deepEqual(await readJsonBody(req, { limitBytes: 100 }), {});
});

test("declared Content-Length above limit is rejected before body processing", async () => {
  const req = requestFrom(
    [Buffer.from("{}", "utf8")],
    {
      "content-type": "application/json",
      "content-length": "101"
    }
  );

  await assert.rejects(
    readJsonBody(req, { limitBytes: 100 }),
    (error) =>
      isClientRequestError(error) &&
      error.statusCode === 413 &&
      error.code === "PAYLOAD_TOO_LARGE" &&
      error.maxBytes === 100
  );
});

test("actual bytes are counted, including multibyte UTF-8 characters", async () => {
  const raw = '{"prompt":"😀😀😀😀"}';
  const bytes = Buffer.from(raw, "utf8");
  assert.ok(bytes.length > raw.length);

  const req = requestFrom(
    [bytes.subarray(0, 8), bytes.subarray(8)],
    { "content-type": "application/json" }
  );

  await assert.rejects(
    readJsonBody(req, { limitBytes: bytes.length - 1 }),
    (error) =>
      error.statusCode === 413 &&
      error.code === "PAYLOAD_TOO_LARGE"
  );
});

test("invalid JSON returns a safe 400 client error", async () => {
  const req = requestFrom(
    [Buffer.from('{"prompt":', "utf8")],
    { "content-type": "application/json" }
  );

  await assert.rejects(
    readJsonBody(req, { limitBytes: 100 }),
    (error) =>
      isClientRequestError(error) &&
      error.statusCode === 400 &&
      error.code === "INVALID_JSON"
  );
});

test("non-JSON content type is rejected with 415", async () => {
  const req = requestFrom(
    [Buffer.from("hello", "utf8")],
    { "content-type": "text/plain" }
  );

  await assert.rejects(
    readJsonBody(req, { limitBytes: 100 }),
    (error) =>
      isClientRequestError(error) &&
      error.statusCode === 415 &&
      error.code === "UNSUPPORTED_MEDIA_TYPE"
  );
});
