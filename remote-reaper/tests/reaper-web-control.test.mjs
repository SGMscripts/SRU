import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeStoryChunks,
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

test("moves the edit cursor with the Web Control SET/POS command", async () => {
  const calls = [];
  const reaper = new ReaperWebControl({
    fetchImpl: async (url) => {
      calls.push(decodeURIComponent(String(url)));
      return new Response("", { status: 200 });
    },
  });
  const position = await reaper.setEditCursor(42.1256);
  assert.equal(position, 42.1256);
  assert.match(calls[0], /SET\/POS\/42\.126;/);
});
