"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createOpenAIProvider } = require("../src/providers/openai/provider");

test("OpenAI adapter translates canonical text requests into Responses payloads", () => {
  const provider = createOpenAIProvider({
    env:{
      OPENAI_API_KEY:"sk-test",
      OPENAI_REASONING_EFFORT:"high"
    }
  });

  const request = provider.buildTextRequest({
    model:"text-model",
    purpose:"general",
    instructions:"system instructions",
    input:"hello"
  });

  assert.equal(request.endpointName,"responses");
  assert.deepEqual(request.payload,{
    model:"text-model",
    reasoning:{effort:"high"},
    instructions:"system instructions",
    input:"hello"
  });
});

test("router purpose uses provider-specific router reasoning setting", () => {
  const provider = createOpenAIProvider({
    env:{
      OPENAI_API_KEY:"sk-test",
      OPENAI_REASONING_EFFORT:"high",
      OPENAI_ROUTER_REASONING:"low"
    }
  });

  const request = provider.buildTextRequest({
    model:"text-model",
    purpose:"router",
    instructions:"classify",
    input:"hello"
  });

  assert.equal(request.payload.reasoning.effort,"low");
});

test("structured canonical requests keep JSON schema details inside adapter", () => {
  const provider = createOpenAIProvider({env:{OPENAI_API_KEY:"sk-test"}});
  const schema={
    type:"object",
    additionalProperties:false,
    properties:{answer:{type:"string"}},
    required:["answer"]
  };

  const request=provider.buildStructuredRequest({
    model:"text-model",
    purpose:"code",
    instructions:"return json",
    input:"build",
    schemaName:"project_files",
    schema
  });

  assert.equal(request.endpointName,"responses");
  assert.equal(request.payload.text.format.type,"json_schema");
  assert.equal(request.payload.text.format.name,"project_files");
  assert.equal(request.payload.text.format.strict,true);
  assert.deepEqual(request.payload.text.format.schema,schema);
});

test("structured schema names are validated", () => {
  const provider = createOpenAIProvider({env:{OPENAI_API_KEY:"sk-test"}});
  assert.throws(() => provider.buildStructuredRequest({
    model:"text-model",
    schemaName:"bad name with spaces",
    schema:{type:"object"}
  }));
});

test("OpenAI response text extraction is encapsulated in adapter", () => {
  const provider = createOpenAIProvider({env:{OPENAI_API_KEY:"sk-test"}});

  assert.equal(provider.extractText({output_text:"  hello  "}),"hello");
  assert.equal(provider.extractText({
    output:[
      {content:[
        {text:"one"},
        {output_text:"two"}
      ]}
    ]
  }),"one\ntwo");
  assert.equal(provider.extractText({}),"");
});
