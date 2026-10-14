"use strict";

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/&#x([0-9a-f]+);/gi,(_m,hex)=>String.fromCodePoint(Number.parseInt(hex,16)))
    .replace(/&#(\d+);/g,(_m,num)=>String.fromCodePoint(Number.parseInt(num,10)));
}

function stripActiveAndHiddenHtml(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g," ")
    .replace(/<(script|style|noscript|template|iframe|object|embed|svg|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi," ")
    .replace(/<meta\b[^>]*>/gi," ")
    .replace(/<link\b[^>]*>/gi," ");
}

function extractTitle(html) {
  const match=String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return match ? decodeHtmlEntities(match[1]).replace(/\s+/g," ").trim().slice(0,500) : "";
}

function htmlToText(html) {
  const cleaned=stripActiveAndHiddenHtml(html)
    .replace(/<(br|hr)\b[^>]*>/gi,"\n")
    .replace(/<\/(p|div|section|article|main|header|footer|li|ul|ol|h[1-6]|table|tr)>/gi,"\n")
    .replace(/<[^>]+>/g," ");
  return decodeHtmlEntities(cleaned)
    .replace(/[ \t]+/g," ")
    .replace(/ *\n */g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}

function extractWebContent(fetchResult) {
  if (!fetchResult || typeof fetchResult !== "object") {
    throw new Error("Web extraction requires a fetch result.");
  }

  const contentType=String(fetchResult.contentType || "").toLowerCase();
  const body=String(fetchResult.body || "");

  if (contentType === "text/html" || contentType === "application/xhtml+xml") {
    return {
      title:extractTitle(body),
      text:htmlToText(body),
      contentType
    };
  }

  if (
    contentType === "text/plain" ||
    contentType === "application/json" ||
    contentType === "application/xml" ||
    contentType === "text/xml"
  ) {
    return {
      title:"",
      text:body,
      contentType
    };
  }

  throw new Error("Unsupported extracted web content type.");
}

module.exports={
  decodeHtmlEntities,
  stripActiveAndHiddenHtml,
  extractTitle,
  htmlToText,
  extractWebContent
};
