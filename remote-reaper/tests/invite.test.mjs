import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  copyTextToMacClipboard,
  createEphemeralDemoIdentity,
  createGuestInviteUrl,
  createInvitePayload,
  decodeInvitePayload,
  DEMO_HARD_STOP_MS,
  DEMO_INVITE_ACCEPTANCE_MS,
  extractQuickTunnelUrl,
  MAX_INVITE_TTL_MS,
} from "../invite.mjs";

function deterministicRandomBytes() {
  let value = 1;
  return (length) => Buffer.alloc(length, value++);
}

test("creates fresh base64url demo credentials with the required entropy sizes", () => {
  const identity = createEphemeralDemoIdentity({
    randomBytesImpl: deterministicRandomBytes(),
  });
  assert.match(identity.machineId, /^reaper-demo-[a-f0-9]{16}$/);
  assert.match(identity.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(identity.nonce, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(identity.token, identity.nonce);
  assert.equal(DEMO_INVITE_ACCEPTANCE_MS, 50 * 60 * 1000);
  assert.equal(DEMO_HARD_STOP_MS, 90 * 60 * 1000);
});

test("puts the complete invite only in the URL fragment", () => {
  const issuedAt = 1_800_000_000_000;
  const identity = createEphemeralDemoIdentity({
    randomBytesImpl: deterministicRandomBytes(),
  });
  const invite = createGuestInviteUrl({
    relayUrl: "wss://quiet-signal.trycloudflare.com",
    ...identity,
    issuedAt,
    expiresAt: issuedAt + 50 * 60 * 1000,
  });
  const guestUrl = new URL(invite.url);
  assert.equal(guestUrl.origin, "https://story-cue-studio.sruthin4444.chatgpt.site");
  assert.equal(guestUrl.search, "");
  assert.match(guestUrl.hash, /^#reaper-invite=[A-Za-z0-9_-]+$/);
  assert.equal(guestUrl.searchParams.has("token"), false);

  const encoded = guestUrl.hash.slice("#reaper-invite=".length);
  const decoded = decodeInvitePayload(encoded, { now: issuedAt });
  assert.deepEqual(decoded, {
    version: 1,
    relayUrl: "wss://quiet-signal.trycloudflare.com/",
    machineId: identity.machineId,
    token: identity.token,
    nonce: identity.nonce,
    issuedAt,
    expiresAt: issuedAt + 50 * 60 * 1000,
  });
});

test("rejects unsafe relay locations, malformed secrets, and overlong invites", () => {
  const issuedAt = 1_800_000_000_000;
  const identity = createEphemeralDemoIdentity({
    randomBytesImpl: deterministicRandomBytes(),
  });
  assert.throws(() => createInvitePayload({
    relayUrl: "ws://relay.example.test",
    ...identity,
    issuedAt,
    expiresAt: issuedAt + 60_000,
  }), /wss/i);
  assert.throws(() => createInvitePayload({
    relayUrl: "wss://relay.example.test/?token=leak",
    ...identity,
    issuedAt,
    expiresAt: issuedAt + 60_000,
  }), /query/i);
  assert.throws(() => createInvitePayload({
    relayUrl: "wss://relay.example.test",
    ...identity,
    nonce: "too-short",
    issuedAt,
    expiresAt: issuedAt + 60_000,
  }), /nonce/i);
  assert.throws(() => createInvitePayload({
    relayUrl: "wss://relay.example.test",
    ...identity,
    issuedAt,
    expiresAt: issuedAt + MAX_INVITE_TTL_MS + 1,
  }), /90 minutes/i);
});

test("decoding enforces invite expiry", () => {
  const issuedAt = 1_800_000_000_000;
  const identity = createEphemeralDemoIdentity({
    randomBytesImpl: deterministicRandomBytes(),
  });
  const invite = createGuestInviteUrl({
    relayUrl: "wss://quiet-signal.trycloudflare.com",
    ...identity,
    issuedAt,
    expiresAt: issuedAt + 60_000,
  });
  const encoded = new URL(invite.url).hash.slice("#reaper-invite=".length);
  assert.throws(
    () => decodeInvitePayload(encoded, { now: issuedAt + 60_000 }),
    /expired/i,
  );
});

test("finds a Cloudflare Quick Tunnel URL after split log chunks are combined", () => {
  const log = [
    "INF Your quick Tunnel has been created! Visit it at ",
    "https://quiet-sig",
    "nal.trycloudflare.com\n",
  ].join("");
  assert.equal(
    extractQuickTunnelUrl(log),
    "https://quiet-signal.trycloudflare.com",
  );
});

test("copies the guest link with pbcopy without invoking a shell", async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  let copiedText = "";
  child.stdin.on("data", (chunk) => {
    copiedText += String(chunk);
  });
  const copied = copyTextToMacClipboard("https://example.test/#private", {
    platform: "darwin",
    spawnImpl(command, args, options) {
      assert.equal(command, "/usr/bin/pbcopy");
      assert.deepEqual(args, []);
      assert.deepEqual(options.stdio, ["pipe", "ignore", "ignore"]);
      queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  });
  assert.equal(await copied, true);
  assert.equal(copiedText, "https://example.test/#private");
});
