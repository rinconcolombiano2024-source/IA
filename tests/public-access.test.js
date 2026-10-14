"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { isPublicRequest } = require("../src/security/public-routes");

test("only explicitly public read routes bypass authentication", () => {
  for (const resource of ["/", "/index.html", "/styles.css", "/app.js", "/api/public-status"]) {
    assert.equal(isPublicRequest("GET", resource), true, resource);
  }

  for (const resource of [
    "/api/run", "/api/health", "/api/history", "/api/video/abc",
    "/generated/job/file.pdf", "/data/history.json", "/.env", "/server.js",
    "/%2e%2e/.env", "/admin"
  ]) {
    assert.equal(isPublicRequest("GET", resource), false, resource);
  }

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isPublicRequest(method, "/"), false, method);
    assert.equal(isPublicRequest(method, "/api/public-status"), false, method);
  }
});

function choosePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

test("public homepage works while paid and private routes stay protected", { timeout: 20000 }, async (t) => {
  const port = await choosePort();
  const child = spawn(process.execPath, [path.join(__dirname, "../server.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      VERCEL: "1",
      APP_AUTH_USER: "smoke-admin",
      APP_AUTH_PASSWORD: "smoke-secret-not-for-production",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      GEMINI_API_KEY: "",
      XAI_API_KEY: "",
      GROQ_API_KEY: "",
      AI_MODEL_DISCOVERY_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });

  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk).slice(0, 1000); });
  child.stdout.resume();
  const base = "http://127.0.0.1:" + port;

  let started = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const ready = await fetch(base + "/api/public-status");
      if (ready.status === 200) { started = true; break; }
    } catch { /* not ready */ }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  assert.equal(started, true, "server did not start: " + stderr.slice(0, 300));

  const home = await fetch(base + "/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<html/);
  assert.equal((await fetch(base + "/app.js")).status, 200);
  assert.equal((await fetch(base + "/styles.css")).status, 200);

  const publicStatus = await fetch(base + "/api/public-status");
  assert.equal(publicStatus.status, 200);
  const publicInfo = await publicStatus.json();
  assert.equal(publicInfo.publicAccess, true);
  assert.equal(publicInfo.requiresAuthenticationForGeneration, true);
  assert.equal(Object.hasOwn(publicInfo, "apiKeyConfigured"), false);

  for (const resource of ["/api/health", "/api/history", "/generated/anything/file.pdf"]) {
    const response = await fetch(base + resource);
    assert.equal(response.status, 401, resource);
  }

  const anonymousRun = await fetch(base + "/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ prompt: "Hola" })
  });
  assert.equal(anonymousRun.status, 401);
  assert.equal(anonymousRun.headers.has("www-authenticate"), false);

  const loginHeader = {
    Authorization: "Basic " + Buffer.from("smoke-admin:smoke-secret-not-for-production").toString("base64")
  };
  const authorizedHealth = await fetch(base + "/api/health", { headers: loginHeader });
  assert.equal(authorizedHealth.status, 200);
  assert.equal((await authorizedHealth.json()).ok, true);

  const deniedWrite = await fetch(base + "/api/public-status", { method: "POST" });
  assert.equal(deniedWrite.status, 401);
});
