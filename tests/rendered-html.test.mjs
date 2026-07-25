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
  assert.match(html, /Local \/ Wi-Fi/);
  assert.match(html, /Internet Relay/);
  assert.match(html, /Node companion · different networks/);
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
  assert.match(page, /REMOTE_REAPER_STORAGE_KEY/);
  assert.match(page, /Internet relay URLs must begin with wss:\/\//);
  assert.match(page, /role:\s*"controller"/);
  assert.match(page, /type:\s*"command"/);
  assert.match(page, /action:\s*action\.id/);
  assert.match(page, /cancelPendingRemoteCommand/);
  assert.match(page, /remoteCompletionTimerRef/);
  assert.match(page, /suppressReconnect/);
  assert.match(page, /REMOTE_PENDING_STORAGE_KEY/);
  assert.match(page, /sessionStorage\.setItem/);
  assert.match(page, /type:\s*"status_query"/);
  assert.match(page, /story-cue-reaper-remote\.zip/);
  assert.ok(
    page.indexOf('if (window.parent !== window)') < page.indexOf('if (reaperMode === "remote")'),
    "the existing embedded REAPER bridge must keep priority over remote mode",
  );

  assert.match(route, /settings\.trainingCueBank !== false/);
  assert.match(route, /runtimeProfile\(settings\.runtimeMinutes\)/);
  assert.match(route, /runtimeWordIssue\(words, profile\.minutes\)/);
  assert.match(route, /trainingCueBankInstructions\(\)/);
  assert.match(route, /enforceTrainingCueBank\(script\)/);
  assert.match(route, /cueBank/);

  assert.match(layout, /title:\s*"Story Cue Studio"/);
  assert.match(layout, /REAPER-ready audio drama cue script/);
});
