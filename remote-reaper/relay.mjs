import http from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import {
  MAX_SOCKET_PAYLOAD_BYTES,
  parseJsonMessage,
  sanitizeCommandStatus,
  tokenHash,
  validateCommandMessage,
  validatePairMessage,
} from "./protocol.mjs";

const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://story-cue-studio.sruthin4444.chatgpt.site",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const JOB_STATUS_TTL_MS = 60 * 60 * 1000;
const REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{7,127}$/i;

function safeSend(socket, payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function errorPayload(message, requestId) {
  return {
    type: "error",
    version: 1,
    message: String(message || "Remote relay error."),
    ...(requestId ? { requestId } : {}),
  };
}

function validateStatusQuery(value, expectedMachineId) {
  if (!value || value.type !== "status_query" || Number(value.version) !== 1) {
    throw new Error("Unsupported status query message.");
  }
  const requestId = String(value.requestId || "");
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error("Invalid status query request ID.");
  }
  if (String(value.machineId || "") !== expectedMachineId) {
    throw new Error("Status query targets a different REAPER machine.");
  }
  return {
    type: "status_query",
    version: 1,
    machineId: expectedMachineId,
    requestId,
  };
}

export async function startRelay({
  port = Number(process.env.PORT) || 8787,
  host = process.env.HOST || "127.0.0.1",
  allowedOrigins = DEFAULT_ALLOWED_ORIGINS,
  logger = console,
  now = Date.now,
} = {}) {
  const rooms = new Map();
  const server = http.createServer((request, response) => {
    if (request.url === "/health") {
      const onlineCompanions = Array.from(rooms.values()).filter((room) => room.companion).length;
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ ok: true, onlineCompanions }));
      return;
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end("Audio Story Engine remote relay is running.\n");
  });
  const wss = new WebSocketServer({
    server,
    maxPayload: MAX_SOCKET_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });

  function roomFor(pair) {
    const hashed = tokenHash(pair.token);
    let room = rooms.get(pair.machineId);
    if (!room) {
      room = {
        tokenHash: hashed,
        companion: null,
        controllers: new Set(),
        reaperOnline: false,
        readinessMessage: "Waiting for the REAPER Mac companion.",
        jobs: new Map(),
        inviteAcceptUntil: 0,
      };
      rooms.set(pair.machineId, room);
    }
    if (room.tokenHash !== hashed) throw new Error("Pairing token does not match this REAPER machine.");
    return room;
  }

  function broadcastMachineStatus(machineId, room) {
    const payload = {
      type: "machine_status",
      version: 1,
      machineId,
      online: Boolean(room.companion),
      reaperOnline: Boolean(room.companion && room.reaperOnline),
      message: room.readinessMessage,
    };
    for (const controller of room.controllers) safeSend(controller, payload);
  }

  function requireActiveInvite(room) {
    if (room.inviteAcceptUntil && now() >= room.inviteAcceptUntil) {
      throw new Error("This one-click REAPER invite has expired. Start a new demo on the Mac.");
    }
  }

  function broadcastCommandStatus(room, payload) {
    for (const controller of room.controllers) safeSend(controller, payload);
  }

  wss.on("connection", (socket, request) => {
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });
    let peer = null;
    const pairTimeout = setTimeout(() => {
      if (!peer) socket.close(4001, "Pairing timeout");
    }, 10000);

    socket.on("message", (raw) => {
      try {
        const message = parseJsonMessage(raw);
        if (!peer) {
          const pair = validatePairMessage(message, now());
          if (
            pair.role === "controller" &&
            allowedOrigins &&
            !allowedOrigins.has(String(request.headers.origin || ""))
          ) {
            throw new Error("This website origin is not allowed by the relay.");
          }
          const room = roomFor(pair);
          if (pair.role === "controller") {
            requireActiveInvite(room);
          } else if (room.inviteAcceptUntil) {
            requireActiveInvite(room);
            if (pair.inviteAcceptUntil !== room.inviteAcceptUntil) {
              throw new Error("A one-click REAPER invite deadline cannot be changed.");
            }
            if (room.companion && room.companion !== socket) {
              throw new Error("The one-click REAPER companion is already connected.");
            }
          }
          peer = { role: pair.role, machineId: pair.machineId, room };
          clearTimeout(pairTimeout);
          if (pair.role === "companion") {
            if (room.companion && room.companion !== socket) {
              room.companion.close(4002, "A newer companion connected");
            }
            room.companion = socket;
            room.inviteAcceptUntil = pair.inviteAcceptUntil;
            room.reaperOnline = pair.reaperOnline;
            room.readinessMessage = pair.readinessMessage || (
              pair.reaperOnline ? "Remote REAPER is ready." : "REAPER is not ready."
            );
            broadcastMachineStatus(pair.machineId, room);
          } else {
            room.controllers.add(socket);
          }
          safeSend(socket, {
            type: "paired",
            version: 1,
            machineId: pair.machineId,
            online: Boolean(room.companion),
            reaperOnline: Boolean(room.companion && room.reaperOnline),
            message: room.readinessMessage,
          });
          return;
        }

        if (message.type === "command") {
          if (peer.role !== "controller") throw new Error("Only the website can submit commands.");
          requireActiveInvite(peer.room);
          const command = validateCommandMessage(message, peer.machineId, now());
          if (!peer.room.companion || peer.room.companion.readyState !== WebSocket.OPEN) {
            throw new Error("The REAPER Mac companion is offline.");
          }
          if (!peer.room.reaperOnline) {
            throw new Error(peer.room.readinessMessage || "REAPER is not ready.");
          }
          const previous = peer.room.jobs.get(command.requestId);
          if (previous) {
            if (previous.digest !== command.commandSha256) {
              throw new Error("This request ID was already used for a different action, runtime, or storyboard.");
            }
            safeSend(socket, previous.status);
            return;
          }
          const accepted = {
            type: "command_status",
            version: 1,
            machineId: peer.machineId,
            requestId: command.requestId,
            state: "accepted",
            stage: "queued",
            message: "Command accepted by the relay and sent to the REAPER Mac.",
            done: false,
            error: false,
            actualDurationSeconds: 0,
            seq: 1,
          };
          peer.room.jobs.set(command.requestId, {
            digest: command.commandSha256,
            status: accepted,
            updatedAt: now(),
          });
          safeSend(peer.room.companion, command);
          safeSend(socket, accepted);
          return;
        }

        if (message.type === "command_status") {
          if (peer.role !== "companion") throw new Error("Only the Mac companion can report command status.");
          const status = sanitizeCommandStatus(message, peer.machineId);
          const job = peer.room.jobs.get(status.requestId);
          if (!job) throw new Error("Status refers to an unknown command.");
          job.status = status;
          job.updatedAt = now();
          broadcastCommandStatus(peer.room, status);
          return;
        }

        if (message.type === "status_query") {
          if (peer.role !== "controller") throw new Error("Only the website can query command status.");
          const query = validateStatusQuery(message, peer.machineId);
          const job = peer.room.jobs.get(query.requestId);
          if (!job || job.updatedAt < now() - JOB_STATUS_TTL_MS) {
            if (job) peer.room.jobs.delete(query.requestId);
            throw new Error("No cached command status exists for this request ID; it is unknown or expired.");
          }
          safeSend(socket, job.status);
          return;
        }

        if (message.type === "machine_status") {
          if (peer.role !== "companion") throw new Error("Only the Mac companion can report REAPER presence.");
          peer.room.reaperOnline = Boolean(message.reaperOnline);
          peer.room.readinessMessage = String(message.message || (
            message.reaperOnline ? "Remote REAPER is ready." : "REAPER is not ready."
          )).slice(0, 500);
          broadcastMachineStatus(peer.machineId, peer.room);
          return;
        }

        throw new Error("Unknown relay message type.");
      } catch (error) {
        safeSend(socket, errorPayload(error instanceof Error ? error.message : String(error), (() => {
          try {
            return JSON.parse(String(raw)).requestId;
          } catch {
            return undefined;
          }
        })()));
      }
    });

    socket.on("close", () => {
      clearTimeout(pairTimeout);
      if (!peer) return;
      if (peer.role === "companion" && peer.room.companion === socket) {
        peer.room.companion = null;
        peer.room.reaperOnline = false;
        peer.room.readinessMessage = "The REAPER Mac companion is offline.";
        broadcastMachineStatus(peer.machineId, peer.room);
      } else {
        peer.room.controllers.delete(socket);
      }
      if (!peer.room.companion && peer.room.controllers.size === 0 && peer.room.jobs.size === 0) {
        rooms.delete(peer.machineId);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
    const cutoff = now() - JOB_STATUS_TTL_MS;
    for (const [machineId, room] of rooms) {
      for (const [requestId, job] of room.jobs) {
        if (job.updatedAt < cutoff) room.jobs.delete(requestId);
      }
      if (!room.companion && room.controllers.size === 0 && room.jobs.size === 0) {
        rooms.delete(machineId);
      }
    }
  }, 20000);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : port;
  logger.info?.(`Audio Story Engine relay listening on ws://${host}:${listeningPort}`);

  return {
    port: listeningPort,
    host,
    server,
    wss,
    rooms,
    async close() {
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startRelay().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
