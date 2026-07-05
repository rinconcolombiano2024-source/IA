const form = document.querySelector("#promptForm");
const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#sendButton");
const messages = document.querySelector("#messages");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const exampleButtons = Array.from(document.querySelectorAll("[data-example]"));
const formatSelect = document.querySelector("#formatSelect");
const healthDot = document.querySelector("#healthDot");
const healthText = document.querySelector("#healthText");
const modelText = document.querySelector("#modelText");

let mode = "auto";

checkHealth();

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    modeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    promptInput.focus();
  });
});

exampleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    promptInput.value = button.dataset.example;
    promptInput.focus();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const prompt = promptInput.value.trim();
  if (!prompt) return;

  addMessage("user", prompt);
  promptInput.value = "";
  setLoading(true);

  const loadingMessage = addMessage("ai", "Creando...");

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode, format: formatSelect.value })
    });

    const data = await response.json();
    loadingMessage.remove();

    if (!response.ok) {
      addMessage("ai", data.error || "No pude completar la peticion.", data.detail || data.recovery);
      return;
    }

    renderResult(data, prompt);
  } catch (error) {
    loadingMessage.remove();
    addMessage("ai", "No pude conectar con el servidor.", "Revisa que la app este encendida con start.ps1.");
  } finally {
    setLoading(false);
  }
});

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    healthDot.classList.toggle("is-ok", data.ok && data.apiKeyConfigured);
    healthDot.classList.toggle("is-warn", data.ok && !data.apiKeyConfigured);
    healthText.textContent = data.apiKeyConfigured ? "Sistema listo" : "Falta clave API";
    modelText.textContent = `${data.textModel} · ${data.imageModel} · ${data.videoModel}`;
  } catch {
    healthDot.classList.add("is-warn");
    healthText.textContent = "Servidor apagado";
    modelText.textContent = "Ejecuta start.ps1";
  }
}

function renderResult(data, prompt) {
  if (data.type === "image") {
    addImageMessage(data.image, prompt, data.files);
    return;
  }

  if (data.type === "video") {
    addVideoMessage(data);
    return;
  }

  addMessage("ai", data.text || "Listo.", data.title);
  if (Array.isArray(data.files) && data.files.length) {
    addFilesMessage(data.title || "Archivos creados", data.files);
  }
}

function addMessage(role, text, detail = "") {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "TU" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    bubble.append(small);
  }

  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  bubble.append(paragraph);

  article.append(avatar, bubble);
  messages.append(article);
  scrollToBottom();
  return article;
}

function addFilesMessage(title, files) {
  const article = document.createElement("article");
  article.className = "message ai";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble file-bubble";

  const heading = document.createElement("strong");
  heading.textContent = title;
  bubble.append(heading);

  const grid = document.createElement("div");
  grid.className = "file-grid";

  files.forEach((file) => {
    const link = document.createElement("a");
    link.href = file.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.download = file.name.split("/").pop();
    link.className = "file-card";

    const name = document.createElement("span");
    name.textContent = file.name;

    const meta = document.createElement("small");
    meta.textContent = `${fileLabel(file.type)} · ${formatBytes(file.size)}`;

    link.append(name, meta);
    grid.append(link);
  });

  bubble.append(grid);
  article.append(avatar, bubble);
  messages.append(article);
  scrollToBottom();
}

function addImageMessage(src, alt, files = []) {
  const article = document.createElement("article");
  article.className = "message ai";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble image-bubble";

  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;

  const link = document.createElement("a");
  link.href = src;
  link.download = "imagen-generada.png";
  link.textContent = "Descargar imagen";

  bubble.append(image, link);
  article.append(avatar, bubble);
  messages.append(article);
  scrollToBottom();

  if (files.length) addFilesMessage("Archivo de imagen", files);
}

function addVideoMessage(data) {
  const article = document.createElement("article");
  article.className = "message ai";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble video-bubble";

  const title = document.createElement("strong");
  title.textContent = data.title || "Video";

  const status = document.createElement("p");
  status.textContent = data.text || "Video iniciado.";

  const link = document.createElement("a");
  link.href = data.video?.contentUrl || "#";
  link.textContent = "Descargar video cuando este listo";
  link.target = "_blank";
  link.rel = "noreferrer";

  bubble.append(title, status, link);
  article.append(avatar, bubble);
  messages.append(article);
  scrollToBottom();

  if (data.video?.statusUrl) pollVideo(data.video.statusUrl, status, link);
}

async function pollVideo(statusUrl, statusNode, linkNode) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(5000);
    try {
      const response = await fetch(statusUrl);
      const data = await response.json();
      const status = data.status || "consultando";
      statusNode.textContent = `Estado del video: ${status}`;
      if (status === "completed" || status === "failed" || status === "cancelled") {
        linkNode.classList.toggle("is-disabled", status !== "completed");
        return;
      }
    } catch {
      statusNode.textContent = "No pude consultar el estado del video.";
      return;
    }
  }
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  sendButton.textContent = isLoading ? "Creando..." : "Crear";
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

function fileLabel(type = "") {
  if (type.includes("pdf")) return "PDF";
  if (type.includes("word")) return "Word";
  if (type.includes("zip")) return "ZIP";
  if (type.includes("html")) return "HTML";
  if (type.includes("markdown")) return "Markdown";
  if (type.includes("image")) return "Imagen";
  if (type.includes("json")) return "JSON";
  return "Archivo";
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
