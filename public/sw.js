"use strict";
// Network-only worker: never cache credentials, private files, prompts or API responses.
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== self.location.origin || !["/", "/index.html"].includes(url.pathname)) return;
  event.respondWith(fetch(request).catch(() => new Response(
    '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mi IA sin conexión</title><h1>Sin conexión</h1><p>Conéctate a Internet para utilizar la inteligencia artificial.</p><p><a href="/">Volver a intentar</a></p></html>',
    { status: 503, headers: {"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Security-Policy":"default-src \'none\'; base-uri \'none\'; frame-ancestors \'none\'"} }
  )));
});
