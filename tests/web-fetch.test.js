"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const { Readable }=require("node:stream");
const {
  readResponseBody,
  createSafeWebFetcher
}=require("../src/web/fetch-page");

function response(body,headers={},statusCode=200) {
  const stream=Readable.from([Buffer.from(body)]);
  stream.headers=headers;
  stream.statusCode=statusCode;
  return stream;
}

test("safe body reader accepts allowlisted text content",async()=>{
  const result=await readResponseBody(
    response("hello",{"content-type":"text/plain; charset=utf-8"}),
    {maxBytes:1024}
  );
  assert.equal(result.body,"hello");
  assert.equal(result.bytes,5);
});

test("safe body reader blocks active/binary content types",async()=>{
  assert.throws(
    ()=>readResponseBody(
      response("x",{"content-type":"application/javascript"}),
      {maxBytes:1024}
    ),
    (e)=>e.code==="WEB_CONTENT_TYPE_BLOCKED"
  );
});

test("safe body reader blocks compressed responses",()=>{
  assert.throws(
    ()=>readResponseBody(
      response("x",{
        "content-type":"text/html",
        "content-encoding":"gzip"
      }),
      {maxBytes:1024}
    ),
    (e)=>e.code==="WEB_CONTENT_ENCODING_BLOCKED"
  );
});

test("safe fetcher revalidates redirect destinations before second request",async()=>{
  let requestCalls=0;
  const fetcher=createSafeWebFetcher({
    lookup:async(hostname)=>{
      if(hostname==="public.example") return [{address:"1.1.1.1",family:4}];
      if(hostname==="private.example") return [{address:"127.0.0.1",family:4}];
      return [];
    },
    requestImpl:async()=>{
      requestCalls+=1;
      return response("",{
        location:"http://private.example/",
        "content-type":"text/plain"
      },302);
    }
  });

  await assert.rejects(
    fetcher.fetchPage("https://public.example/"),
    (e)=>e.code==="WEB_SSRF_BLOCKED"
  );
  assert.equal(requestCalls,1);
});

test("safe fetcher enforces redirect limit",async()=>{
  const fetcher=createSafeWebFetcher({
    maxRedirects:1,
    lookup:async()=>[{address:"1.1.1.1",family:4}],
    requestImpl:async(target)=>response("",{
      location:target.toString(),
      "content-type":"text/plain"
    },302)
  });

  await assert.rejects(
    fetcher.fetchPage("https://example.com/"),
    (e)=>e.code==="WEB_REDIRECT_LIMIT"
  );
});
