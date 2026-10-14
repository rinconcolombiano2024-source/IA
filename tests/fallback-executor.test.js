"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isFallbackSafeIntent,
  isFallbackEligibleError,
  executeWithFallback
} = require("../src/core/fallback-executor");

function selection(provider, id) {
  return { provider, id };
}

function providerFor(model) {
  return { id:model.provider };
}

test("fallback is enabled only for retry-safe current intents", () => {
  for (const intent of ["text","document","restaurant","book","code","website","repair"]) {
    assert.equal(isFallbackSafeIntent(intent), true, intent);
  }

  assert.equal(isFallbackSafeIntent("image"), false);
  assert.equal(isFallbackSafeIntent("video"), false);
});

test("provider transport failures are eligible but local/client failures are not", () => {
  assert.equal(isFallbackEligibleError({code:"PROVIDER_NETWORK_ERROR"}), true);
  assert.equal(isFallbackEligibleError({code:"UPSTREAM_TIMEOUT"}), true);
  assert.equal(
    isFallbackEligibleError({code:"PROVIDER_HTTP_ERROR",providerStatus:503}),
    true
  );
  assert.equal(
    isFallbackEligibleError({code:"PROVIDER_HTTP_ERROR",providerStatus:429}),
    true
  );
  assert.equal(
    isFallbackEligibleError({code:"PROVIDER_HTTP_ERROR",providerStatus:400}),
    false
  );
  assert.equal(
    isFallbackEligibleError({code:"REQUEST_DEADLINE_EXCEEDED"}),
    false
  );
  assert.equal(
    isFallbackEligibleError({code:"PROVIDER_NETWORK_ERROR",isClientRequestError:true}),
    false
  );
  assert.equal(isFallbackEligibleError(new Error("local bug")), false);
});

test("safe text execution advances from primary to fallback", async () => {
  const plan = {
    primary:selection("a","m1"),
    fallback:selection("b","m2"),
    secondFallback:selection("c","m3")
  };

  const executed = [];
  const output = await executeWithFallback({
    plan,
    intent:"text",
    providerFor,
    execute:async ({provider,selection:chosen}) => {
      executed.push(provider.id + ":" + chosen.id);
      if (provider.id === "a") {
        const error = new Error("temporary");
        error.code = "PROVIDER_HTTP_ERROR";
        error.providerStatus = 503;
        throw error;
      }
      return {text:"ok"};
    }
  });

  assert.deepEqual(executed,["a:m1","b:m2"]);
  assert.equal(output.fallbackUsed,true);
  assert.equal(output.selection.provider,"b");
  assert.equal(output.result.text,"ok");
  assert.deepEqual(output.attempts.map((item) => item.status),["failed","ok"]);
});

test("image and video never auto-fallback after provider failure", async () => {
  for (const intent of ["image","video"]) {
    const plan = {
      primary:selection("a","m1"),
      fallback:selection("b","m2"),
      secondFallback:null
    };
    let calls = 0;

    await assert.rejects(
      executeWithFallback({
        plan,
        intent,
        providerFor,
        execute:async () => {
          calls += 1;
          const error = new Error("temporary");
          error.code = "PROVIDER_NETWORK_ERROR";
          throw error;
        }
      }),
      (error) => error.code === "PROVIDER_NETWORK_ERROR"
    );

    assert.equal(calls,1,intent);
  }
});

test("400 provider errors do not fall through to another model", async () => {
  const plan = {
    primary:selection("a","m1"),
    fallback:selection("b","m2"),
    secondFallback:null
  };
  let calls = 0;

  await assert.rejects(
    executeWithFallback({
      plan,
      intent:"text",
      providerFor,
      execute:async () => {
        calls += 1;
        const error = new Error("bad request");
        error.code = "PROVIDER_HTTP_ERROR";
        error.providerStatus = 400;
        throw error;
      }
    }),
    (error) => error.providerStatus === 400
  );

  assert.equal(calls,1);
});

test("global deadline prevents another fallback attempt", async () => {
  const plan = {
    primary:selection("a","m1"),
    fallback:selection("b","m2"),
    secondFallback:null
  };
  let calls = 0;

  await assert.rejects(
    executeWithFallback({
      plan,
      intent:"text",
      providerFor,
      deadline:{usableMs:()=>500},
      execute:async () => {
        calls += 1;
        const error = new Error("temporary");
        error.code = "PROVIDER_NETWORK_ERROR";
        throw error;
      }
    }),
    (error) => error.code === "PROVIDER_NETWORK_ERROR"
  );

  assert.equal(calls,1);
});
