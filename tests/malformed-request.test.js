"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

async function freePort() {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function request(port, target, host = "localhost") {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname:"127.0.0.1",port,path:target,method:"GET",headers:{Host:host}}, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", data => { body += data; });
      res.on("end", () => resolve({status:res.statusCode,headers:res.headers,body}));
    });
    req.setTimeout(2000, () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    req.end();
  });
}

test("malformed unauthenticated requests return 400 without terminating the server", {timeout:15000}, async t => {
  const port = await freePort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ia-request-test-"));
  const child = spawn(process.execPath, [path.join(__dirname,"../server.js")], {
    env:{...process.env,PORT:String(port),VERCEL:"1",TMPDIR:tmp,AI_STATE_STORE:"local",
      APP_AUTH_USER:"test-admin",APP_AUTH_PASSWORD:"test-password-only",
      OPENAI_API_KEY:"",ANTHROPIC_API_KEY:"",GEMINI_API_KEY:"",XAI_API_KEY:"",GROQ_API_KEY:"",
      AI_MODEL_DISCOVERY_ENABLED:"false"},stdio:["ignore","pipe","pipe"]
  });
  let stderr="";child.stderr.on("data",d=>{stderr+=d.toString();});child.stdout.resume();
  t.after(async()=>{
    if(child.exitCode===null && child.signalCode===null){const done=once(child,"exit");child.kill();await done;}
    fs.rmSync(tmp,{recursive:true,force:true});
  });
  let ready=false;
  for(let n=0;n<70;n++){
    try {if((await request(port,"/api/public-status")).status===200){ready=true;break;}}catch{}
    if(child.exitCode!==null)break;
    await new Promise(r=>setTimeout(r,50));
  }
  assert.equal(ready,true,"server failed to start");
  for(const [target,host] of [["/","["],["http://[","localhost"]]){
    let response;
    try {response=await request(port,target,host);} catch(error) {
      await new Promise(r=>setTimeout(r,50));
      assert.fail(`request failed: ${error.code}; server exit=${child.exitCode}; invalid-URL exception=${stderr.includes("ERR_INVALID_URL")}`);
    }
    assert.equal(response.status,400);
    assert.equal(JSON.parse(response.body).code,"INVALID_REQUEST_URL");
    assert.ok(response.headers["x-request-id"]);
    assert.equal(response.headers["cache-control"],"no-store");
    assert.doesNotMatch(response.body,/ERR_INVALID_URL|node:|server\.js|TypeError/);
    assert.equal((await request(port,"/api/public-status")).status,200);
  }
  assert.equal(child.exitCode,null);
  assert.doesNotMatch(stderr,/ERR_INVALID_URL|unhandled/i);
  assert.equal((await request(port,"/api/health")).status,401);
  assert.equal((await request(port,"/")).status,200);
});
