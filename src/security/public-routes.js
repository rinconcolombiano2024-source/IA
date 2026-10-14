"use strict";

// Public browsing never grants access to paid AI operations or private artifacts.
// Only intentionally public frontend resources are reachable without credentials.
const publicAssets = new Set([
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/favicon.ico",
  "/robots.txt",
  "/manifest.webmanifest"
]);

function isPublicRequest(method, pathname) {
  if (method !== "GET") return false;
  if (pathname === "/api/public-status") return true;
  return publicAssets.has(pathname);
}

module.exports = { isPublicRequest };
