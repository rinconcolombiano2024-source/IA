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
const providerSelect = document.querySelector("#providerSelect");
let lastAnswer = "";
const dictateButton = document.querySelector("#dictateButton");
const speakButton = document.querySelector("#speakButton");

checkHealth();

modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    providerSelect.disabled = mode === "team" || mode === "compare";
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
  if (!prompt || sendButton.disabled) return;
  if (navigator.onLine === false) {
    addMessage("ai", "Sin conexión. Tu petición sigue en el cuadro de texto.");
    return;
  }

  addMessage("user", prompt);
  promptInput.value = "";
  setLoading(true);

  const loadingMessage = addMessage("ai", "Creando...");

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ prompt, mode, format: formatSelect.value, provider: providerSelect.disabled ? "" : providerSelect.value })
    });

    const data = await response.json();
    loadingMessage.remove();

    if (!response.ok) {
      if (!promptInput.value.trim()) promptInput.value = prompt;
      if (response.status === 401 || response.status === 503 && data.code === "AUTH_NOT_CONFIGURED") {
        addMessage("ai", "IA está abierta al público, pero el uso de modelos todavía requiere una cuenta autorizada.", "El registro individual se habilitará antes del lanzamiento público de las funciones de pago.");
        return;
      }
      addMessage("ai", data.error || "No pude completar la peticion.", data.detail || data.recovery);
      return;
    }

    renderResult(data, prompt);
  } catch (error) {
    loadingMessage.remove();
    if (!promptInput.value.trim()) promptInput.value = prompt;
    addMessage("ai", "No pude conectar con el servidor.", "Comprueba Internet o la disponibilidad del servicio. No se reenviará automáticamente.");
  } finally {
    setLoading(false);
  }
});

async function checkHealth() {
  try {
    const response = await fetch("/api/public-status", { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error("No se pudo comprobar el estado.");
    const data = await response.json();
    healthDot.classList.toggle("is-ok", data.ok);
    healthDot.classList.toggle("is-warn", !data.ok);
    healthText.textContent = data.ok ? "IA pública" : "Servicio no disponible";
    modelText.textContent = data.requiresAuthenticationForGeneration
      ? "Generación protegida; cuentas públicas pendientes"
      : "Sistema disponible";
  } catch {
    healthDot.classList.add("is-warn");
    healthText.textContent = "Servicio no disponible";
    modelText.textContent = "Comprueba tu conexión a Internet";
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

  lastAnswer = data.text || "";
  addMessage("ai", data.text || "Listo.", data.synthesis ? data.title + " · " + data.synthesis.provider : data.title);
  if (Array.isArray(data.contributions)) {
    for (const entry of data.contributions) {
      addMessage("ai", entry.status === "ok" ? entry.text : "Proveedor no disponible para esta solicitud.", entry.provider + " · " + entry.model);
    }
    if (data.partial) addMessage("ai", "Resultado parcial: no todos los modelos o la síntesis respondieron.");
  }
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

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition && dictateButton) {
  dictateButton.hidden = false;
  dictateButton.addEventListener("click", () => {
    const recognition = new Recognition();
    recognition.lang = document.documentElement.lang || "es";
    recognition.interimResults = false;
    recognition.onresult = event => {
      const words = event.results[0][0].transcript;
      promptInput.value = [promptInput.value, words].filter(Boolean).join(" ");
      promptInput.focus();
    };
    recognition.onerror = () => addMessage("ai", "No se pudo utilizar el micrófono. Comprueba los permisos.");
    recognition.onend = () => { dictateButton.disabled = false; };
    try { recognition.start(); dictateButton.disabled = true; }
    catch { dictateButton.disabled = false; }
  });
}
if ("speechSynthesis" in window && speakButton) {
  speakButton.hidden = false;
  speakButton.addEventListener("click", () => {
    if (!lastAnswer) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(lastAnswer.slice(0, 12000));
    utterance.lang = document.documentElement.lang || "es";
    window.speechSynthesis.speak(utterance);
  });
}

const installButton = document.querySelector("#installButton");
const installHint = document.querySelector("#installHint");
let installPrompt = null;
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  installButton.hidden = true;
});
function installedMode() {
  return (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
}
if (installedMode()) installButton.hidden = true;
installButton.addEventListener("click", async () => {
  if (installPrompt) {
    const pending = installPrompt;
    installPrompt = null;
    try { await pending.prompt(); return; } catch { /* Show manual help. */ }
  }
  installHint.hidden = false;
  installHint.textContent = "iPhone/iPad: Compartir > Añadir a pantalla de inicio. Android: menú del navegador > Instalar o Añadir a pantalla de inicio. Ordenador: menú del navegador > Instalar aplicación (si está disponible). También puedes guardar un marcador.";
});
const connectionStatus = document.querySelector("#connectionStatus");
function updateConnection() { connectionStatus.hidden = navigator.onLine !== false; }
window.addEventListener("online", () => { updateConnection(); checkHealth(); });
window.addEventListener("offline", updateConnection);
updateConnection();
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/sw.js").catch(() => { /* Web access remains available. */ });
}
