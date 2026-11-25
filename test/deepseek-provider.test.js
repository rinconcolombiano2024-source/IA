"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {createDeepSeekProvider}=require("../src/providers/deepseek/provider");
test("DeepSeek uses chat completions and extracts final content",()=>{
 const provider=createDeepSeekProvider({env:{DEEPSEEK_API_KEY:"test-key"}});
 const request=provider.buildTextRequest({instructions:"system",input:"user"});
 assert.equal(provider.endpoint(request.endpointName),"https://api.deepseek.com/chat/completions");
 assert.equal(request.payload.model,"deepseek-flash");
 assert.equal(request.payload.messages[1].content,"user");
 assert.equal(provider.extractText({choices:[{message:{content:"answer",reasoning_content:"private"}}]}),"answer");
 assert.equal(provider.supports("structured_json"),false);
 assert.equal(createDeepSeekProvider().isConfigured(),false);
});
