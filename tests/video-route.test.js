"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildVideoUrls,
  parseVideoRoute
} = require("../src/core/video-route");

test("provider-aware video URLs preserve provider identity", () => {
  const urls = buildVideoUrls("openai", "video/123");
  assert.equal(urls.statusUrl, "/api/video/openai/video%2F123/status");
  assert.equal(urls.contentUrl, "/api/video/openai/video%2F123/content");
});

test("provider-aware route parser decodes provider and video id", () => {
  const route = parseVideoRoute("/api/video/openai/video%2F123/content");
  assert.deepEqual(route, {
    valid: true,
    legacy: false,
    providerId: "openai",
    videoId: "video/123",
    action: "content"
  });
});

test("legacy video route remains supported", () => {
  const route = parseVideoRoute("/api/video/abc123/status");
  assert.deepEqual(route, {
    valid: true,
    legacy: true,
    providerId: "",
    videoId: "abc123",
    action: "status"
  });
});

test("invalid or malformed routes fail closed", () => {
  assert.equal(parseVideoRoute("/api/other/123").valid, false);
  assert.equal(parseVideoRoute("/api/video/%E0%A4%A/status").valid, false);
  assert.equal(buildVideoUrls("", "abc").statusUrl, "");
});
