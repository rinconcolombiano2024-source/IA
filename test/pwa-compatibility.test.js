"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {isPublicRequest}=require("../src/security/public-routes");
const root=path.join(__dirname,"../public");
test("manifest icons exist, match size and are publicly readable",()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.webmanifest"),"utf8"));
 assert.equal(manifest.start_url,"/");
 assert.equal(manifest.display,"standalone");
 for(const icon of manifest.icons){
  assert.equal(isPublicRequest("GET",icon.src),true);
  const data=fs.readFileSync(path.join(root,icon.src.slice(1)));
  assert.equal(data.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
  assert.equal(data.readUInt32BE(16)+"x"+data.readUInt32BE(20),icon.sizes);
 }
});
test("PWA assets do not open private operations",()=>{
 for(const p of ["/manifest.webmanifest","/sw.js","/icon-192.png","/icon-512.png"]) {
  assert.equal(isPublicRequest("GET",p),true);
  assert.equal(isPublicRequest("POST",p),false);
 }
 for(const p of ["/api/run","/api/health","/api/history","/generated/example.pdf","/api/video/1"]) assert.equal(isPublicRequest("GET",p),false);
});
