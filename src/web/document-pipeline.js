"use strict";

const { extractWebContent } = require("./extractor");
const {
  createUntrustedExternalData,
  buildUntrustedModelContext
} = require("../security/untrusted-content");

function createWebDocument(fetchResult, options = {}) {
  const extracted=extractWebContent(fetchResult);
  const url=new URL(String(fetchResult.url || ""));
  const capturedAt=String(options.capturedAt || new Date().toISOString());

  const untrusted=createUntrustedExternalData({
    sourceType:"web",
    sourceUrl:url.toString(),
    capturedAt,
    text:extracted.text,
    maxChars:options.maxChars
  });

  return Object.freeze({
    kind:"web_document",
    trust:untrusted.trust,
    execution:untrusted.execution,
    url:url.toString(),
    domain:url.hostname.toLowerCase(),
    title:extracted.title,
    contentType:extracted.contentType,
    bytes:Number(fetchResult.bytes || 0),
    capturedAt:untrusted.capturedAt,
    sha256:untrusted.sha256,
    suspicious:untrusted.suspicious,
    injectionSignals:untrusted.injectionSignals,
    text:untrusted.text,
    redirects:Object.freeze(
      Array.isArray(fetchResult.redirects)
        ? fetchResult.redirects.slice(0,8).map((item)=>Object.freeze({
            from:String(item?.from || "").slice(0,2048),
            to:String(item?.to || "").slice(0,2048),
            status:Number(item?.status || 0)
          }))
        : []
    )
  });
}

function toModelContext(webDocument, options = {}) {
  return buildUntrustedModelContext(webDocument,options);
}

module.exports={
  createWebDocument,
  toModelContext
};
