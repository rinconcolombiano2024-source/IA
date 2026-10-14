"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const { createCrawler }=require("../src/web/crawler");
const { extractLinks }=require("../src/web/extractor");

test("link extraction ignores active blocks and off-origin links by default",()=>{
  const html=
    '<a href="/one">One</a>'+
    '<script><a href="/evil">Evil</a></script>'+
    '<a href="https://other.example/two">Two</a>';
  const links=extractLinks(html,"https://example.com/root");
  assert.deepEqual(links,["https://example.com/one"]);
});

test("crawler respects robots, depth, same-origin and content deduplication",async()=>{
  const pages=new Map([
    ["https://example.com/",{
      contentType:"text/html",bytes:100,
      body:'<a href="/a">A</a><a href="/blocked">Blocked</a><a href="https://other.example/x">Off</a>'
    }],
    ["https://example.com/a",{
      contentType:"text/html",bytes:100,
      body:'<a href="/dup">Dup</a><a href="/deep">Deep</a>'
    }],
    ["https://example.com/dup",{
      contentType:"text/html",bytes:100,
      body:"<p>same</p>"
    }],
    ["https://example.com/deep",{
      contentType:"text/html",bytes:100,
      body:"<p>same</p>"
    }]
  ]);
  const fetched=[];
  const fetcher={
    async fetchPage(url) {
      fetched.push(url);
      const page=pages.get(url);
      if(!page) throw new Error("missing");
      return {url,status:200,redirects:[],...page};
    }
  };
  const robots={
    async canFetch(url) {
      return {
        allowed:!url.endsWith("/blocked"),
        matchedRule:url.endsWith("/blocked")?{path:"/blocked"}:null,
        crawlDelayMs:0
      };
    }
  };

  const crawler=createCrawler({
    fetcher,robots,maxPages:10,maxDepth:2,concurrency:2
  });
  const result=await crawler.crawl("https://example.com/");

  assert.ok(result.documents.some((doc)=>doc.url==="https://example.com/"));
  assert.ok(result.documents.some((doc)=>doc.url==="https://example.com/a"));
  assert.equal(fetched.includes("https://example.com/blocked"),false);
  assert.equal(fetched.some((url)=>url.startsWith("https://other.example")),false);
  assert.equal(result.stats.robotsBlocked,1);
  assert.equal(result.stats.duplicates,1);
});

test("crawler enforces maxPages under concurrency",async()=>{
  const fetcher={
    async fetchPage(url) {
      const path=new URL(url).pathname;
      const body=path==="/"
        ? Array.from({length:20},(_,i)=>'<a href="/p'+i+'">x</a>').join("")
        : "<p>"+path+"</p>";
      return {
        url,status:200,redirects:[],
        contentType:"text/html",
        bytes:Buffer.byteLength(body),
        body
      };
    }
  };
  const robots={canFetch:async()=>({allowed:true,crawlDelayMs:0})};
  const crawler=createCrawler({fetcher,robots,maxPages:5,maxDepth:1,concurrency:3});
  const result=await crawler.crawl("https://example.com/");
  assert.equal(result.documents.length,5);
});

test("crawler records fetch failures without aborting the whole crawl",async()=>{
  const fetcher={
    async fetchPage(url) {
      if(url.endsWith("/bad")) {
        const error=new Error("network");
        error.code="WEB_FETCH_NETWORK_ERROR";
        throw error;
      }
      return {
        url,status:200,redirects:[],contentType:"text/html",bytes:50,
        body:'<a href="/bad">bad</a><a href="/good">good</a>'
      };
    }
  };
  const robots={canFetch:async()=>({allowed:true,crawlDelayMs:0})};
  const crawler=createCrawler({fetcher,robots,maxPages:4,maxDepth:1,concurrency:2});
  const result=await crawler.crawl("https://example.com/");
  assert.ok(result.errors.some((item)=>item.code==="WEB_FETCH_NETWORK_ERROR"));
  assert.ok(result.documents.some((doc)=>doc.url==="https://example.com/good"));
});
