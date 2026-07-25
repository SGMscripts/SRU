import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { startRelay } from "../relay.mjs";

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("Timed out waiting for relay message."));
    }, timeoutMs);
    function onMessage(raw) {
      const payload = JSON.parse(String(raw));
      if (!predicate(payload)) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(payload);
    }
    socket.on("message", onMessage);
  });
}

function closeSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once("close", resolve);
    socket.close();
  });
}

test("routes a command and progress between paired website and Mac companion", async (context) => {
  const relay = await startRelay({
    port: 0,
    allowedOrigins: null,
    logger: { info() {} },
  });
  context.after(async () => relay.close());
  const url = `ws://127.0.0.1:${relay.port}`;
  const token = "0123456789abcdef0123456789abcdef";
  const companion = await openSocket(url);
  context.after(() => companion.close());
  companion.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "companion",
    machineId: "sruthin-studio",
    token,
    reaperOnline: true,
    readinessMessage: "Dedicated project ready.",
  }));
  await nextMessage(companion, (message) => message.type === "paired");

  const controller = await openSocket(url);
  context.after(() => controller.close());
  controller.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "controller",
    machineId: "sruthin-studio",
    token,
  }));
  const paired = await nextMessage(controller, (message) => message.type === "paired");
  assert.equal(paired.online, true);
  assert.equal(paired.reaperOnline, true);

  const now = Date.now();
  const command = {
    type: "command",
    version: 1,
    requestId: "relay-job-0001",
    machineId: "sruthin-studio",
    action: "story-importer",
    script: `[VOICE: speaker=Narrator]\nMaya listened.\n[SFX: PHONE RING]`,
    runtimeMinutes: 3,
    createdAt: now,
    expiresAt: now + 60000,
  };
  const forwardedPromise = nextMessage(companion, (message) => message.type === "command");
  const acceptedPromise = nextMessage(controller, (message) => message.type === "command_status");
  controller.send(JSON.stringify(command));
  const [forwarded, accepted] = await Promise.all([forwardedPromise, acceptedPromise]);
  assert.equal(forwarded.action, "story-importer");
  assert.equal(forwarded.requestId, command.requestId);
  assert.equal(accepted.state, "accepted");

  const progressPromise = nextMessage(
    controller,
    (message) => message.type === "command_status" && message.state === "progress",
  );
  companion.send(JSON.stringify({
    type: "command_status",
    version: 1,
    requestId: command.requestId,
    state: "progress",
    stage: "importing",
    message: "Importing storyboard.",
    seq: 2,
  }));
  const progress = await progressPromise;
  assert.equal(progress.stage, "importing");
});

test("returns the latest cached command status to a reconnected controller", async (context) => {
  const relay = await startRelay({
    port: 0,
    allowedOrigins: null,
    logger: { info() {} },
  });
  context.after(async () => relay.close());
  const url = `ws://127.0.0.1:${relay.port}`;
  const token = "0123456789abcdef0123456789abcdef";
  const machineId = "sruthin-studio";

  const companion = await openSocket(url);
  context.after(() => companion.close());
  companion.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "companion",
    machineId,
    token,
    reaperOnline: true,
  }));
  await nextMessage(companion, (message) => message.type === "paired");

  const firstController = await openSocket(url);
  firstController.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "controller",
    machineId,
    token,
  }));
  await nextMessage(firstController, (message) => message.type === "paired");

  const now = Date.now();
  const requestId = "relay-recovery-0001";
  const forwardedPromise = nextMessage(companion, (message) => message.type === "command");
  const acceptedPromise = nextMessage(
    firstController,
    (message) => message.type === "command_status" && message.requestId === requestId,
  );
  firstController.send(JSON.stringify({
    type: "command",
    version: 1,
    requestId,
    machineId,
    action: "story-importer",
    script: `[VOICE: speaker=Narrator]\nMaya listened.\n[SFX: PHONE RING]`,
    runtimeMinutes: 3,
    createdAt: now,
    expiresAt: now + 60000,
  }));
  await Promise.all([forwardedPromise, acceptedPromise]);

  const completedPromise = nextMessage(
    firstController,
    (message) => message.type === "command_status" && message.state === "complete",
  );
  companion.send(JSON.stringify({
    type: "command_status",
    version: 1,
    requestId,
    state: "complete",
    stage: "imported",
    message: "Storyboard imported.",
    done: true,
    seq: 4,
  }));
  await completedPromise;
  await closeSocket(firstController);

  const recoveredController = await openSocket(url);
  context.after(() => recoveredController.close());
  recoveredController.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "controller",
    machineId,
    token,
  }));
  await nextMessage(recoveredController, (message) => message.type === "paired");

  const recoveredPromise = nextMessage(
    recoveredController,
    (message) => message.type === "command_status" && message.requestId === requestId,
  );
  recoveredController.send(JSON.stringify({
    type: "status_query",
    version: 1,
    machineId,
    requestId,
  }));
  const recovered = await recoveredPromise;
  assert.equal(recovered.state, "complete");
  assert.equal(recovered.stage, "imported");
  assert.equal(recovered.message, "Storyboard imported.");
  assert.equal(recovered.seq, 4);
});

test("returns request-scoped errors for unknown and expired status queries", async (context) => {
  const relay = await startRelay({
    port: 0,
    allowedOrigins: null,
    logger: { info() {} },
  });
  context.after(async () => relay.close());
  const url = `ws://127.0.0.1:${relay.port}`;
  const token = "0123456789abcdef0123456789abcdef";
  const machineId = "sruthin-studio";

  const companion = await openSocket(url);
  context.after(() => companion.close());
  companion.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "companion",
    machineId,
    token,
    reaperOnline: true,
  }));
  await nextMessage(companion, (message) => message.type === "paired");

  const controller = await openSocket(url);
  context.after(() => controller.close());
  controller.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "controller",
    machineId,
    token,
  }));
  await nextMessage(controller, (message) => message.type === "paired");

  const unknownRequestId = "unknown-job-0001";
  const unknownPromise = nextMessage(
    controller,
    (message) => message.type === "error" && message.requestId === unknownRequestId,
  );
  controller.send(JSON.stringify({
    type: "status_query",
    version: 1,
    machineId,
    requestId: unknownRequestId,
  }));
  const unknown = await unknownPromise;
  assert.match(unknown.message, /unknown or expired/i);

  const now = Date.now();
  const expiredRequestId = "expired-job-0001";
  const forwardedPromise = nextMessage(companion, (message) => message.type === "command");
  const acceptedPromise = nextMessage(
    controller,
    (message) => message.type === "command_status" && message.requestId === expiredRequestId,
  );
  controller.send(JSON.stringify({
    type: "command",
    version: 1,
    requestId: expiredRequestId,
    machineId,
    action: "cue-recall",
    script: "",
    runtimeMinutes: 3,
    createdAt: now,
    expiresAt: now + 60000,
  }));
  await Promise.all([forwardedPromise, acceptedPromise]);
  const job = relay.rooms.get(machineId).jobs.get(expiredRequestId);
  job.updatedAt = Date.now() - 2 * 60 * 60 * 1000;

  const expiredPromise = nextMessage(
    controller,
    (message) => message.type === "error" && message.requestId === expiredRequestId,
  );
  controller.send(JSON.stringify({
    type: "status_query",
    version: 1,
    machineId,
    requestId: expiredRequestId,
  }));
  const expired = await expiredPromise;
  assert.match(expired.message, /unknown or expired/i);
  assert.equal(relay.rooms.get(machineId).jobs.has(expiredRequestId), false);
});

test("validates status query version, machine, and request ID", async (context) => {
  const relay = await startRelay({
    port: 0,
    allowedOrigins: null,
    logger: { info() {} },
  });
  context.after(async () => relay.close());
  const url = `ws://127.0.0.1:${relay.port}`;
  const controller = await openSocket(url);
  context.after(() => controller.close());
  controller.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "controller",
    machineId: "sruthin-studio",
    token: "0123456789abcdef0123456789abcdef",
  }));
  await nextMessage(controller, (message) => message.type === "paired");

  const wrongVersionPromise = nextMessage(
    controller,
    (message) => message.type === "error" && message.requestId === "status-job-0001",
  );
  controller.send(JSON.stringify({
    type: "status_query",
    version: 2,
    machineId: "sruthin-studio",
    requestId: "status-job-0001",
  }));
  const wrongVersion = await wrongVersionPromise;
  assert.match(wrongVersion.message, /unsupported status query/i);

  const wrongMachinePromise = nextMessage(
    controller,
    (message) => message.type === "error" && message.requestId === "status-job-0002",
  );
  controller.send(JSON.stringify({
    type: "status_query",
    version: 1,
    machineId: "another-studio",
    requestId: "status-job-0002",
  }));
  const wrongMachine = await wrongMachinePromise;
  assert.match(wrongMachine.message, /different REAPER machine/i);

  const invalidRequestPromise = nextMessage(
    controller,
    (message) => message.type === "error" && message.requestId === "short",
  );
  controller.send(JSON.stringify({
    type: "status_query",
    version: 1,
    machineId: "sruthin-studio",
    requestId: "short",
  }));
  const invalidRequest = await invalidRequestPromise;
  assert.match(invalidRequest.message, /invalid status query request ID/i);
});

test("rejects a controller using the wrong pairing token", async (context) => {
  const relay = await startRelay({
    port: 0,
    allowedOrigins: null,
    logger: { info() {} },
  });
  context.after(async () => relay.close());
  const url = `ws://127.0.0.1:${relay.port}`;
  const companion = await openSocket(url);
  context.after(() => companion.close());
  companion.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "companion",
    machineId: "sruthin-studio",
    token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    reaperOnline: true,
  }));
  await nextMessage(companion, (message) => message.type === "paired");

  const controller = await openSocket(url);
  context.after(() => controller.close());
  controller.send(JSON.stringify({
    type: "pair",
    version: 1,
    role: "controller",
    machineId: "sruthin-studio",
    token: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  }));
  const error = await nextMessage(controller, (message) => message.type === "error");
  assert.match(error.message, /does not match/i);
});
