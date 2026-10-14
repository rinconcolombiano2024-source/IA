"use strict";

const { extractLinks } = require("./extractor");
const { createWebDocument } = require("./document-pipeline");
const { createRobotsManager } = require("./robots");

function positiveInteger(value,fallback,min,max) {
  const parsed=Number.parseInt(String(value ?? ""),10);
  if(!Number.isFinite(parsed)) return fallback;
  return Math.max(min,Math.min(max,parsed));
}

function sleep(ms) {
  return new Promise((resolve)=>setTimeout(resolve,ms));
}

function createCrawler(options = {}) {
  const fetcher=options.fetcher;
  const maxPages=positiveInteger(options.maxPages,20,1,100);
  const maxDepth=positiveInteger(options.maxDepth,2,0,5);
  const concurrency=positiveInteger(options.concurrency,3,1,10);
  const maxLinksPerPage=positiveInteger(options.maxLinksPerPage,100,1,500);
  const sameOrigin=options.sameOrigin !== false;
  const respectRobots=options.respectRobots !== false;
  const delay=typeof options.sleep === "function" ? options.sleep : sleep;

  if(!fetcher || typeof fetcher.fetchPage !== "function") {
    throw new Error("Crawler requires a safe web fetcher.");
  }

  const robots=options.robots || createRobotsManager({
    fetchPage:fetcher.fetchPage,
    userAgent:options.userAgent
  });

  async function crawl(startUrl) {
    const seed=new URL(String(startUrl));
    const queue=[{url:seed.toString(),depth:0}];
    const queued=new Set([seed.toString()]);
    const visited=new Set();
    const contentHashes=new Set();
    const documents=[];
    const skipped=[];
    const errors=[];
    let active=0;

    return new Promise((resolve)=>{
      function finishIfDone() {
        if((!queue.length || documents.length >= maxPages) && active === 0) {
          resolve({
            startUrl:seed.toString(),
            documents,
            skipped,
            errors,
            stats:{
              fetched:visited.size,
              accepted:documents.length,
              duplicates:skipped.filter((item)=>item.reason==="duplicate_content").length,
              robotsBlocked:skipped.filter((item)=>item.reason==="robots").length,
              queued:queued.size
            }
          });
          return true;
        }
        return false;
      }

      function schedule() {
        if(finishIfDone()) return;

        while(
          active < concurrency &&
          queue.length &&
          documents.length + active < maxPages
        ) {
          const item=queue.shift();
          if(visited.has(item.url)) continue;
          visited.add(item.url);
          active += 1;

          processItem(item)
            .catch((error)=>{
              errors.push({
                url:item.url,
                code:String(error?.code || "WEB_CRAWL_ERROR").slice(0,80)
              });
            })
            .finally(()=>{
              active -= 1;
              schedule();
            });
        }

        finishIfDone();
      }

      async function processItem(item) {
        if(respectRobots) {
          const decision=await robots.canFetch(item.url);
          if(!decision.allowed) {
            skipped.push({
              url:item.url,
              reason:"robots",
              rule:decision.matchedRule?.path || null
            });
            return;
          }
          if(decision.crawlDelayMs > 0) {
            await delay(decision.crawlDelayMs);
          }
        }

        const result=await fetcher.fetchPage(item.url);
        const document=createWebDocument(result);

        if(contentHashes.has(document.sha256)) {
          skipped.push({
            url:document.url,
            reason:"duplicate_content",
            sha256:document.sha256
          });
          return;
        }

        contentHashes.add(document.sha256);
        documents.push(document);

        if(item.depth >= maxDepth) return;
        if(!["text/html","application/xhtml+xml"].includes(document.contentType)) return;

        const links=extractLinks(result.body,document.url,{
          sameOrigin,
          maxLinks:maxLinksPerPage
        });

        for(const link of links) {
          if(queued.has(link) || visited.has(link)) continue;
          if(sameOrigin && new URL(link).origin !== seed.origin) continue;
          queued.add(link);
          queue.push({
            url:link,
            depth:item.depth+1
          });
        }
      }

      schedule();
    });
  }

  return Object.freeze({
    crawl,
    config:{
      maxPages,
      maxDepth,
      concurrency,
      maxLinksPerPage,
      sameOrigin,
      respectRobots
    }
  });
}

module.exports={
  createCrawler
};
