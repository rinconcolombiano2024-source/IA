"use strict";

function createClientRequestError(statusCode, code, publicMessage, details = {}) {
  const error = new Error(publicMessage);
  error.name = "ClientRequestError";
  error.statusCode = statusCode;
  error.code = code;
  error.publicMessage = publicMessage;
  error.isClientRequestError = true;

  if (Number.isFinite(Number(details.maxBytes))) {
    error.maxBytes = Number(details.maxBytes);
  }

  return error;
}

function isClientRequestError(error) {
  return Boolean(
    error &&
      error.isClientRequestError === true &&
      Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode < 500
  );
}

function normalizeContentType(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function isJsonContentType(value) {
  const contentType = normalizeContentType(value);
  return (
    !contentType ||
    contentType === "application/json" ||
    contentType.endsWith("+json")
  );
}

function parseContentLength(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeLimitBytes(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 2_000_000;
  return parsed;
}

async function readJsonBody(req, options = {}) {
  const limitBytes = normalizeLimitBytes(options.limitBytes);
  const contentType = req?.headers?.["content-type"];

  if (!isJsonContentType(contentType)) {
    throw createClientRequestError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "El cuerpo de la peticion debe enviarse como JSON."
    );
  }

  const declaredLength = parseContentLength(req?.headers?.["content-length"]);
  if (declaredLength !== null && declaredLength > limitBytes) {
    throw createClientRequestError(
      413,
      "PAYLOAD_TOO_LARGE",
      "La peticion supera el limite de tamano permitido.",
      { maxBytes: limitBytes }
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let totalBytes = 0;
    const chunks = [];

    function fail(error) {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(error);

      if (typeof req.resume === "function") {
        req.resume();
      }
    }

    req.on("data", (chunk) => {
      if (settled) return;

      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

      totalBytes += buffer.length;

      if (totalBytes > limitBytes) {
        fail(
          createClientRequestError(
            413,
            "PAYLOAD_TOO_LARGE",
            "La peticion supera el limite de tamano permitido.",
            { maxBytes: limitBytes }
          )
        );
        return;
      }

      chunks.push(buffer);
    });

    req.on("end", () => {
      if (settled) return;
      settled = true;

      if (!chunks.length) {
        resolve({});
        return;
      }

      const raw = Buffer.concat(chunks, totalBytes).toString("utf8");

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(
          createClientRequestError(
            400,
            "INVALID_JSON",
            "El servidor recibio JSON invalido."
          )
        );
      }
    });

    req.on("aborted", () => {
      fail(
        createClientRequestError(
          400,
          "REQUEST_ABORTED",
          "La peticion fue interrumpida antes de completarse."
        )
      );
    });

    req.on("error", () => {
      fail(
        createClientRequestError(
          400,
          "REQUEST_STREAM_ERROR",
          "No fue posible leer completamente la peticion."
        )
      );
    });
  });
}

module.exports = {
  createClientRequestError,
  isClientRequestError,
  normalizeContentType,
  isJsonContentType,
  parseContentLength,
  readJsonBody
};
