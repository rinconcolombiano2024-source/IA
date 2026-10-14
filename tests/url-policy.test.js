"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  validateUrlSyntax,
  resolveAndValidateUrl,
  isPublicIp
}=require("../src/security/url-policy");

test("web URL policy permits normal public HTTP/HTTPS URLs",async()=>{
  assert.equal(validateUrlSyntax("https://example.com/path").protocol,"https:");
  const result=await resolveAndValidateUrl("https://example.com",{
    lookup:async()=>[{address:"93.184.216.34",family:4}]
  });
  assert.equal(result.addresses[0].address,"93.184.216.34");
});

test("web URL policy blocks non-http protocols and embedded credentials",()=>{
  assert.throws(()=>validateUrlSyntax("file:///etc/passwd"),(e)=>e.code==="WEB_PROTOCOL_BLOCKED");
  assert.throws(()=>validateUrlSyntax("https://user:pass@example.com"),(e)=>e.code==="WEB_CREDENTIALS_BLOCKED");
});

test("web URL policy blocks localhost and unsafe ports",()=>{
  assert.throws(()=>validateUrlSyntax("http://localhost"),(e)=>e.code==="WEB_HOST_BLOCKED");
  assert.throws(()=>validateUrlSyntax("https://example.com:8443"),(e)=>e.code==="WEB_PORT_BLOCKED");
});

test("private, link-local, metadata and reserved IPv4 are blocked",()=>{
  for(const address of [
    "0.0.0.0","10.1.2.3","100.64.0.1","127.0.0.1","169.254.169.254",
    "172.16.0.1","192.168.1.1","198.18.0.1","224.0.0.1","255.255.255.255"
  ]) {
    assert.equal(isPublicIp(address),false,address);
  }
  assert.equal(isPublicIp("1.1.1.1"),true);
});

test("private, loopback and mapped-private IPv6 are blocked",()=>{
  for(const address of [
    "::","::1","fc00::1","fd00:ec2::254","fe80::1","ff02::1",
    "2001:db8::1","::ffff:127.0.0.1","::ffff:169.254.169.254"
  ]) {
    assert.equal(isPublicIp(address),false,address);
  }
  assert.equal(isPublicIp("2606:4700:4700::1111"),true);
});

test("DNS response is rejected if any resolved address is private",async()=>{
  await assert.rejects(
    resolveAndValidateUrl("https://example.com",{
      lookup:async()=>[
        {address:"93.184.216.34",family:4},
        {address:"127.0.0.1",family:4}
      ]
    }),
    (e)=>e.code==="WEB_SSRF_BLOCKED"
  );
});
