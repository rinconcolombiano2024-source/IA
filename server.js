const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || readEnvFile().PORT || 3000);
const env = { ...readEnvFile(), ...process.env };

function readEnvFile() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return {};

  return fs.readFileSync(envPath, "utf8").split(/\r?\n/).reduce((values, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return values;

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) return values;

    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
    return values;
  }, {});
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/run") {
      await handleRun(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Metodo no permitido." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Error inesperado." });
  }
});

server.listen(port, () => {
  console.log(`Mi IA esta lista en http://localhost:${port}`);
});

async function handleRun(req, res) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "pon-tu-clave-aqui") {
    sendJson(res, 400, {
      error: "Falta OPENAI_API_KEY. Crea un archivo .env con tu clave de OpenAI."
    });
    return;
  }

  const body = await readJsonBody(req);
  const prompt = String(body.prompt || "").trim();
  const requestedMode = String(body.mode || "auto").toLowerCase();

  if (!prompt) {
    sendJson(res, 400, { error: "Escribe una peticion para la IA." });
    return;
  }

  const mode = requestedMode === "auto" ? detectMode(prompt) : requestedMode;

  if (mode === "image") {
    const image = await generateImage(apiKey, prompt);
    sendJson(res, 200, { type: "image", image });
    return;
  }

  const text = await generateText(apiKey, prompt);
  sendJson(res, 200, { type: "text", text });
}

function detectMode(prompt) {
  const imageWords = [
    "imagen",
    "dibuja",
    "dibujame",
    "foto",
    "fotografia",
    "ilustracion",
    "logo",
    "poster",
    "cartel",
    "retrato",
    "create image",
    "generate image",
    "draw",
    "picture",
    "illustration"
  ];

  const normalized = prompt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return imageWords.some((word) => normalized.includes(word)) ? "image" : "text";
}

async function generateText(apiKey, prompt) {
  const model = env.OPENAI_TEXT_MODEL || "gpt-5.5";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: "low" },
      instructions:
        "Eres una IA util para usuarios finales. Responde en el idioma del usuario, con claridad y sin inventar datos.",
      input: prompt
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(readOpenAIError(data));

  return extractResponseText(data) || "La IA respondio, pero no envio texto legible.";
}

async function generateImage(apiKey, prompt) {
  const model = env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1024x1024",
      quality: "medium",
      n: 1
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(readOpenAIError(data));

  const firstImage = Array.isArray(data.data) ? data.data[0] : null;
  if (firstImage?.b64_json) return `data:image/png;base64,${firstImage.b64_json}`;
  if (firstImage?.url) return firstImage.url;

  throw new Error("La API no devolvio una imagen.");
}

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text.trim();

  if (!Array.isArray(data.output)) return "";

  return data.output
    .flatMap((item) => item.content || [])
    .map((content) => content.text || content.output_text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readOpenAIError(data) {
  if (data?.error?.message) return data.error.message;
  return "La API de OpenAI devolvio un error.";
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("La peticion es demasiado grande."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("El servidor recibio JSON invalido."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.normalize(path.join(publicDir, requestedPath));
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end("Prohibido");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("No encontrado");
      return;
    }

    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(content);
  });
}

function contentType(filePath) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  };

  return types[path.extname(filePath)] || "application/octet-stream";
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
