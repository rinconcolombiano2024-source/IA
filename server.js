const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const rootDir = __dirname;
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const generatedDir = path.join(rootDir, "generated");
const envFile = readEnvFile();
const env = { ...envFile, ...process.env };
const port = Number(env.PORT || 3000);
const requestLimit = Number(env.REQUEST_LIMIT_BYTES || 2_000_000);

ensureDir(dataDir);
ensureDir(generatedDir);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, getHealth());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/history") {
      sendJson(res, 200, { history: loadHistory(30) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/run") {
      await handleRun(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/video/")) {
      await handleVideoRoute(url.pathname, res);
      return;
    }

    if (req.method === "GET") {
      serveFile(url.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Metodo no permitido." });
  } catch (error) {
    logError(error, { route: url.pathname });
    sendJson(res, 500, {
      error: "La IA encontro un problema interno.",
      detail: error.message || "Error inesperado.",
      recovery: "El servidor registro el fallo y puedes volver a intentar la peticion."
    });
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
  const format = String(body.format || "bundle").toLowerCase();

  if (!prompt) {
    sendJson(res, 400, { error: "Escribe una peticion para la IA." });
    return;
  }

  const history = loadHistory(12);
  const route =
    requestedMode === "auto"
      ? await classifyIntent(apiKey, prompt).catch(() => inferIntent(prompt))
      : modeToRoute(requestedMode, prompt);

  const job = createJob(route.intent, route.title || prompt);
  let result;

  try {
    result = await runTask({ apiKey, prompt, format, route, job, history });
    appendHistory({
      id: job.id,
      at: new Date().toISOString(),
      prompt,
      mode: route.intent,
      title: result.title || route.title || "Trabajo de IA",
      status: "ok",
      files: result.files || []
    });
  } catch (error) {
    logError(error, { jobId: job.id, prompt, mode: route.intent });
    appendHistory({
      id: job.id,
      at: new Date().toISOString(),
      prompt,
      mode: route.intent,
      title: route.title || "Trabajo con error",
      status: "error",
      error: error.message
    });
    throw error;
  }

  sendJson(res, 200, result);
}

async function runTask(context) {
  const { route } = context;

  if (route.intent === "image") return generateImage(context);
  if (route.intent === "document") return generateDocument(context, "document");
  if (route.intent === "restaurant") return generateDocument(context, "restaurant");
  if (route.intent === "book") return generateDocument(context, "book");
  if (route.intent === "code") return generateCodePackage(context, "code");
  if (route.intent === "website") return generateCodePackage(context, "website");
  if (route.intent === "video") return generateVideo(context);
  if (route.intent === "repair") return diagnoseAndRepair(context);

  return generateText(context);
}

async function classifyIntent(apiKey, prompt) {
  const data = await createResponse(apiKey, {
    model: textModel(),
    reasoning: { effort: env.OPENAI_ROUTER_REASONING || "low" },
    instructions:
      "Clasifica la peticion del usuario para una plataforma de IA. Responde solo JSON valido.",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "task_router",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            intent: {
              type: "string",
              enum: [
                "text",
                "image",
                "document",
                "restaurant",
                "book",
                "code",
                "website",
                "video",
                "repair"
              ]
            },
            title: { type: "string" },
            format: { type: "string" },
            language: { type: "string" },
            confidence: { type: "number" },
            notes: { type: "string" }
          },
          required: ["intent", "title", "format", "language", "confidence", "notes"]
        }
      }
    }
  });

  return safeJsonParse(extractResponseText(data)) || inferIntent(prompt);
}

function modeToRoute(mode, prompt) {
  if (mode === "chat") return { ...inferIntent(prompt), intent: "text" };
  if (mode === "text") return { ...inferIntent(prompt), intent: "text" };
  if (mode === "pdf") return { ...inferIntent(prompt), intent: "document" };

  const valid = new Set([
    "image",
    "document",
    "restaurant",
    "book",
    "code",
    "website",
    "video",
    "repair"
  ]);

  return valid.has(mode) ? { ...inferIntent(prompt), intent: mode } : inferIntent(prompt);
}

function inferIntent(prompt) {
  const text = normalizeText(prompt);
  const checks = [
    ["repair", ["repara", "arregla error", "bug", "falla", "debug", "corrige"]],
    ["video", ["video", "pelicula", "trailer", "cortometraje", "animacion"]],
    ["restaurant", ["menu", "restaurante", "plato", "carta", "comida", "bebida"]],
    ["book", ["libro", "novela", "capitulo", "cuento largo", "ebook"]],
    ["website", ["pagina web", "sitio web", "landing", "web app", "frontend"]],
    ["code", ["programa", "codigo", "script", "app", "software", "api", "backend"]],
    ["document", ["pdf", "documento", "contrato", "informe", "presentacion", "curriculum"]],
    ["image", ["imagen", "dibuja", "foto", "logo", "poster", "cartel", "ilustracion"]]
  ];

  for (const [intent, words] of checks) {
    if (words.some((word) => text.includes(word))) {
      return { intent, title: makeTitle(prompt), format: intent, language: "es", confidence: 0.7, notes: "" };
    }
  }

  return { intent: "text", title: makeTitle(prompt), format: "text", language: "es", confidence: 0.5, notes: "" };
}

async function generateText({ apiKey, prompt, history, route }) {
  const data = await createResponse(apiKey, {
    model: textModel(),
    reasoning: { effort: env.OPENAI_REASONING_EFFORT || "medium" },
    instructions: [
      "Eres una IA generalista avanzada para usuarios finales.",
      "Ayudas a escribir, planificar, analizar, crear, programar y resolver problemas.",
      "No prometas perfeccion absoluta, conciencia real ni autoaprendizaje ilimitado.",
      "Responde en el idioma del usuario, con estructura clara y pasos accionables.",
      memoryContext(history)
    ].join("\n"),
    input: prompt
  });

  return {
    type: "text",
    title: route.title || "Respuesta",
    text: extractResponseText(data) || "La IA respondio, pero no envio texto legible.",
    files: []
  };
}

async function generateDocument(context, kind) {
  const { apiKey, prompt, job, route, format } = context;
  const instructions = documentInstructions(kind);
  const data = await createResponse(apiKey, {
    model: textModel(),
    reasoning: { effort: env.OPENAI_REASONING_EFFORT || "medium" },
    instructions,
    input: prompt
  });

  const markdown = normalizeMarkdown(extractResponseText(data), route.title || makeTitle(prompt));
  const title = extractMarkdownTitle(markdown) || route.title || makeTitle(prompt);
  const plainText = markdownToPlainText(markdown);
  const html = markdownToHtml(markdown, title);
  const metadata = JSON.stringify(
    {
      id: job.id,
      kind,
      title,
      createdAt: new Date().toISOString(),
      prompt
    },
    null,
    2
  );

  const allFiles = [
    writeArtifact(job, "documento.md", markdown, "text/markdown; charset=utf-8"),
    writeArtifact(job, "documento.html", html, "text/html; charset=utf-8"),
    writeArtifact(job, "documento.txt", plainText, "text/plain; charset=utf-8"),
    writeArtifact(job, "documento.pdf", createPdfBuffer(title, plainText), "application/pdf"),
    writeArtifact(
      job,
      "documento.docx",
      createDocxBuffer(title, plainText),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
    writeArtifact(job, "metadata.json", metadata, "application/json; charset=utf-8")
  ];
  const files = filterDocumentFiles(allFiles, format);

  return {
    type: "document",
    title,
    text: `Documento creado: ${title}`,
    files
  };
}

function filterDocumentFiles(files, format) {
  const formats = {
    pdf: ".pdf",
    docx: ".docx",
    word: ".docx",
    html: ".html",
    md: ".md",
    markdown: ".md",
    txt: ".txt"
  };
  const extension = formats[format];
  if (!extension) return files;

  const selected = files.filter((file) => file.name.toLowerCase().endsWith(extension));
  return selected.length ? selected : files;
}

function documentInstructions(kind) {
  const base = [
    "Genera un documento profesional en Markdown.",
    "Usa titulos, secciones, listas y tablas Markdown cuando aporten valor.",
    "Escribe en el idioma del usuario.",
    "No incluyas cercas de codigo alrededor del documento."
  ];

  if (kind === "restaurant") {
    base.push(
      "Si la peticion es para restaurante, crea una carta/menu listo para imprimir.",
      "Incluye categorias, nombres de platos, descripciones breves, alergenos si aplica y precios sugeridos si el usuario no dio precios.",
      "Agrega una version corta para redes sociales al final."
    );
  }

  if (kind === "book") {
    base.push(
      "Si la peticion es un libro, crea una portada textual, sinopsis, indice, prologo y al menos un primer capitulo completo.",
      "Si el libro seria largo, entrega una estructura escalable y una muestra de alta calidad."
    );
  }

  return base.join("\n");
}

async function generateCodePackage(context, kind) {
  const { apiKey, prompt, job, route } = context;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      projectName: { type: "string" },
      summary: { type: "string" },
      runInstructions: { type: "string" },
      files: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            description: { type: "string" },
            content: { type: "string" }
          },
          required: ["path", "description", "content"]
        }
      }
    },
    required: ["projectName", "summary", "runInstructions", "files"]
  };

  const data = await createResponse(apiKey, {
    model: textModel(),
    reasoning: { effort: env.OPENAI_REASONING_EFFORT || "medium" },
    instructions: codeInstructions(kind),
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "project_files",
        strict: true,
        schema
      }
    }
  });

  const parsed = safeJsonParse(extractResponseText(data));
  if (!parsed || !Array.isArray(parsed.files)) {
    throw new Error("La IA no devolvio un paquete de codigo valido.");
  }

  const projectName = safeSlug(parsed.projectName || route.title || "proyecto-ia");
  const projectDir = ensureDir(path.join(job.dir, projectName));
  const fileArtifacts = [];

  for (const file of parsed.files) {
    const relativePath = sanitizeRelativePath(file.path);
    const targetPath = path.join(projectDir, relativePath);
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, String(file.content || ""), "utf8");
    fileArtifacts.push({
      name: `${projectName}/${relativePath.replace(/\\/g, "/")}`,
      url: `/generated/${job.id}/${encodePathSegments(`${projectName}/${relativePath}`)}`,
      type: mimeForPath(relativePath),
      size: Buffer.byteLength(String(file.content || ""), "utf8")
    });
  }

  const readme = [
    `# ${parsed.projectName || projectName}`,
    "",
    parsed.summary || "",
    "",
    "## Como ejecutar",
    "",
    parsed.runInstructions || "Abre los archivos generados y sigue las instrucciones del proyecto."
  ].join("\n");

  const readmePath = path.join(projectDir, "README.md");
  if (!fs.existsSync(readmePath)) fs.writeFileSync(readmePath, readme, "utf8");

  const zipFiles = collectFiles(projectDir).map((filePath) => ({
    name: path.relative(job.dir, filePath).replace(/\\/g, "/"),
    data: fs.readFileSync(filePath)
  }));
  const zipArtifact = writeArtifact(job, `${projectName}.zip`, buildZip(zipFiles), "application/zip");

  return {
    type: kind === "website" ? "website" : "code",
    title: parsed.projectName || route.title || "Proyecto generado",
    text: [parsed.summary, "", "Instrucciones:", parsed.runInstructions].filter(Boolean).join("\n"),
    files: [...fileArtifacts, zipArtifact]
  };
}

function codeInstructions(kind) {
  const base = [
    "Genera un paquete de codigo completo y util.",
    "Devuelve solo JSON que cumpla el esquema.",
    "No uses rutas absolutas, no uses .. en las rutas y no incluyas archivos binarios.",
    "Incluye comentarios solo donde ayuden a entender bloques complejos.",
    "El codigo debe ser claro, ejecutable y con instrucciones de uso."
  ];

  if (kind === "website") {
    base.push(
      "Para paginas web, crea una experiencia usable desde la primera pantalla.",
      "Usa HTML, CSS y JavaScript sin dependencias externas salvo que sea imprescindible.",
      "El diseno debe ser responsive y profesional."
    );
  }

  return base.join("\n");
}

async function generateImage({ apiKey, prompt, job, route }) {
  const model = env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const data = await callOpenAIJson("https://api.openai.com/v1/images/generations", apiKey, {
    model,
    prompt,
    size: env.OPENAI_IMAGE_SIZE || "1024x1024",
    quality: env.OPENAI_IMAGE_QUALITY || "medium",
    n: 1
  });

  const firstImage = Array.isArray(data.data) ? data.data[0] : null;
  if (!firstImage) throw new Error("La API no devolvio una imagen.");

  const files = [];
  let image = firstImage.url || "";

  if (firstImage.b64_json) {
    const buffer = Buffer.from(firstImage.b64_json, "base64");
    const artifact = writeArtifact(job, "imagen.png", buffer, "image/png");
    files.push(artifact);
    image = artifact.url;
  }

  return {
    type: "image",
    title: route.title || "Imagen generada",
    text: "Imagen creada.",
    image,
    files
  };
}

async function generateVideo({ apiKey, prompt, route }) {
  const model = env.OPENAI_VIDEO_MODEL || "sora-2";
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", env.OPENAI_VIDEO_SIZE || "1280x720");
  form.append("seconds", env.OPENAI_VIDEO_SECONDS || "4");

  const response = await fetchWithRetry("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readOpenAIError(data));

  return {
    type: "video",
    title: route.title || "Video generado",
    text: "La generacion de video se inicio. La app puede consultar el estado hasta que este listo.",
    video: {
      id: data.id,
      status: data.status || "queued",
      statusUrl: data.id ? `/api/video/${encodeURIComponent(data.id)}/status` : "",
      contentUrl: data.id ? `/api/video/${encodeURIComponent(data.id)}/content` : ""
    },
    files: []
  };
}

async function handleVideoRoute(pathname, res) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "pon-tu-clave-aqui") {
    sendJson(res, 400, { error: "Falta OPENAI_API_KEY." });
    return;
  }

  const parts = pathname.split("/").filter(Boolean);
  const videoId = parts[2];
  const action = parts[3] || "status";
  if (!videoId) {
    sendJson(res, 400, { error: "Falta el id del video." });
    return;
  }

  if (action === "content") {
    const response = await fetchWithRetry(`https://api.openai.com/v1/videos/${encodeURIComponent(videoId)}/content`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      sendJson(res, response.status, { error: readOpenAIError(data) });
      return;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    res.writeHead(200, {
      "Content-Type": response.headers.get("content-type") || "video/mp4",
      "Content-Disposition": `attachment; filename="${videoId}.mp4"`
    });
    res.end(buffer);
    return;
  }

  const response = await fetchWithRetry(`https://api.openai.com/v1/videos/${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  const data = await response.json().catch(() => ({}));
  sendJson(res, response.status, data);
}

async function diagnoseAndRepair({ apiKey, prompt, history, route }) {
  const data = await createResponse(apiKey, {
    model: textModel(),
    reasoning: { effort: env.OPENAI_REASONING_EFFORT || "medium" },
    instructions: [
      "Actua como diagnostico tecnico y estratega de reparacion.",
      "No digas que puedes repararte con conciencia propia.",
      "Explica causas probables, pasos de reparacion, pruebas y prevencion.",
      "Si falta informacion, entrega una lista corta de datos necesarios.",
      memoryContext(history)
    ].join("\n"),
    input: prompt
  });

  return {
    type: "repair",
    title: route.title || "Diagnostico",
    text: extractResponseText(data),
    files: []
  };
}

async function createResponse(apiKey, payload) {
  return callOpenAIJson("https://api.openai.com/v1/responses", apiKey, payload);
}

async function callOpenAIJson(url, apiKey, payload) {
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(readOpenAIError(data));
  return data;
}

async function fetchWithRetry(url, options, retries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(env.OPENAI_TIMEOUT_MS || 120_000));

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      if (![408, 409, 429, 500, 502, 503, 504].includes(response.status) || attempt === retries) {
        return response;
      }

      await sleep(700 * (attempt + 1));
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === retries) throw error;
      await sleep(700 * (attempt + 1));
    }
  }

  throw lastError || new Error("No se pudo conectar con OpenAI.");
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
      if (raw.length > requestLimit) {
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

function textModel() {
  return env.OPENAI_TEXT_MODEL || "gpt-5.5";
}

function getHealth() {
  return {
    ok: true,
    app: "Mi IA",
    version: "2.0.0",
    textModel: textModel(),
    imageModel: env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    videoModel: env.OPENAI_VIDEO_MODEL || "sora-2",
    apiKeyConfigured: Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY !== "pon-tu-clave-aqui"),
    capabilities: [
      "texto",
      "documentos",
      "pdf",
      "docx",
      "codigo",
      "paginas web",
      "menus de restaurante",
      "libros",
      "imagenes",
      "video",
      "historial local",
      "diagnostico de errores"
    ]
  };
}

function createJob(intent, title) {
  const id = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto
    .randomBytes(4)
    .toString("hex")}`;
  const dir = ensureDir(path.join(generatedDir, id));
  fs.writeFileSync(
    path.join(dir, "job.json"),
    JSON.stringify({ id, intent, title: makeTitle(title), createdAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
  return { id, dir };
}

function writeArtifact(job, name, content, type) {
  const safeFileName = sanitizeFileName(name);
  const target = path.join(job.dir, safeFileName);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content), "utf8");
  fs.writeFileSync(target, buffer);
  return {
    name: safeFileName,
    url: `/generated/${job.id}/${encodePathSegments(safeFileName)}`,
    type,
    size: buffer.length
  };
}

function serveFile(pathname, res) {
  const root = pathname.startsWith("/generated/") ? generatedDir : publicDir;
  const localPathname = pathname.startsWith("/generated/")
    ? pathname.replace(/^\/generated\//, "/")
    : pathname === "/"
      ? "/index.html"
      : pathname;
  const decodedPath = decodeURIComponent(localPathname.split("?")[0]);
  const filePath = path.normalize(path.join(root, decodedPath));
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end("Prohibido");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No encontrado");
      return;
    }

    res.writeHead(200, { "Content-Type": mimeForPath(filePath) });
    res.end(content);
  });
}

function normalizeMarkdown(markdown, fallbackTitle) {
  const text = String(markdown || "").trim();
  if (text.startsWith("#")) return text;
  return `# ${fallbackTitle}\n\n${text}`;
}

function extractMarkdownTitle(markdown) {
  const match = String(markdown).match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function markdownToPlainText(markdown) {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .trim();
}

function markdownToHtml(markdown, title) {
  const lines = String(markdown).split(/\r?\n/);
  const html = [];
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    if (inList) {
      html.push("</ul>");
      inList = false;
    }

    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  if (inList) html.push("</ul>");

  return [
    "<!doctype html>",
    '<html lang="es">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "body{font-family:Arial,sans-serif;line-height:1.55;color:#1b1d22;max-width:820px;margin:40px auto;padding:0 20px}",
    "h1,h2,h3{line-height:1.15} h1{font-size:38px} table{border-collapse:collapse;width:100%} td,th{border:1px solid #ddd;padding:8px}",
    "</style>",
    "</head>",
    "<body>",
    html.join("\n"),
    "</body>",
    "</html>"
  ].join("\n");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function createPdfBuffer(title, text) {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 54;
  const lineHeight = 14;
  const maxChars = 88;
  const lines = wrapLines(text, maxChars);
  const pages = [];
  const linesPerPage = 46;

  for (let index = 0; index < lines.length || index === 0; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];

  const pageRefs = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pageObjectNumber = objects.length + 1;
    const contentObjectNumber = pageObjectNumber + 1;
    pageRefs.push(`${pageObjectNumber} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`
    );
    objects.push(makePdfContent(index === 0 ? title : `${title} (${index + 1})`, pages[index], margin, pageHeight, lineHeight));
  }

  objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`;

  const pdfObjects = objects.map((content, index) => {
    if (content.startsWith("BT")) {
      return `${index + 1} 0 obj\n<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream\nendobj\n`;
    }
    return `${index + 1} 0 obj\n${content}\nendobj\n`;
  });

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of pdfObjects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }

  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${pdfObjects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${pdfObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body, "latin1");
}

function makePdfContent(title, lines, margin, pageHeight, lineHeight) {
  const commands = [
    "BT",
    "/F1 18 Tf",
    `${margin} ${pageHeight - margin} Td`,
    `(${escapePdfText(title)}) Tj`,
    "ET",
    "BT",
    "/F1 11 Tf",
    `${margin} ${pageHeight - margin - 32} Td`,
    `${lineHeight} TL`
  ];

  for (const line of lines) {
    commands.push(`(${escapePdfText(line)}) Tj`);
    commands.push("T*");
  }

  commands.push("ET");
  return commands.join("\n");
}

function createDocxBuffer(title, text) {
  const paragraphs = [title, ...String(text).split(/\r?\n/).filter(Boolean)]
    .slice(0, 1200)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join("");

  const files = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          "</Types>",
        "utf8"
      )
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          "</Relationships>",
        "utf8"
      )
    },
    {
      name: "word/document.xml",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          `<w:body>${paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>` +
          "</w:document>",
        "utf8"
      )
    }
  ];

  return buildZip(files);
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), "utf8");
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(localData.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralDir, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = (() => {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function wrapLines(text, maxChars) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }

    let line = "";
    for (const word of words) {
      if ((line + " " + word).trim().length > maxChars) {
        lines.push(line);
        line = word;
      } else {
        line = (line + " " + word).trim();
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function appendHistory(entry) {
  const historyPath = path.join(dataDir, "history.json");
  const history = loadHistory(200);
  history.unshift(entry);
  fs.writeFileSync(historyPath, JSON.stringify(history.slice(0, 200), null, 2), "utf8");
}

function loadHistory(limit = 20) {
  const historyPath = path.join(dataDir, "history.json");
  if (!fs.existsSync(historyPath)) return [];

  try {
    const history = JSON.parse(fs.readFileSync(historyPath, "utf8"));
    return Array.isArray(history) ? history.slice(0, limit) : [];
  } catch {
    return [];
  }
}

function memoryContext(history) {
  if (!Array.isArray(history) || !history.length) return "No hay historial local todavia.";

  const recent = history
    .slice(0, 6)
    .map((item) => `- ${item.mode}: ${item.title}`)
    .join("\n");

  return `Historial local reciente, solo para contexto si ayuda:\n${recent}`;
}

function logError(error, context = {}) {
  const errorPath = path.join(dataDir, "errors.log");
  const entry = JSON.stringify({
    at: new Date().toISOString(),
    message: error.message,
    stack: error.stack,
    context
  });
  fs.appendFileSync(errorPath, `${entry}\n`, "utf8");
}

function collectFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? collectFiles(fullPath) : [fullPath];
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitizeRelativePath(value) {
  const normalized = String(value || "archivo.txt")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => sanitizeFileName(segment))
    .join("/");

  if (!normalized || normalized.includes("..")) return "archivo.txt";
  return normalized.slice(0, 180);
}

function sanitizeFileName(name) {
  const cleaned = String(name || "archivo")
    .replace(/[<>:"|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "archivo";
}

function safeSlug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "proyecto-ia";
}

function encodePathSegments(value) {
  return String(value)
    .replace(/\\/g, "/")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function makeTitle(value) {
  const title = String(value || "Trabajo de IA")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
  return title || "Trabajo de IA";
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replace(/'/g, "&apos;");
}

function escapePdfText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function mimeForPath(filePath) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".mp4": "video/mp4",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".zip": "application/zip"
  };

  return types[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
