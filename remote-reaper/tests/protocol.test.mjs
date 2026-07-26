import assert from "node:assert/strict";
import test from "node:test";
import {
  commandHash,
  MAX_INVITE_ACCEPT_WINDOW_MS,
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

test("validates and sanitizes the allowlisted remote actions", () => {
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

test("allows the one-click Create sequence only with a structured storyboard", () => {
  const now = Date.now();
  const command = validateCommandMessage({
    type: "command",
    version: 1,
    requestId: "create-job-0001",
    machineId: "sruthin-studio",
    action: "create",
    script: structuredStory,
    runtimeMinutes: 3,
    createdAt: now,
    expiresAt: now + 60000,
  }, "sruthin-studio", now);
  assert.equal(command.action, "create");
  assert.equal(command.script, structuredStory);
  assert.throws(() => validateCommandMessage({
    ...command,
    requestId: "create-job-0002",
    script: "",
  }, "sruthin-studio", now), /Generate a storyboard/i);
});

test("allows only bounded numeric edit-cursor positions", () => {
  const now = Date.now();
  const command = validateCommandMessage({
    type: "command",
    version: 1,
    requestId: "transport-job-0001",
    machineId: "sruthin-studio",
    action: "transport-seek",
    script: "",
    runtimeMinutes: 3,
    cursorSeconds: 42.1256,
    createdAt: now,
    expiresAt: now + 60000,
  }, "sruthin-studio", now);
  assert.equal(command.cursorSeconds, 42.126);
  assert.equal(command.commandSha256, commandHash("transport-seek", 3, "", 42.126));
  assert.throws(() => validateCommandMessage({
    ...command,
    requestId: "transport-job-0002",
    cursorSeconds: -1,
  }, "sruthin-studio", now), /Cursor position/i);
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
  const now = 1_800_000_000_000;
  const pair = validatePairMessage({
    type: "pair",
    version: 1,
    role: "companion",
    machineId: "sruthin-studio",
    token: "0123456789abcdef0123456789abcdef",
    reaperOnline: true,
  }, now);
  assert.equal(pair.role, "companion");
  assert.equal(pair.inviteAcceptUntil, 0);
  assert.equal(tokenHash(pair.token).length, 64);
  assert.throws(() => validatePairMessage({
    ...pair,
    token: "short",
  }), /16–256/);
});

test("only companions can set a bounded future invite acceptance deadline", () => {
  const now = 1_800_000_000_000;
  const base = {
    type: "pair",
    version: 1,
    role: "companion",
    machineId: "reaper-demo-0011223344556677",
    token: "0123456789abcdef0123456789abcdef01234567890",
    inviteAcceptUntil: now + 50 * 60 * 1000,
  };
  const pair = validatePairMessage(base, now);
  assert.equal(pair.inviteAcceptUntil, base.inviteAcceptUntil);
  assert.throws(
    () => validatePairMessage({ ...base, inviteAcceptUntil: now }, now),
    /expired/i,
  );
  assert.throws(
    () => validatePairMessage({
      ...base,
      inviteAcceptUntil: now + MAX_INVITE_ACCEPT_WINDOW_MS + 1,
    }, now),
    /90 minutes/i,
  );
  assert.throws(
    () => validatePairMessage({ ...base, role: "controller" }, now),
    /only the Mac companion/i,
  );
});
