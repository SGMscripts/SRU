import assert from "node:assert/strict";
import test from "node:test";
import { createCompanion } from "../companion.mjs";
import { scriptHash } from "../protocol.mjs";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  send(value) {
    this.sent.push(JSON.parse(String(value)));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close");
  }
}

function command({
  requestId = "companion-job-0001",
  action = "story-importer",
  script = "[VOICE: speaker=Narrator]\nMaya listened.\n[SFX: PHONE RING]",
} = {}) {
  return {
    type: "command",
    version: 1,
    requestId,
    machineId: "sruthin-studio",
    action,
    script,
    scriptSha256: scriptHash(script),
    runtimeMinutes: 3,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

async function waitForMessage(socket, predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const message = socket.sent.find(predicate);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for companion message.");
}

async function withFakeWebSocket(run) {
  const previous = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  try {
    await run();
  } finally {
    globalThis.WebSocket = previous;
  }
}

test("writes the running checkpoint before REAPER mutation and completion afterward", async () => {
  await withFakeWebSocket(async () => {
    const events = [];
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() { events.push("journal:initialize"); },
      async readiness() { return { ready: true, message: "clear" }; },
      async begin() { events.push("journal:begin"); },
      async complete() { events.push("journal:complete"); },
      async needsAttention() { events.push("journal:needs-attention"); },
    };
    const reaper = {
      async readiness() {
        events.push("reaper:readiness");
        return { reaperOnline: true, message: "ready" };
      },
      async runJob(_command, { onStatus }) {
        events.push("reaper:mutation");
        onStatus({
          state: "progress",
          stage: "importing",
          message: "Importing.",
          done: false,
          error: false,
        });
        events.push("reaper:finished");
        onStatus({
          state: "complete",
          stage: "complete",
          message: "Imported.",
          done: true,
          error: false,
        });
      },
    };
    const companion = createCompanion({
      pairingToken: "0123456789abcdef0123456789abcdef",
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit("message", { data: JSON.stringify(command()) });
    await waitForMessage(
      socket,
      (message) => message.type === "command_status" && message.state === "complete",
    );
    assert.ok(events.indexOf("journal:begin") < events.indexOf("reaper:mutation"));
    assert.ok(events.indexOf("journal:complete") > events.indexOf("reaper:finished"));
    assert.equal(events.includes("journal:needs-attention"), false);
    await companion.stop();
  });
});

test("records needs_attention when REAPER fails after the running checkpoint", async () => {
  await withFakeWebSocket(async () => {
    const events = [];
    let safetyState = "idle";
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() {},
      async readiness() {
        return safetyState === "idle"
          ? { ready: true, message: "clear" }
          : { ready: false, message: "Inspect REAPER and clear locally." };
      },
      async begin() {
        safetyState = "running";
        events.push("journal:begin");
      },
      async complete() {
        safetyState = "idle";
        events.push("journal:complete");
      },
      async needsAttention() {
        safetyState = "needs_attention";
        events.push("journal:needs-attention");
      },
    };
    const reaper = {
      async readiness() {
        return { reaperOnline: true, message: "ready" };
      },
      async runJob() {
        events.push("reaper:mutation");
        throw new Error("Simulated REAPER failure.");
      },
    };
    const companion = createCompanion({
      pairingToken: "0123456789abcdef0123456789abcdef",
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit("message", {
      data: JSON.stringify(command({ requestId: "companion-job-0002" })),
    });
    const failed = await waitForMessage(
      socket,
      (message) => message.type === "command_status" && message.state === "needs_attention",
    );
    assert.match(failed.message, /clear-safety-lock/i);
    assert.deepEqual(events, [
      "journal:begin",
      "reaper:mutation",
      "journal:needs-attention",
    ]);
    const offline = await waitForMessage(
      socket,
      (message) => message.type === "machine_status" && message.reaperOnline === false,
    );
    assert.match(offline.message, /inspect REAPER/i);
    await companion.stop();
  });
});

test("startup advertises offline while a prior journal lock needs attention", async () => {
  await withFakeWebSocket(async () => {
    let reaperReadinessCalls = 0;
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() {},
      async readiness() {
        return {
          ready: false,
          state: "needs_attention",
          message: "A prior paid job needs attention; clear locally.",
        };
      },
      async status() {
        return {
          safety: {
            state: "needs_attention",
            requestId: "companion-recovered-0001",
            action: "build-play",
          },
        };
      },
    };
    const reaper = {
      async readiness() {
        reaperReadinessCalls += 1;
        return { reaperOnline: true, message: "ready" };
      },
    };
    const companion = createCompanion({
      pairingToken: "0123456789abcdef0123456789abcdef",
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const pair = socket.sent.find((message) => message.type === "pair");
    assert.equal(pair.reaperOnline, false);
    assert.match(pair.readinessMessage, /clear locally/i);
    assert.equal(reaperReadinessCalls, 0);
    socket.emit("message", {
      data: JSON.stringify({ type: "paired", version: 1, machineId: "sruthin-studio" }),
    });
    const recovery = await waitForMessage(
      socket,
      (message) =>
        message.type === "command_status" &&
        message.requestId === "companion-recovered-0001",
    );
    assert.equal(recovery.state, "needs_attention");
    assert.equal(recovery.done, true);
    assert.match(recovery.message, /clear-safety-lock/i);
    await companion.stop();
  });
});
