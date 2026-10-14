"use strict";

function normalizePath(value) {
  try {
    const url = new URL(String(value || ""), "https://robots.invalid");
    return url.pathname + url.search;
  } catch {
    return "/";
  }
}

function parseRobots(text) {
  const groups=[];
  let agents=[];
  let rules=[];
  let crawlDelay=null;

  function flush() {
    if(!agents.length) return;
    groups.push({
      agents:[...agents],
      rules:[...rules],
      crawlDelay
    });
    agents=[];
    rules=[];
    crawlDelay=null;
  }

  for(const rawLine of String(text || "").split(/\r?\n/)) {
    const line=rawLine.replace(/#.*$/,"").trim();
    if(!line) continue;
    const separator=line.indexOf(":");
    if(separator < 0) continue;
    const field=line.slice(0,separator).trim().toLowerCase();
    const value=line.slice(separator+1).trim();

    if(field === "user-agent") {
      if(rules.length || crawlDelay !== null) flush();
      agents.push(value.toLowerCase());
      continue;
    }

    if(!agents.length) continue;

    if(field === "allow" || field === "disallow") {
      rules.push({
        type:field,
        path:value
      });
      continue;
    }

    if(field === "crawl-delay") {
      const seconds=Number(value);
      if(Number.isFinite(seconds) && seconds >= 0) {
        crawlDelay=Math.min(60_000,Math.round(seconds*1000));
      }
    }
  }

  flush();
  return groups;
}

function agentMatches(agent,token) {
  const normalized=String(agent || "").toLowerCase();
  const value=String(token || "").toLowerCase();
  return value === "*" || normalized.includes(value);
}

function selectGroups(groups,userAgent) {
  const exact=groups.filter((group)=>
    group.agents.some((agent)=>agent !== "*" && agentMatches(userAgent,agent))
  );
  if(exact.length) return exact;
  return groups.filter((group)=>group.agents.includes("*"));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$(){}|[\]\\]/g,"\\$&");
}

function ruleMatches(pathname,rulePath) {
  if(rulePath === "") return false;
  const raw=String(rulePath);
  const anchored=raw.endsWith("$");
  const withoutEnd=anchored ? raw.slice(0,-1) : raw;
  const source="^"+withoutEnd
    .split("*")
    .map(escapeRegex)
    .join(".*")+
    (anchored ? "$" : ".*");
  try {
    return new RegExp(source).test(pathname);
  } catch {
    return pathname.startsWith(withoutEnd.replace(/\*/g,""));
  }
}

function evaluateRobots(groups,url,userAgent) {
  const path=normalizePath(url);
  const selected=selectGroups(groups,userAgent);
  if(!selected.length) {
    return {allowed:true,matchedRule:null,crawlDelayMs:0};
  }

  const candidates=[];
  let crawlDelayMs=0;
  for(const group of selected) {
    if(Number.isFinite(group.crawlDelay)) {
      crawlDelayMs=Math.max(crawlDelayMs,group.crawlDelay);
    }
    for(const rule of group.rules) {
      if(ruleMatches(path,rule.path)) {
        candidates.push({
          type:rule.type,
          path:rule.path,
          specificity:String(rule.path).replace(/[\*$]/g,"").length
        });
      }
    }
  }

  candidates.sort((a,b)=>
    b.specificity-a.specificity ||
    (a.type === "allow" ? -1 : 1)
  );
  const winner=candidates[0] || null;

  return {
    allowed:!winner || winner.type === "allow",
    matchedRule:winner,
    crawlDelayMs
  };
}

function createRobotsManager(options = {}) {
  const fetchPage=options.fetchPage;
  const userAgent=String(options.userAgent || "Rincon-Colombiano-IA-WebResearch").slice(0,200);
  const cacheTtlMs=Math.max(60_000,Math.min(24*60*60_000,Number(options.cacheTtlMs)||60*60_000));
  const now=typeof options.now === "function" ? options.now : Date.now;
  const cache=new Map();

  if(typeof fetchPage !== "function") {
    throw new Error("Robots manager requires fetchPage.");
  }

  async function load(origin) {
    const key=String(origin);
    const existing=cache.get(key);
    if(existing && existing.expiresAt > now()) return existing;

    const robotsUrl=new URL("/robots.txt",key).toString();
    let entry;

    try {
      const result=await fetchPage(robotsUrl);
      const groups=parseRobots(result.body);
      entry={
        status:"loaded",
        groups,
        fetchedAt:now(),
        expiresAt:now()+cacheTtlMs
      };
    } catch {
      entry={
        status:"unavailable",
        groups:[],
        fetchedAt:now(),
        expiresAt:now()+Math.min(cacheTtlMs,5*60_000)
      };
    }

    cache.set(key,entry);
    return entry;
  }

  async function canFetch(url) {
    const target=new URL(String(url));
    const entry=await load(target.origin);
    const decision=evaluateRobots(entry.groups,target,userAgent);
    return {
      ...decision,
      robotsStatus:entry.status
    };
  }

  return Object.freeze({
    canFetch,
    summary:()=>({
      userAgent,
      cachedOrigins:cache.size,
      cacheTtlMs
    })
  });
}

module.exports={
  parseRobots,
  evaluateRobots,
  createRobotsManager
};
