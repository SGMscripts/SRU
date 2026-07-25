import { createHash } from "node:crypto";

export const PROTOCOL_VERSION = 1;
export const MAX_SCRIPT_BYTES = 512 * 1024;
export const MAX_SOCKET_PAYLOAD_BYTES = 600 * 1024;
export const ALLOWED_ACTIONS = new Set([
  "story-importer",
  "cue-recall",
  "elevenlabs",
  "build-play",
]);

export function tokenHash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function scriptHash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function commandHash(action, runtimeMinutes, script) {
  return createHash("sha256")
    .update(JSON.stringify([String(action), Number(runtimeMinutes), String(script)]), "utf8")
    .digest("hex");
}

export function validMachineId(value) {
  return /^[a-z0-9][a-z0-9_-]{2,63}$/i.test(String(value || ""));
}

export function parseJsonMessage(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    throw new Error("Message must be valid JSON.");
  }
}

export function validatePairMessage(value) {
  if (!value || value.type !== "pair" || Number(value.version) !== PROTOCOL_VERSION) {
    throw new Error("Unsupported pairing message.");
  }
  if (value.role !== "controller" && value.role !== "companion") {
    throw new Error("Pairing role must be controller or companion.");
  }
  if (!validMachineId(value.machineId)) {
    throw new Error("Invalid REAPER machine ID.");
  }
  const token = String(value.token || "");
  if (token.length < 16 || token.length > 256) {
    throw new Error("Pairing token must contain 16–256 characters.");
  }
  return {
    type: "pair",
    version: PROTOCOL_VERSION,
    role: value.role,
    machineId: String(value.machineId),
    token,
    reaperOnline: Boolean(value.reaperOnline),
    readinessMessage: String(value.readinessMessage || "").slice(0, 500),
  };
}

export function validateCommandMessage(value, expectedMachineId, now = Date.now()) {
  if (!value || value.type !== "command" || Number(value.version) !== PROTOCOL_VERSION) {
    throw new Error("Unsupported command message.");
  }
  const requestId = String(value.requestId || "");
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(requestId)) {
    throw new Error("Invalid command request ID.");
  }
  if (String(value.machineId || "") !== expectedMachineId) {
    throw new Error("Command targets a different REAPER machine.");
  }
  const action = String(value.action || "");
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new Error("This remote REAPER action is not allowed.");
  }
  const runtimeMinutes = Number(value.runtimeMinutes) === 7 ? 7 : 3;
  const createdAt = Number(value.createdAt) || now;
  const expiresAt = Number(value.expiresAt) || createdAt + 5 * 60 * 1000;
  if (expiresAt < now) throw new Error("This remote command has expired.");
  if (expiresAt - createdAt > 10 * 60 * 1000) {
    throw new Error("Remote commands cannot remain valid for more than ten minutes.");
  }
  const script = String(value.script || "");
  if (Buffer.byteLength(script, "utf8") > MAX_SCRIPT_BYTES) {
    throw new Error("Storyboard exceeds the 512 KB remote limit.");
  }
  if ((action === "story-importer" || action === "build-play") && !script.trim()) {
    throw new Error("Generate a storyboard before importing it.");
  }
  if (
    script &&
    (!/\[VOICE:/i.test(script) || !/\[(?:SFX|AMBIENT|MUSIC):/i.test(script))
  ) {
    throw new Error("Storyboard must contain VOICE directions and at least one production cue.");
  }
  return {
    type: "command",
    version: PROTOCOL_VERSION,
    requestId,
    machineId: expectedMachineId,
    action,
    script,
    scriptSha256: scriptHash(script),
    commandSha256: commandHash(action, runtimeMinutes, script),
    runtimeMinutes,
    createdAt,
    expiresAt,
  };
}

export function sanitizeCommandStatus(value, machineId) {
  const requestId = String(value?.requestId || "");
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(requestId)) {
    throw new Error("Invalid command status request ID.");
  }
  const state = ["accepted", "progress", "complete", "error", "needs_attention"].includes(value?.state)
    ? value.state
    : "progress";
  return {
    type: "command_status",
    version: PROTOCOL_VERSION,
    machineId,
    requestId,
    state,
    stage: String(value?.stage || "").slice(0, 80),
    message: String(value?.message || "").slice(0, 1000),
    done: Boolean(value?.done || state === "complete" || state === "error" || state === "needs_attention"),
    error: Boolean(value?.error || state === "error" || state === "needs_attention"),
    actualDurationSeconds: Math.max(0, Number(value?.actualDurationSeconds) || 0),
    seq: Math.max(0, Math.floor(Number(value?.seq) || 0)),
  };
}
