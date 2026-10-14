"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.join(__dirname,"..");

test("Vercel deployment documentation includes required authentication variables",()=>{
  const readme=fs.readFileSync(path.join(root,"README.md"),"utf8");
  const envExample=fs.readFileSync(path.join(root,".env.example"),"utf8");

  for(const key of ["APP_AUTH_USER","APP_AUTH_PASSWORD"]) {
    assert.match(readme,new RegExp("\\b"+key+"\\b"));
    assert.match(envExample,new RegExp("^"+key+"=", "m"));
  }

  assert.match(readme,/AUTH_NOT_CONFIGURED/);
  assert.match(readme,/Production/);
  assert.match(readme,/vuelve a desplegar|nuevo deployment/i);
});

test("repository does not document disabling auth as a Vercel fix",()=>{
  const readme=fs.readFileSync(path.join(root,"README.md"),"utf8");
  assert.doesNotMatch(
    readme,
    /(?:desactiva|deshabilita|disable)\s+(?:la\s+)?autenticacion/i
  );
});
