import assert from "node:assert/strict";
import test from "node:test";
import {
  ELEVEN_ACTION,
  encodeStoryChunks,
  formatReaperTimecode,
  IMPORT_ACTION,
  RECALL_ACTION,
  ReaperWebControl,
} from "../reaper-web-control.mjs";

test("UTF-8 storyboard chunks round-trip without changing text", () => {
  const script = `[VOICE: speaker=Narrator]\nMaya whispered “don’t open it” — മഴ.\n[SFX: PHONE RING]`;
  const chunks = encodeStoryChunks(script.repeat(80));
  const decoded = Buffer.from(chunks.join(""), "base64url").toString("utf8");
  assert.equal(decoded, script.repeat(80));
  assert.ok(chunks.every((chunk) => chunk.length <= 1800));
});

test("uploads the complete inbox and writes InboxReady last", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return new Response("", { status: 200 });
  };
  const reaper = new ReaperWebControl({ fetchImpl });
  const script = `[VOICE: speaker=Narrator]\nMaya listened.\n[SFX: PHONE RING]`;
  await reaper.uploadStory(script, "import", 3, "demo-job-0003");

  const decodedCalls = calls.map((url) => decodeURIComponent(url));
  assert.match(decodedCalls[0], /InboxReady\/;/);
  assert.ok(decodedCalls.some((url) => /InboxCount\/1;/.test(url)));
  assert.ok(decodedCalls.some((url) => /RequestedRuntimeMinutes\/3;/.test(url)));
  assert.match(decodedCalls.at(-2), /ImportStatus\/queued;/);
  assert.match(decodedCalls.at(-1), /InboxReady\/demo-job-0003;/);
});

test("readiness protects unmarked or playing REAPER projects", async () => {
  const state = new Map([
    ["ProjectRole", "story_target"],
    ["RemoteTargetId", "target-1"],
  ]);
  let playState = 1;
  const fetchImpl = async (url) => {
    const decoded = decodeURIComponent(String(url));
    if (decoded.includes("/_/TRANSPORT;")) {
      return new Response(`TRANSPORT\t${playState}\t42.0\t0\t00:00:42:00\n`, { status: 200 });
    }
    const match = decoded.match(/GET\/PROJEXTSTATE\/StoryCueStudio\/([^;]+);/);
    const key = match?.[1] || "";
    return new Response(`PROJEXTSTATE\tStoryCueStudio\t${key}\t${state.get(key) || ""}\n`, { status: 200 });
  };
  const reaper = new ReaperWebControl({ fetchImpl });
  assert.match((await reaper.readiness()).message, /Stop REAPER playback/i);
  playState = 0;
  assert.equal((await reaper.readiness()).reaperOnline, true);
  state.set("ProjectRole", "");
  assert.match((await reaper.readiness()).message, /dedicated story project/i);
});

test("formats seek clipboard values as 25 fps HH:MM:SS:FF timecode", () => {
  assert.equal(formatReaperTimecode(0), "00:00:00:00");
  assert.equal(formatReaperTimecode(42.1256), "00:00:42:03");
  assert.equal(formatReaperTimecode(3661.96), "01:01:01:24");
});

test("remote Create imports, waits two seconds, recalls cues, waits two seconds, then generates voices", async () => {
  const calls = [];
  const delays = [];
  const requestId = "create-sequence-0001";
  const fetchImpl = async (url) => {
    const decoded = decodeURIComponent(String(url));
    calls.push(decoded);
    if (decoded.includes("/_/TRANSPORT;")) {
      return new Response("TRANSPORT\t0\t0.0\t0\t00:00:00:00\n", { status: 200 });
    }
    const match = decoded.match(/GET\/PROJEXTSTATE\/StoryCueStudio\/([^;]+);/);
    if (match) {
      const key = match[1];
      const values = {
        ProjectRole: "story_target",
        RemoteTargetId: "target-create-1",
        ImportStatus: "complete",
        ImportToken: requestId,
      };
      return new Response(`PROJEXTSTATE\tStoryCueStudio\t${key}\t${values[key] || ""}\n`, { status: 200 });
    }
    return new Response("", { status: 200 });
  };
  const statuses = [];
  const reaper = new ReaperWebControl({
    fetchImpl,
    sleepImpl: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });
  await reaper.runJob({
    action: "create",
    requestId,
    runtimeMinutes: 3,
    script: "[VOICE: speaker=Narrator]\nMaya listened.\n[SFX: PHONE RING]",
  }, {
    allowPaidVoiceGeneration: true,
    onStatus(status) {
      statuses.push(status);
    },
  });

  const actionCalls = calls.filter((url) =>
    url.includes(IMPORT_ACTION) || url.includes(RECALL_ACTION) || url.includes(ELEVEN_ACTION),
  );
  assert.equal(actionCalls.length, 3);
  assert.ok(actionCalls[0].includes(IMPORT_ACTION));
  assert.ok(actionCalls[1].includes(RECALL_ACTION));
  assert.ok(actionCalls[2].includes(ELEVEN_ACTION));
  assert.deepEqual(delays.filter((milliseconds) => milliseconds === 2000), [2000, 2000]);
  assert.deepEqual(
    statuses.filter((status) => !status.done).map((status) => status.stage),
    ["importing", "cue-recall", "voices"],
  );
  assert.equal(statuses.at(-1).state, "complete");
});
