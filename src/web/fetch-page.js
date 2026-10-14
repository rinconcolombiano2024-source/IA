"use strict";

const http = require("node:http");
const https = require("node:https");
const { resolveAndValidateUrl } = require("../security/url-policy");

const DEFAULT_CONTENT_TYPES = Object.freeze([
  "text/html",
  "text/plain",
  "application/json",
  "application/xml",
  "text/xml",
  "application/xhtml+xml"
]);

function positiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value ?? ""),10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min,Math.min(max,parsed));
}

function normalizeContentType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function createWebFetchError(message, code) {
  const error = new Error(message);
  error.name = "WebFetchError";
  error.code = code;
  return error;
}

function readResponseBody(response, options = {}) {
  const maxBytes = positiveInteger(options.maxBytes,2_000_000,1_024,10_000_000);
  const allowedContentTypes = new Set(
    Array.isArray(options.allowedContentTypes) && options.allowedContentTypes.length
      ? options.allowedContentTypes
      : DEFAULT_CONTENT_TYPES
  );
  const contentType = normalizeContentType(response.headers?.["content-type"]);
  const contentEncoding = String(response.headers?.["content-encoding"] || "identity").toLowerCase();

  if (!allowedContentTypes.has(contentType)) {
    response.resume?.();
    throw createWebFetchError(
      "El tipo de contenido remoto no esta permitido.",
      "WEB_CONTENT_TYPE_BLOCKED"
    );
  }

  if (contentEncoding && contentEncoding !== "identity") {
    response.resume?.();
    throw createWebFetchError(
      "El contenido remoto comprimido no esta permitido en esta capa segura.",
      "WEB_CONTENT_ENCODING_BLOCKED"
    );
  }

  const declaredLength = Number(response.headers?.["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    response.resume?.();
    throw createWebFetchError(
      "El contenido remoto supera el limite permitido.",
      "WEB_RESPONSE_TOO_LARGE"
    );
  }

  return new Promise((resolve,reject)=>{
    const chunks=[];
    let bytes=0;
    let settled=false;

    function fail(error) {
      if (settled) return;
      settled=true;
      response.destroy?.();
      reject(error);
    }

    response.on("data",(chunk)=>{
      if (settled) return;
      const buffer=Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        fail(createWebFetchError(
          "El contenido remoto supera el limite permitido.",
          "WEB_RESPONSE_TOO_LARGE"
        ));
        return;
      }
      chunks.push(buffer);
    });

    response.once("error",(error)=>{
      fail(createWebFetchError(
        "La lectura del contenido remoto fallo.",
        error?.code === "ABORT_ERR" ? "WEB_FETCH_ABORTED" : "WEB_RESPONSE_ERROR"
      ));
    });

    response.once("end",()=>{
      if (settled) return;
      settled=true;
      resolve({
        body:Buffer.concat(chunks).toString("utf8"),
        bytes,
        contentType
      });
    });
  });
}

function requestOnce(target, resolved, options = {}) {
  const timeoutMs = positiveInteger(options.timeoutMs,10_000,500,60_000);
  const address = resolved.addresses[0];
  const transport = target.protocol === "https:" ? https : http;

  return new Promise((resolve,reject)=>{
    const request = transport.request(target,{
      method:"GET",
      headers:{
        Accept:"text/html,text/plain,application/json,application/xml,text/xml;q=0.9,*/*;q=0.1",
        "Accept-Encoding":"identity",
        "User-Agent":"Rincon-Colombiano-IA-WebResearch/1.0"
      },
      timeout:timeoutMs,
      lookup(_hostname,_options,callback) {
        callback(null,address.address,address.family);
      }
    },(response)=>resolve(response));

    request.once("timeout",()=>{
      request.destroy(
        createWebFetchError("La pagina remota excedio el tiempo limite.","WEB_FETCH_TIMEOUT")
      );
    });
    request.once("error",(error)=>{
      reject(
        error?.code && String(error.code).startsWith("WEB_")
          ? error
          : createWebFetchError(
              "No fue posible conectar con la pagina remota.",
              "WEB_FETCH_NETWORK_ERROR"
            )
      );
    });
    request.end();
  });
}

function createSafeWebFetcher(options = {}) {
  const lookup = options.lookup;
  const maxRedirects = positiveInteger(options.maxRedirects,3,0,8);
  const maxBytes = positiveInteger(options.maxBytes,2_000_000,1_024,10_000_000);
  const timeoutMs = positiveInteger(options.timeoutMs,10_000,500,60_000);
  const allowedPorts = options.allowedPorts;
  const allowedContentTypes = options.allowedContentTypes || DEFAULT_CONTENT_TYPES;
  const requestImpl = options.requestImpl || requestOnce;

  async function fetchPage(input) {
    let current=String(input || "");
    const redirects=[];

    for(let hop=0;hop<=maxRedirects;hop+=1) {
      const resolved=await resolveAndValidateUrl(current,{lookup,allowedPorts});
      const response=await requestImpl(resolved.url,resolved,{
        timeoutMs,
        maxBytes,
        allowedContentTypes
      });
      const status=Number(response.statusCode || 0);

      if ([301,302,303,307,308].includes(status)) {
        const location=response.headers?.location;
        response.resume?.();
        if (!location) {
          throw createWebFetchError(
            "La redireccion remota no contiene destino.",
            "WEB_REDIRECT_INVALID"
          );
        }
        if (hop >= maxRedirects) {
          throw createWebFetchError(
            "La pagina excedio el limite de redirecciones.",
            "WEB_REDIRECT_LIMIT"
          );
        }
        const next=new URL(location,resolved.url).toString();
        redirects.push({
          from:resolved.url.toString(),
          to:next,
          status
        });
        current=next;
        continue;
      }

      if (status < 200 || status >= 300) {
        response.resume?.();
        throw createWebFetchError(
          "La pagina remota devolvio un estado HTTP no utilizable.",
          "WEB_HTTP_ERROR"
        );
      }

      const content=await readResponseBody(response,{
        maxBytes,
        allowedContentTypes
      });

      return {
        url:resolved.url.toString(),
        status,
        contentType:content.contentType,
        bytes:content.bytes,
        body:content.body,
        redirects
      };
    }

    throw createWebFetchError(
      "La pagina excedio el limite de redirecciones.",
      "WEB_REDIRECT_LIMIT"
    );
  }

  return Object.freeze({
    fetchPage,
    config:{
      maxRedirects,
      maxBytes,
      timeoutMs,
      allowedContentTypes:[...allowedContentTypes]
    }
  });
}

module.exports = {
  DEFAULT_CONTENT_TYPES,
  normalizeContentType,
  createWebFetchError,
  readResponseBody,
  requestOnce,
  createSafeWebFetcher
};
