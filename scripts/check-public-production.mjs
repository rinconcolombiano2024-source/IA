"use strict";

// Read-only production smoke test. No API key, password or paid model call is needed.
// Intentionally sends an empty prompt for the anonymous POST auth check.
const base = String(process.env.IA_PUBLIC_URL || "https://rinconcolombianoia.vercel.app")
  .replace(/\/+$/, "");
const retries = 20;
const intervalMs = 10_000;

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
    ...options
  });
  return response;
}

async function verify() {
  const status = await request("/api/public-status", {
    headers: { Accept: "application/json" }
  });
  if (status.status !== 200) {
    throw new Error("GET /api/public-status: expected 200; got " + status.status);
  }
  if (!String(status.headers.get("content-type")).includes("application/json")) {
    throw new Error("Public status did not return JSON");
  }
  const data = await status.json();
  if (data?.ok !== true || data?.publicAccess !== true ||
      data?.requiresAuthenticationForGeneration !== true) {
    throw new Error("Public status has an unexpected access policy");
  }

  const home = await request("/");
  if (home.status !== 200) {
    throw new Error("GET /: expected 200; got " + home.status);
  }
  if (!String(home.headers.get("content-type")).includes("text/html")) {
    throw new Error("Public homepage is not HTML");
  }
  const html = await home.text();
  if (!html.includes("id=\"promptForm\"")) {
    throw new Error("Production is not serving the expected IA page");
  }

  const app = await request("/app.js");
  if (app.status !== 200) {
    throw new Error("GET /app.js: expected 200; got " + app.status);
  }

  // Empty prompt is rejected before any provider invocation even if auth breaks.
  const denied = await request("/api/run", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prompt: "" })
  });
  if (denied.status !== 401) {
    throw new Error("Anonymous POST /api/run: expected 401; got " + denied.status);
  }
  if (denied.headers.has("www-authenticate")) {
    throw new Error("Anonymous JSON API call unexpectedly triggers HTTP Basic login");
  }

  console.log("PASS: public website reachable; API generation requires authentication.");
}

let lastError = null;
for (let attempt = 1; attempt <= retries; attempt += 1) {
  try {
    await verify();
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log("Production check " + attempt + "/" + retries + ": " +
      String(error.message || error).slice(0, 160));
    if (attempt !== retries) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
console.error("FAIL: production access check did not pass. " +
  "Review Vercel deployment status, production aliases/rollback, protection and runtime logs.");
console.error("Last observed error: " + String(lastError?.message || lastError).slice(0, 180));
process.exitCode = 1;
