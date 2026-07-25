import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { validMachineId } from "./protocol.mjs";

export const STORY_CUE_STUDIO_URL =
  "https://story-cue-studio.sruthin4444.chatgpt.site/";
export const INVITE_VERSION = 1;
export const DEMO_INVITE_ACCEPTANCE_MS = 50 * 60 * 1000;
export const DEMO_HARD_STOP_MS = 90 * 60 * 1000;
export const MAX_INVITE_TTL_MS = 90 * 60 * 1000;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function randomBase64Url(byteLength, randomBytesImpl) {
  const bytes = Buffer.from(randomBytesImpl(byteLength));
  if (bytes.length !== byteLength) {
    throw new Error(`Secure random source must return exactly ${byteLength} bytes.`);
  }
  return bytes.toString("base64url");
}

export function createEphemeralDemoIdentity({
  randomBytesImpl = randomBytes,
} = {}) {
  const token = randomBase64Url(32, randomBytesImpl);
  const nonce = randomBase64Url(16, randomBytesImpl);
  const machineSuffix = Buffer.from(randomBytesImpl(8));
  if (machineSuffix.length !== 8) {
    throw new Error("Secure random source must return exactly 8 bytes.");
  }
  const machineId = `reaper-demo-${machineSuffix.toString("hex")}`;
  return { machineId, token, nonce };
}

function normalizedWssRelayUrl(value) {
  let relayUrl;
  try {
    relayUrl = new URL(String(value || ""));
  } catch {
    throw new Error("The invite relay URL is invalid.");
  }
  if (relayUrl.protocol !== "wss:") {
    throw new Error("Guest invites require a wss:// relay URL.");
  }
  if (
    relayUrl.username ||
    relayUrl.password ||
    relayUrl.search ||
    relayUrl.hash
  ) {
    throw new Error("The invite relay URL cannot contain credentials, a query, or a fragment.");
  }
  return relayUrl.toString();
}

function validatedInvitePayload(value, {
  now,
  allowExpired = false,
} = {}) {
  if (!value || Number(value.version) !== INVITE_VERSION) {
    throw new Error("Unsupported REAPER invite version.");
  }
  const relayUrl = normalizedWssRelayUrl(value.relayUrl);
  const machineId = String(value.machineId || "");
  if (!validMachineId(machineId)) {
    throw new Error("Invalid REAPER invite machine ID.");
  }
  const token = String(value.token || "");
  if (
    token.length < 43 ||
    token.length > 256 ||
    !BASE64URL_PATTERN.test(token)
  ) {
    throw new Error("REAPER invite token must be a 32-byte-or-stronger base64url secret.");
  }
  const nonce = String(value.nonce || "");
  if (
    nonce.length < 22 ||
    nonce.length > 128 ||
    !BASE64URL_PATTERN.test(nonce)
  ) {
    throw new Error("REAPER invite nonce is invalid.");
  }
  const issuedAt = Number(value.issuedAt);
  const expiresAt = Number(value.expiresAt);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt <= 0 ||
    expiresAt <= issuedAt
  ) {
    throw new Error("REAPER invite timestamps are invalid.");
  }
  if (expiresAt - issuedAt > MAX_INVITE_TTL_MS) {
    throw new Error("REAPER invites cannot remain valid for more than 90 minutes.");
  }
  if (
    Number.isFinite(now) &&
    !allowExpired &&
    expiresAt <= Number(now)
  ) {
    throw new Error("This REAPER invite has expired.");
  }
  return {
    version: INVITE_VERSION,
    relayUrl,
    machineId,
    token,
    nonce,
    issuedAt,
    expiresAt,
  };
}

export function createInvitePayload({
  relayUrl,
  machineId,
  token,
  nonce,
  issuedAt = Date.now(),
  expiresAt = Number(issuedAt) + DEMO_INVITE_ACCEPTANCE_MS,
} = {}) {
  return validatedInvitePayload({
    version: INVITE_VERSION,
    relayUrl,
    machineId,
    token,
    nonce,
    issuedAt,
    expiresAt,
  });
}

export function encodeInvitePayload(payload) {
  const normalized = validatedInvitePayload(payload, { allowExpired: true });
  return Buffer.from(JSON.stringify(normalized), "utf8").toString("base64url");
}

export function decodeInvitePayload(encoded, {
  now = Date.now(),
  allowExpired = false,
} = {}) {
  const value = String(encoded || "");
  if (!value || !BASE64URL_PATTERN.test(value)) {
    throw new Error("REAPER invite payload is not valid base64url.");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error("REAPER invite payload is invalid.");
  }
  return validatedInvitePayload(parsed, { now, allowExpired });
}

export function createGuestInviteUrl({
  siteUrl = STORY_CUE_STUDIO_URL,
  ...invite
} = {}) {
  let destination;
  try {
    destination = new URL(String(siteUrl || ""));
  } catch {
    throw new Error("Story Cue Studio URL is invalid.");
  }
  if (
    destination.protocol !== "https:" ||
    destination.username ||
    destination.password ||
    destination.search ||
    destination.hash
  ) {
    throw new Error("Story Cue Studio guest links require a clean https:// URL.");
  }
  const payload = createInvitePayload(invite);
  destination.hash = `reaper-invite=${encodeInvitePayload(payload)}`;
  return {
    url: destination.toString(),
    payload,
  };
}

export function extractQuickTunnelUrl(value) {
  const match = String(value || "").match(
    /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i,
  );
  return match ? match[0] : "";
}

export function copyTextToMacClipboard(value, {
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  if (platform !== "darwin") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (copied) => {
      if (settled) return;
      settled = true;
      resolve(copied);
    };
    let child;
    try {
      child = spawnImpl("/usr/bin/pbcopy", [], {
        stdio: ["pipe", "ignore", "ignore"],
      });
    } catch {
      finish(false);
      return;
    }
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
    child.stdin.once("error", () => finish(false));
    child.stdin.end(String(value));
  });
}
