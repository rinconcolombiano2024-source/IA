const form = document.querySelector("#promptForm");
const promptInput = document.querySelector("#prompt");
const sendButton = document.querySelector("#sendButton");
const messages = document.querySelector("#messages");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
const exampleButtons = Array.from(document.querySelectorAll("[data-example]"));

let mode = "auto";

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

  const loadingMessage = addMessage("ai", "Pensando...");

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, mode })
    });

    const data = await response.json();
    loadingMessage.remove();

    if (!response.ok) {
      addMessage("ai", data.error || "No pude completar la peticion.");
      return;
    }

    if (data.type === "image") {
      addImageMessage(data.image, prompt);
      return;
    }

    addMessage("ai", data.text || "Listo.");
  } catch (error) {
    loadingMessage.remove();
    addMessage("ai", "No pude conectar con el servidor. Revisa que la app este encendida.");
  } finally {
    setLoading(false);
  }
});

function addMessage(role, text) {
  const article = document.createElement("article");
  article.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "TU" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  article.append(avatar, bubble);
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  return article;
}

function addImageMessage(src, alt) {
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
  messages.scrollTop = messages.scrollHeight;
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  sendButton.textContent = isLoading ? "Creando..." : "Enviar";
}
