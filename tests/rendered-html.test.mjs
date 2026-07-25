import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Story Cue Studio demo controls", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Story Cue Studio<\/title>/i);
  assert.match(html, /3-minute demo/);
  assert.match(html, /7\+ minute storyboard/);
  assert.match(html, /Generate 3-minute demo/);
  assert.match(html, /Original storyboard retained/);
  assert.match(html, /Training Cue Bank · Demo Lock/);
  assert.match(html, /388(?:<!-- -->)? exact SFX/);
  assert.match(html, /78(?:<!-- -->)? exact Ambient/);
  assert.match(html, /maximum one new cue/i);
  assert.match(html, /Music stays on MUSIC POD/);
  assert.match(html, /Send the next step to REAPER/);
});

test("wires runtime selection and the same strict cue-bank policy into local and API generation", async () => {
  const [page, route, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /trainingCueBank:\s*true/);
  assert.match(page, /runtimeMinutes:\s*3/);
  assert.match(page, /runtimeMinutes:\s*settings\.runtimeMinutes/);
  assert.match(page, /chooseRuntime\(7\)/);
  assert.match(page, /enforceTrainingCueBank\(optimized\)/);
  assert.match(page, /enforceTrainingCueBank\(locallyRanged\)/);
  assert.match(page, /Training Cue Bank · Demo Lock/);

  assert.match(route, /settings\.trainingCueBank !== false/);
  assert.match(route, /runtimeProfile\(settings\.runtimeMinutes\)/);
  assert.match(route, /runtimeWordIssue\(words, profile\.minutes\)/);
  assert.match(route, /trainingCueBankInstructions\(\)/);
  assert.match(route, /enforceTrainingCueBank\(script\)/);
  assert.match(route, /cueBank/);

  assert.match(layout, /title:\s*"Story Cue Studio"/);
  assert.match(layout, /REAPER-ready audio drama cue script/);
});
