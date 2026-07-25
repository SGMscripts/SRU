import assert from "node:assert/strict";
import test from "node:test";

import { handleVoiceCatalogRequest } from "../app/api/elevenlabs/voices/route.ts";

function request(query = "") {
  return new Request(`https://studio.example/api/elevenlabs/voices${query}`);
}

async function body(response) {
  return response.json();
}

test("returns a graceful 503 without calling ElevenLabs when the server key is missing", async () => {
  let fetchCalls = 0;
  const response = await handleVoiceCatalogRequest(request(), {
    apiKey: "",
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not run");
    },
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await body(response), {
    error: "The ElevenLabs voice catalog is not configured.",
    code: "ELEVENLABS_NOT_CONFIGURED",
  });
  assert.equal(fetchCalls, 0);
});

test("requests default voices by name and returns only safe camelCase catalog fields", async () => {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({
      voices: [
        {
          voice_id: "bbbbbbbbbbbbbbbbbbbb",
          name: "Zara",
          category: "premade",
          description: "Calm narrator",
          labels: { accent: "British", age: 35, constructor: "discard" },
          preview_url: "https://cdn.example/zara.mp3",
          settings: { stability: 0.5 },
          secret_internal_field: "must not escape",
        },
        {
          voice_id: "aaaaaaaaaaaaaaaaaaaa",
          name: "Ari",
          category: "premade",
          description: null,
          labels: { gender: "male" },
          preview_url: "javascript:alert(1)",
        },
      ],
      total_count: 2,
      next_page_token: "private-upstream-token",
    });
  };

  const response = await handleVoiceCatalogRequest(
    request("?search=narrator&page_size=25"),
    { apiKey: "test-server-key", fetchImpl },
  );
  const result = await body(response);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /s-maxage=300/);
  assert.deepEqual(result, {
    voices: [
      {
        voiceId: "aaaaaaaaaaaaaaaaaaaa",
        name: "Ari",
        category: "premade",
        description: null,
        labels: { gender: "male" },
        previewUrl: null,
      },
      {
        voiceId: "bbbbbbbbbbbbbbbbbbbb",
        name: "Zara",
        category: "premade",
        description: "Calm narrator",
        labels: { accent: "British" },
        previewUrl: "https://cdn.example/zara.mp3",
      },
    ],
    source: "elevenlabs",
  });

  assert.equal(calls.length, 1);
  const upstream = new URL(calls[0].url);
  assert.equal(upstream.origin, "https://api.elevenlabs.io");
  assert.equal(upstream.pathname, "/v2/voices");
  assert.equal(upstream.searchParams.get("voice_type"), "default");
  assert.equal(upstream.searchParams.get("page_size"), "25");
  assert.equal(upstream.searchParams.get("sort"), "name");
  assert.equal(upstream.searchParams.get("sort_direction"), "asc");
  assert.equal(upstream.searchParams.get("search"), "narrator");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["xi-api-key"], "test-server-key");
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(result).includes("test-server-key"), false);
});

test("merges metadata only for the explicitly allowlisted current voices", async () => {
  const detailIds = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/v2/voices") {
      return Response.json({
        voices: [{
          voice_id: "defaultdefaultdefaul",
          name: "Default Voice",
          category: "premade",
          labels: {},
          preview_url: "https://cdn.example/default.mp3",
        }],
      });
    }
    const voiceId = decodeURIComponent(url.pathname.split("/").at(-1));
    detailIds.push(voiceId);
    return Response.json({
      voice_id: voiceId,
      name: voiceId === "cPoqAvGWCPfCfyPMwe4z" ? "Current One" : "Current Two",
      category: "professional",
      description: "Current project voice",
      labels: { accent: "Indian" },
      preview_url: `https://cdn.example/${voiceId}.mp3`,
      settings: { must: "not leak" },
    });
  };

  const response = await handleVoiceCatalogRequest(
    request("?voice_ids=cPoqAvGWCPfCfyPMwe4z,si0svtk05vPEuvwAW93c"),
    { apiKey: "test-server-key", fetchImpl },
  );
  const result = await body(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, max-age=60");
  assert.deepEqual(detailIds.sort(), ["cPoqAvGWCPfCfyPMwe4z", "si0svtk05vPEuvwAW93c"]);
  assert.equal(result.voices.length, 3);
  assert.deepEqual(
    result.voices.map((voice) => voice.name),
    ["Current One", "Current Two", "Default Voice"],
  );
  assert.equal(JSON.stringify(result).includes("settings"), false);
});

test("does not refetch an explicitly requested voice already present in the list", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json({
      voices: [{
        voice_id: "cPoqAvGWCPfCfyPMwe4z",
        name: "Already Listed",
        category: "premade",
        labels: {},
        preview_url: null,
      }],
    });
  };
  const response = await handleVoiceCatalogRequest(
    request("?voice_ids=cPoqAvGWCPfCfyPMwe4z"),
    { apiKey: "test-server-key", fetchImpl },
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test("strictly rejects unsupported, oversized, duplicated, or excessive query values", async (t) => {
  const invalidQueries = [
    "?page_size=101",
    "?page_size=2.5",
    "?search=a&search=b",
    "?unknown=true",
    "?voice_ids=short",
    "?voice_ids=cPoqAvGWCPfCfyPMwe4z,cPoqAvGWCPfCfyPMwe4z",
    "?voice_ids=cPoqAvGWCPfCfyPMwe4z,si0svtk05vPEuvwAW93c,aaaaaaaaaaaaaaaaaaaa",
    "?voice_ids=aaaaaaaaaaaaaaaaaaaa",
  ];

  for (const query of invalidQueries) {
    await t.test(query, async () => {
      let called = false;
      const response = await handleVoiceCatalogRequest(request(query), {
        apiKey: "test-server-key",
        fetchImpl: async () => {
          called = true;
          throw new Error("must not run");
        },
      });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await body(response)).code, "INVALID_QUERY");
      assert.equal(called, false);
    });
  }
});

test("sanitizes upstream errors without returning the API key or provider response", async () => {
  const response = await handleVoiceCatalogRequest(request(), {
    apiKey: "sk-test-must-never-escape",
    fetchImpl: async () => new Response(
      "provider diagnostics containing sk-test-must-never-escape",
      { status: 401 },
    ),
  });
  const serialized = JSON.stringify(await body(response));

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(serialized.includes("sk-test-must-never-escape"), false);
  assert.equal(serialized.includes("provider diagnostics"), false);
});

test("aborts a slow provider request and returns a no-store timeout response", async () => {
  const fetchImpl = async (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });

  const response = await handleVoiceCatalogRequest(request(), {
    apiKey: "test-server-key",
    fetchImpl,
    timeoutMs: 100,
  });

  assert.equal(response.status, 504);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await body(response), {
    error: "The ElevenLabs voice catalog took too long to respond.",
    code: "ELEVENLABS_TIMEOUT",
  });
});
