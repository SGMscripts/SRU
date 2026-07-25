import assert from "node:assert/strict";
import test from "node:test";
import { createCompanion } from "../companion.mjs";
import { createMacPaidBuildApprover } from "../mac-paid-approval.mjs";
import { commandHash, scriptHash } from "../protocol.mjs";

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

async function waitForCondition(predicate, timeoutMs = 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for companion state.");
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

test("one-click companion pairing carries its server-enforced invite deadline", async () => {
  await withFakeWebSocket(async () => {
    const inviteAcceptUntil = Date.now() + 50 * 60 * 1000;
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() {},
      async readiness() {
        return { ready: true, message: "clear" };
      },
    };
    const reaper = {
      async readiness() {
        return { reaperOnline: true, message: "ready" };
      },
    };
    const companion = createCompanion({
      machineId: "reaper-demo-0011223344556677",
      pairingToken: "0123456789abcdef0123456789abcdef01234567890",
      inviteAcceptUntil,
      allowPaidVoiceGeneration: false,
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const pair = socket.sent.find((message) => message.type === "pair");
    assert.equal(pair.inviteAcceptUntil, inviteAcceptUntil);
    assert.equal(companion.config.allowPaidVoiceGeneration, false);
    await companion.stop();
  });
});

test("requires exact local approval before the safety journal and REAPER build", async () => {
  await withFakeWebSocket(async () => {
    const events = [];
    let approvalContext = null;
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() {},
      async readiness() {
        return { ready: true, message: "clear" };
      },
      async begin() {
        events.push("journal:begin");
      },
      async complete() {
        events.push("journal:complete");
      },
      async needsAttention() {
        events.push("journal:needs-attention");
      },
    };
    const reaper = {
      async readiness() {
        return { reaperOnline: true, message: "ready" };
      },
      async runJob(_command, { allowPaidVoiceGeneration, onStatus }) {
        assert.equal(allowPaidVoiceGeneration, true);
        events.push("reaper:mutation");
        onStatus({
          state: "complete",
          stage: "complete",
          message: "Built.",
          done: true,
          error: false,
        });
      },
    };
    const macApprover = createMacPaidBuildApprover({
      platform: "darwin",
      execFileImpl(_file, _args, _options, callback) {
        queueMicrotask(() => callback(null, "APPROVED\n", ""));
      },
    });
    const companion = createCompanion({
      pairingToken: "0123456789abcdef0123456789abcdef",
      allowPaidVoiceGeneration: true,
      async approvePaidBuild(context) {
        approvalContext = context;
        events.push("approval");
        return macApprover(context);
      },
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const build = command({
      requestId: "approved-build-0001",
      action: "build-play",
      script: "EPISODE — THE LAST SIGNAL\n[VOICE: speaker=Narrator]\nMaya listened.\n[SFX: PHONE RING]",
    });
    socket.emit("message", {
      data: JSON.stringify(build),
    });
    await waitForMessage(
      socket,
      (message) => message.type === "command_status" && message.state === "complete",
    );

    assert.deepEqual(events, [
      "approval",
      "journal:begin",
      "reaper:mutation",
      "journal:complete",
    ]);
    assert.deepEqual(approvalContext, {
      title: "EPISODE — THE LAST SIGNAL",
      runtimeMinutes: 3,
      requestId: "approved-build-0001",
      commandSha256: commandHash("build-play", 3, build.script),
      scriptSha256: scriptHash(build.script),
      expiresAt: build.expiresAt,
    });
    assert.equal(companion.config.requiresPaidBuildApproval, true);
    const stages = socket.sent
      .filter((message) => message.type === "command_status")
      .map((message) => message.stage);
    assert.deepEqual(stages, [
      "awaiting-local-approval",
      "local-approval-granted",
      "accepted",
      "complete",
    ]);
    await companion.stop();
  });
});

test("local denial is terminal before journal or REAPER and replay does not reprompt", async () => {
  await withFakeWebSocket(async () => {
    let approvalCalls = 0;
    let journalBegins = 0;
    let reaperRuns = 0;
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() {},
      async readiness() {
        return { ready: true, message: "clear" };
      },
      async begin() {
        journalBegins += 1;
      },
      async complete() {},
      async needsAttention() {},
    };
    const reaper = {
      async readiness() {
        return { reaperOnline: true, message: "ready" };
      },
      async runJob() {
        reaperRuns += 1;
      },
    };
    const companion = createCompanion({
      pairingToken: "0123456789abcdef0123456789abcdef",
      allowPaidVoiceGeneration: true,
      async approvePaidBuild() {
        approvalCalls += 1;
        return { approved: false, reason: "denied" };
      },
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    const build = command({
      requestId: "denied-build-0001",
      action: "build-play",
    });
    socket.emit("message", { data: JSON.stringify(build) });
    const denied = await waitForMessage(
      socket,
      (message) =>
        message.type === "command_status" &&
        message.requestId === build.requestId &&
        message.stage === "local-approval-denied",
    );
    assert.equal(denied.done, true);
    assert.equal(denied.error, true);

    socket.emit("message", { data: JSON.stringify(build) });
    await waitForCondition(
      () =>
        socket.sent.filter(
          (message) =>
            message.type === "command_status" &&
            message.requestId === build.requestId &&
            message.stage === "local-approval-denied",
        ).length === 2,
    );
    assert.equal(approvalCalls, 1);
    assert.equal(journalBegins, 0);
    assert.equal(reaperRuns, 0);
    await companion.stop();
  });
});

test("a local approval callback failure fails closed before journal or REAPER", async () => {
  await withFakeWebSocket(async () => {
    let journalBegins = 0;
    let reaperRuns = 0;
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() {},
      async readiness() {
        return { ready: true, message: "clear" };
      },
      async begin() {
        journalBegins += 1;
      },
    };
    const reaper = {
      async readiness() {
        return { reaperOnline: true, message: "ready" };
      },
      async runJob() {
        reaperRuns += 1;
      },
    };
    const companion = createCompanion({
      pairingToken: "0123456789abcdef0123456789abcdef",
      allowPaidVoiceGeneration: true,
      async approvePaidBuild() {
        throw new Error("dialog failed");
      },
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit("message", {
      data: JSON.stringify(command({
        requestId: "unavailable-build-0001",
        action: "build-play",
      })),
    });
    await waitForMessage(
      socket,
      (message) =>
        message.type === "command_status" &&
        message.stage === "local-approval-unavailable",
    );
    assert.equal(journalBegins, 0);
    assert.equal(reaperRuns, 0);
    await companion.stop();
  });
});

test("manual paid mode still runs a build without the demo approval callback", async () => {
  await withFakeWebSocket(async () => {
    const events = [];
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() {},
      async readiness() {
        return { ready: true, message: "clear" };
      },
      async begin() {
        events.push("journal:begin");
      },
      async complete() {
        events.push("journal:complete");
      },
      async needsAttention() {},
    };
    const reaper = {
      async readiness() {
        return { reaperOnline: true, message: "ready" };
      },
      async runJob(_command, { allowPaidVoiceGeneration, onStatus }) {
        assert.equal(allowPaidVoiceGeneration, true);
        events.push("reaper:mutation");
        onStatus({
          state: "complete",
          stage: "complete",
          message: "Built.",
          done: true,
          error: false,
        });
      },
    };
    const companion = createCompanion({
      pairingToken: "0123456789abcdef0123456789abcdef",
      allowPaidVoiceGeneration: true,
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit("message", {
      data: JSON.stringify(command({
        requestId: "manual-build-0001",
        action: "build-play",
      })),
    });
    await waitForMessage(
      socket,
      (message) => message.type === "command_status" && message.state === "complete",
    );
    assert.deepEqual(events, [
      "journal:begin",
      "reaper:mutation",
      "journal:complete",
    ]);
    assert.equal(companion.config.requiresPaidBuildApproval, false);
    assert.equal(
      socket.sent.some(
        (message) =>
          message.type === "command_status" &&
          message.stage === "awaiting-local-approval",
      ),
      false,
    );
    await companion.stop();
  });
});

test("rejects an approved result bound to a different exact build", async () => {
  await withFakeWebSocket(async () => {
    let journalBegins = 0;
    let reaperRuns = 0;
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() {},
      async readiness() {
        return { ready: true, message: "clear" };
      },
      async begin() {
        journalBegins += 1;
      },
    };
    const reaper = {
      async readiness() {
        return { reaperOnline: true, message: "ready" };
      },
      async runJob() {
        reaperRuns += 1;
      },
    };
    const companion = createCompanion({
      pairingToken: "0123456789abcdef0123456789abcdef",
      allowPaidVoiceGeneration: true,
      async approvePaidBuild(context) {
        return {
          approved: true,
          reason: "approved",
          binding: {
            requestId: context.requestId,
            commandSha256: "0".repeat(64),
            scriptSha256: context.scriptSha256,
            expiresAt: context.expiresAt,
          },
        };
      },
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit("message", {
      data: JSON.stringify(command({
        requestId: "mismatch-build-0001",
        action: "build-play",
      })),
    });
    const rejected = await waitForMessage(
      socket,
      (message) =>
        message.type === "command_status" &&
        message.stage === "local-approval-unavailable",
    );
    assert.equal(rejected.error, true);
    assert.equal(journalBegins, 0);
    assert.equal(reaperRuns, 0);
    await companion.stop();
  });
});

test("the manual paid-generation lock runs before any supplied approval callback", async () => {
  await withFakeWebSocket(async () => {
    let approvalCalls = 0;
    let journalBegins = 0;
    let reaperRuns = 0;
    const journal = {
      filePath: "/tmp/injected-journal.json",
      async initialize() {},
      async readiness() {
        return { ready: true, message: "clear" };
      },
      async begin() {
        journalBegins += 1;
      },
    };
    const reaper = {
      async readiness() {
        return { reaperOnline: true, message: "ready" };
      },
      async runJob() {
        reaperRuns += 1;
      },
    };
    const companion = createCompanion({
      pairingToken: "0123456789abcdef0123456789abcdef",
      allowPaidVoiceGeneration: false,
      async approvePaidBuild() {
        approvalCalls += 1;
        return { approved: false, reason: "denied" };
      },
      reaper,
      journal,
      logger: { info() {}, error() {} },
    });
    await companion.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.emit("message", {
      data: JSON.stringify(command({
        requestId: "locked-build-0001",
        action: "build-play",
      })),
    });
    await waitForMessage(
      socket,
      (message) =>
        message.type === "command_status" &&
        message.stage === "paid-generation-lock",
    );
    assert.equal(approvalCalls, 0);
    assert.equal(journalBegins, 0);
    assert.equal(reaperRuns, 0);
    await companion.stop();
  });
});
