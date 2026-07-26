import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const JOURNAL_VERSION = 1;
const MAX_COMPLETED_BUILD_DIGESTS = 200;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function usesPaidVoiceGeneration(action) {
  return action === "create" || action === "build-play";
}

function timestamp(value) {
  return new Date(Number(value)).toISOString();
}

function initialState(now) {
  return {
    version: JOURNAL_VERSION,
    updatedAt: timestamp(now),
    safety: {
      state: "idle",
    },
    lastCompleted: null,
    completedBuilds: [],
    repeatBuildOverride: null,
  };
}

function sanitizedIdentity(command) {
  return {
    requestId: String(command.requestId),
    action: String(command.action),
    scriptDigest: String(command.scriptSha256),
    runtimeMinutes: Number(command.runtimeMinutes) === 7 ? 7 : 3,
  };
}

function validateDigest(value) {
  const digest = String(value || "").toLowerCase();
  if (!DIGEST_PATTERN.test(digest)) throw new Error("Remote command is missing a valid script digest.");
  return digest;
}

function validateLoadedState(value) {
  if (!value || Number(value.version) !== JOURNAL_VERSION || typeof value !== "object") {
    throw new Error("The companion safety journal has an unsupported format.");
  }
  const safetyState = String(value.safety?.state || "");
  if (!["idle", "running", "needs_attention"].includes(safetyState)) {
    throw new Error("The companion safety journal contains an invalid safety state.");
  }
  const completedBuilds = Array.isArray(value.completedBuilds)
    ? value.completedBuilds.flatMap((entry) => {
      const digest = String(entry?.scriptDigest || "").toLowerCase();
      if (!DIGEST_PATTERN.test(digest)) return [];
      return [{
        scriptDigest: digest,
        requestId: String(entry?.requestId || "").slice(0, 128),
        completedAt: String(entry?.completedAt || ""),
      }];
    }).slice(-MAX_COMPLETED_BUILD_DIGESTS)
    : [];
  return {
    version: JOURNAL_VERSION,
    updatedAt: String(value.updatedAt || ""),
    safety: safetyState === "idle"
      ? { state: "idle" }
      : {
        state: safetyState,
        requestId: String(value.safety?.requestId || "").slice(0, 128),
        action: String(value.safety?.action || "").slice(0, 40),
        scriptDigest: validateDigest(value.safety?.scriptDigest),
        runtimeMinutes: Number(value.safety?.runtimeMinutes) === 7 ? 7 : 3,
        startedAt: String(value.safety?.startedAt || ""),
        interruptedAt: String(value.safety?.interruptedAt || ""),
      },
    lastCompleted: value.lastCompleted && typeof value.lastCompleted === "object"
      ? {
        requestId: String(value.lastCompleted.requestId || "").slice(0, 128),
        action: String(value.lastCompleted.action || "").slice(0, 40),
        scriptDigest: validateDigest(value.lastCompleted.scriptDigest),
        runtimeMinutes: Number(value.lastCompleted.runtimeMinutes) === 7 ? 7 : 3,
        completedAt: String(value.lastCompleted.completedAt || ""),
      }
      : null,
    completedBuilds,
    repeatBuildOverride: value.repeatBuildOverride && typeof value.repeatBuildOverride === "object"
      ? { armedAt: String(value.repeatBuildOverride.armedAt || "") }
      : null,
  };
}

export function defaultJournalPath({
  platform = process.platform,
  homeDirectory = os.homedir(),
} = {}) {
  if (platform === "darwin") {
    return path.join(
      homeDirectory,
      "Library",
      "Application Support",
      "Story Cue Studio",
      "remote-companion-journal.json",
    );
  }
  return path.join(homeDirectory, ".story-cue-studio", "remote-companion-journal.json");
}

export class SafetyLockError extends Error {
  constructor(message) {
    super(message);
    this.name = "SafetyLockError";
  }
}

export class DuplicatePaidBuildError extends Error {
  constructor(message) {
    super(message);
    this.name = "DuplicatePaidBuildError";
  }
}

export class FileJobJournal {
  constructor({
    filePath = defaultJournalPath(),
    now = () => Date.now(),
  } = {}) {
    this.filePath = path.resolve(String(filePath));
    this.now = now;
    this.operation = Promise.resolve();
    this.initialized = false;
  }

  serialize(operation) {
    const result = this.operation.then(operation, operation);
    this.operation = result.catch(() => {});
    return result;
  }

  async readUnlocked() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return validateLoadedState(JSON.parse(raw));
    } catch (error) {
      if (error?.code === "ENOENT") return initialState(this.now());
      if (error instanceof SyntaxError) {
        throw new Error(`The companion safety journal is damaged: ${this.filePath}`);
      }
      throw error;
    }
  }

  async writeUnlocked(state) {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = path.join(
      directory,
      `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    const body = `${JSON.stringify({
      ...state,
      version: JOURNAL_VERSION,
      updatedAt: timestamp(this.now()),
    }, null, 2)}\n`;
    let temporaryFile;
    try {
      temporaryFile = await open(temporaryPath, "wx", 0o600);
      await temporaryFile.writeFile(body, "utf8");
      await temporaryFile.sync();
      await temporaryFile.close();
      temporaryFile = null;
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
      const directoryHandle = await open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      if (temporaryFile) await temporaryFile.close().catch(() => {});
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  async initialize({ recoverInterrupted = true } = {}) {
    return this.serialize(async () => {
      const state = await this.readUnlocked();
      if (recoverInterrupted && state.safety.state === "running") {
        state.safety = {
          ...state.safety,
          state: "needs_attention",
          interruptedAt: timestamp(this.now()),
        };
      }
      await this.writeUnlocked(state);
      this.initialized = true;
      return structuredClone(state);
    });
  }

  async status() {
    return this.serialize(async () => structuredClone(await this.readUnlocked()));
  }

  async readiness() {
    return this.serialize(async () => {
      const state = await this.readUnlocked();
      if (state.safety.state === "idle") {
        return { ready: true, state: "idle", message: "Companion safety journal is clear." };
      }
      const action = state.safety.action || "remote";
      const message = state.safety.state === "running"
        ? `A ${action} job is still marked running. Stop and inspect REAPER before clearing the safety lock locally.`
        : `A previous ${action} job needs attention. Inspect REAPER, then run the local clear-safety-lock command.`;
      return {
        ready: false,
        state: state.safety.state,
        requestId: state.safety.requestId || "",
        message,
      };
    });
  }

  async begin(command) {
    return this.serialize(async () => {
      const state = await this.readUnlocked();
      if (state.safety.state !== "idle") {
        throw new SafetyLockError(
          "The companion safety journal is locked. Inspect REAPER and clear the lock locally before sending another job.",
        );
      }
      const identity = sanitizedIdentity(command);
      identity.scriptDigest = validateDigest(identity.scriptDigest);
      if (usesPaidVoiceGeneration(identity.action)) {
        const duplicate = state.completedBuilds.some(
          (entry) => entry.scriptDigest === identity.scriptDigest,
        );
        const overrideArmed = Boolean(state.repeatBuildOverride);
        if (duplicate && !overrideArmed) {
          throw new DuplicatePaidBuildError(
            "This exact storyboard already completed a paid voice-generation job. Arm a one-time local repeat override before generating it again.",
          );
        }
        // A local override is one-shot and is consumed by the next build request,
        // whether or not that request ultimately needed the duplicate exception.
        if (overrideArmed) state.repeatBuildOverride = null;
      }
      state.safety = {
        state: "running",
        ...identity,
        startedAt: timestamp(this.now()),
      };
      await this.writeUnlocked(state);
      return structuredClone(state.safety);
    });
  }

  async complete(command) {
    return this.serialize(async () => {
      const state = await this.readUnlocked();
      const identity = sanitizedIdentity(command);
      identity.scriptDigest = validateDigest(identity.scriptDigest);
      if (
        state.safety.state !== "running" ||
        state.safety.requestId !== identity.requestId ||
        state.safety.scriptDigest !== identity.scriptDigest
      ) {
        throw new SafetyLockError(
          "The safety journal no longer matches the running REAPER job. Completion was not recorded.",
        );
      }
      const completedAt = timestamp(this.now());
      state.lastCompleted = { ...identity, completedAt };
      if (usesPaidVoiceGeneration(identity.action)) {
        state.completedBuilds = state.completedBuilds
          .filter((entry) => entry.scriptDigest !== identity.scriptDigest);
        state.completedBuilds.push({
          scriptDigest: identity.scriptDigest,
          requestId: identity.requestId,
          completedAt,
        });
        state.completedBuilds = state.completedBuilds.slice(-MAX_COMPLETED_BUILD_DIGESTS);
      }
      state.safety = { state: "idle" };
      await this.writeUnlocked(state);
      return structuredClone(state.lastCompleted);
    });
  }

  async needsAttention(command) {
    return this.serialize(async () => {
      const state = await this.readUnlocked();
      const identity = sanitizedIdentity(command);
      identity.scriptDigest = validateDigest(identity.scriptDigest);
      state.safety = {
        state: "needs_attention",
        ...identity,
        startedAt: state.safety.requestId === identity.requestId
          ? state.safety.startedAt
          : timestamp(this.now()),
        interruptedAt: timestamp(this.now()),
      };
      await this.writeUnlocked(state);
      return structuredClone(state.safety);
    });
  }

  async clearSafetyLock() {
    return this.serialize(async () => {
      const state = await this.readUnlocked();
      state.safety = { state: "idle" };
      await this.writeUnlocked(state);
      return structuredClone(state);
    });
  }

  async armRepeatBuildOverride() {
    return this.serialize(async () => {
      const state = await this.readUnlocked();
      state.repeatBuildOverride = { armedAt: timestamp(this.now()) };
      await this.writeUnlocked(state);
      return structuredClone(state.repeatBuildOverride);
    });
  }
}
