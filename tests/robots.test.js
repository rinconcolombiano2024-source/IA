"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const { parseRobots,evaluateRobots,createRobotsManager }=require("../src/web/robots");

test("robots longest matching rule wins and allow wins ties",()=>{
  const groups=parseRobots(
    "User-agent: *\n"+
    "Disallow: /private\n"+
    "Allow: /private/public\n"
  );
  assert.equal(evaluateRobots(groups,"https://example.com/private/a","Bot").allowed,false);
  assert.equal(evaluateRobots(groups,"https://example.com/private/public/a","Bot").allowed,true);
});

test("specific user-agent group is preferred over wildcard",()=>{
  const groups=parseRobots(
    "User-agent: *\n"+
    "Disallow: /\n\n"+
    "User-agent: Rincon-Colombiano-IA-WebResearch\n"+
    "Allow: /\n"+
    "Crawl-delay: 0.5\n"
  );
  const decision=evaluateRobots(groups,"https://example.com/page","Rincon-Colombiano-IA-WebResearch/1.0");
  assert.equal(decision.allowed,true);
  assert.equal(decision.crawlDelayMs,500);
});

test("robots manager caches per origin",async()=>{
  let calls=0;
  const manager=createRobotsManager({
    fetchPage:async()=>{
      calls+=1;
      return {body:"User-agent: *\nDisallow: /blocked"};
    },
    now:()=>1000
  });
  assert.equal((await manager.canFetch("https://example.com/a")).allowed,true);
  assert.equal((await manager.canFetch("https://example.com/blocked")).allowed,false);
  assert.equal(calls,1);
});

test("robots retrieval failure does not execute or invent rules",async()=>{
  const manager=createRobotsManager({
    fetchPage:async()=>{ throw new Error("404"); }
  });
  const decision=await manager.canFetch("https://example.com/a");
  assert.equal(decision.allowed,true);
  assert.equal(decision.robotsStatus,"unavailable");
});
