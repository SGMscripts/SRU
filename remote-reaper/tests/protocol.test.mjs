import assert from "node:assert/strict";
import test from "node:test";
import {
  commandHash,
  MAX_SCRIPT_BYTES,
  scriptHash,
  tokenHash,
  validateCommandMessage,
  validatePairMessage,
} from "../protocol.mjs";

const structuredStory = `[AMBIENT: RAIN | START]
[VOICE: speaker=Narrator | type=narration]
Maya heard the signal.
[SFX: PHONE RING]
[AMBIENT: RAIN | END]`;

test("validates and sanitizes the four symbolic remote actions", () => {
  const now = Date.now();
  const command = validateCommandMessage({
    type: "command",
    version: 1,
    requestId: "demo-job-0001",
    machineId: "sruthin-studio",
    action: "story-importer",
    script: structuredStory,
    runtimeMinutes: 3,
    createdAt: now,
    expiresAt: now + 60000,
  }, "sruthin-studio", now);

  assert.equal(command.action, "story-importer");
  assert.equal(command.runtimeMinutes, 3);
  assert.equal(command.script, structuredStory);
  assert.equal(command.scriptSha256, scriptHash(structuredStory));
  assert.equal(command.commandSha256, commandHash("story-importer", 3, structuredStory));
  assert.notEqual(
    command.commandSha256,
    commandHash("build-play", 3, structuredStory),
    "action changes must produce a different idempotency digest",
  );
  assert.throws(() => validateCommandMessage({
    ...command,
    action: "_RS_arbitrary_action",
  }, "sruthin-studio", now), /not allowed/i);
});

test("rejects expired, malformed, and oversized storyboard commands", () => {
  const now = Date.now();
  const base = {
    type: "command",
    version: 1,
    requestId: "demo-job-0002",
    machineId: "sruthin-studio",
    action: "build-play",
    script: structuredStory,
    runtimeMinutes: 3,
    createdAt: now - 120000,
    expiresAt: now - 1000,
  };
  assert.throws(() => validateCommandMessage(base, "sruthin-studio", now), /expired/i);
  assert.throws(() => validateCommandMessage({
    ...base,
    createdAt: now,
    expiresAt: now + 1000,
    script: "plain prose only",
  }, "sruthin-studio", now), /VOICE directions/i);
  assert.throws(() => validateCommandMessage({
    ...base,
    createdAt: now,
    expiresAt: now + 1000,
    script: `${structuredStory}\n${"x".repeat(MAX_SCRIPT_BYTES)}`,
  }, "sruthin-studio", now), /512 KB/i);
});

test("pairing uses a private token hash and never accepts a short token", () => {
  const pair = validatePairMessage({
    type: "pair",
    version: 1,
    role: "companion",
    machineId: "sruthin-studio",
    token: "0123456789abcdef0123456789abcdef",
    reaperOnline: true,
  });
  assert.equal(pair.role, "companion");
  assert.equal(tokenHash(pair.token).length, 64);
  assert.throws(() => validatePairMessage({
    ...pair,
    token: "short",
  }), /16–256/);
});
