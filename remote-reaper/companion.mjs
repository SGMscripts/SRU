import { pathToFileURL } from "node:url";
import {
  defaultJournalPath,
  DuplicatePaidBuildError,
  FileJobJournal,
  SafetyLockError,
} from "./journal.mjs";
import {
  MAX_INVITE_ACCEPT_WINDOW_MS,
  PROTOCOL_VERSION,
  validateCommandMessage,
} from "./protocol.mjs";
import { ReaperWebControl } from "./reaper-web-control.mjs";

function requiredToken(value) {
  const token = String(value || "");
  if (
    token.length < 16 ||
    /^(?:replace-|change-?me|example|your[-_])/i.test(token)
  ) {
    throw new Error("Set REAPER_PAIRING_TOKEN to the same 16+ character token used by the website.");
  }
  return token;
}

function validRelayUrl(value) {
  const url = new URL(String(value || "ws://127.0.0.1:8787"));
  const local =
    url.protocol === "ws:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (url.protocol !== "wss:" && !local) {
    throw new Error("The companion relay must use wss://, except for local testing.");
  }
  return url.toString();
}

function booleanSetting(value) {
  return /^(?:1|true|yes|on)$/i.test(String(value || ""));
}

function optionalInviteAcceptUntil(value, now = Date.now()) {
  if (value === undefined || value === null || value === "") return 0;
  const deadline = Number(value);
  if (
    !Number.isSafeInteger(deadline) ||
    deadline <= now ||
    deadline - now > MAX_INVITE_ACCEPT_WINDOW_MS
  ) {
    throw new Error("Invite acceptance deadline must be within the next 90 minutes.");
  }
  return deadline;
}

function episodeTitle(script) {
  const firstLine = String(script || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || "Untitled storyboard";
}

function localApprovalFailure(decision) {
  if (decision?.reason === "cooldown") {
    return {
      stage: "local-approval-cooldown",
      message: "The REAPER Mac is briefly pausing new approval dialogs after a recent denial or failure. Wait 25 seconds, then send a new build request.",
    };
  }
  if (decision?.reason === "timeout") {
    return {
      stage: "local-approval-timeout",
      message: "No one approved this build on the REAPER Mac within 45 seconds. Nothing was changed and no voice credits were used.",
    };
  }
  if (decision?.reason === "denied") {
    return {
      stage: "local-approval-denied",
      message: "The REAPER Mac owner denied this build. Nothing was changed and no voice credits were used.",
    };
  }
  return {
    stage: "local-approval-unavailable",
    message: "The REAPER Mac could not show or verify its local approval dialog. The build was denied without changing REAPER or using voice credits.",
  };
}

function exactApprovalMatches(decision, context) {
  const binding = decision?.binding;
  return (
    decision?.approved === true &&
    binding?.requestId === context.requestId &&
    binding?.commandSha256 === context.commandSha256 &&
    binding?.scriptSha256 === context.scriptSha256 &&
    binding?.expiresAt === context.expiresAt
  );
}

export function createCompanion({
  relayUrl = process.env.REAPER_RELAY_URL || "ws://127.0.0.1:8787",
  machineId = process.env.REAPER_MACHINE_ID || "sruthin-studio",
  pairingToken = process.env.REAPER_PAIRING_TOKEN,
  reaperBaseUrl = process.env.REAPER_BASE_URL || "http://127.0.0.1:8089",
  cueAssetPath = process.env.CUE_ASSET_PATH || "/Volumes/Extreme SSD/pocket fm/france/tool test/ai mastering training/ai mastering training.RPP",
  allowPaidVoiceGeneration = booleanSetting(process.env.ALLOW_PAID_VOICE_GENERATION),
  approvePaidBuild = null,
  inviteAcceptUntil,
  logger = console,
  reaper = new ReaperWebControl({ baseUrl: reaperBaseUrl, assetPath: cueAssetPath }),
  journal = new FileJobJournal({
    filePath: process.env.REAPER_JOB_JOURNAL_PATH || defaultJournalPath(),
  }),
} = {}) {
  if (approvePaidBuild !== null && typeof approvePaidBuild !== "function") {
    throw new Error("approvePaidBuild must be a function when local approval is enabled.");
  }
  const config = {
    relayUrl: validRelayUrl(relayUrl),
    machineId: String(machineId),
    pairingToken: requiredToken(pairingToken),
    inviteAcceptUntil: optionalInviteAcceptUntil(inviteAcceptUntil),
  };
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(config.machineId)) {
    throw new Error("REAPER_MACHINE_ID must contain 3–64 letters, numbers, underscores, or dashes.");
  }

  let socket = null;
  let stopped = false;
  let reconnectTimer = null;
  let readinessTimer = null;
  let reconnectAttempt = 0;
  let busy = false;
  let sequence = 1;
  const completed = new Map();

  function send(payload) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }

  function sendStatus(requestId, value) {
    send({
      type: "command_status",
      version: PROTOCOL_VERSION,
      machineId: config.machineId,
      requestId,
      seq: sequence++,
      ...value,
    });
  }

  async function combinedReadiness() {
    const journalReadiness = await journal.readiness();
    if (!journalReadiness.ready) {
      return {
        reaperOnline: false,
        message: journalReadiness.message,
      };
    }
    return reaper.readiness();
  }

  async function reportReadiness() {
    const readiness = await combinedReadiness();
    send({
      type: "machine_status",
      version: PROTOCOL_VERSION,
      machineId: config.machineId,
      reaperOnline: readiness.reaperOnline,
      message: readiness.message,
    });
    return readiness;
  }

  async function reportRecoveredAttentionLock() {
    if (typeof journal.status !== "function") return;
    const state = await journal.status();
    const safety = state?.safety;
    if (safety?.state !== "needs_attention" || !safety.requestId) return;
    sendStatus(safety.requestId, {
      state: "needs_attention",
      stage: "startup-recovery",
      message: `A previous ${String(safety.action || "remote")} job did not finish cleanly. Inspect REAPER, then run the local clear-safety-lock command.`,
      done: true,
      error: true,
    });
  }

  async function handleCommand(message) {
    let command;
    try {
      command = validateCommandMessage(message, config.machineId);
    } catch (error) {
      sendStatus(String(message?.requestId || "invalid-request"), {
        state: "error",
        stage: "validation",
        message: error instanceof Error ? error.message : String(error),
        done: true,
        error: true,
      });
      return;
    }

    const previous = completed.get(command.requestId);
    if (previous) {
      sendStatus(command.requestId, previous);
      return;
    }
    if (busy) {
      sendStatus(command.requestId, {
        state: "error",
        stage: "busy",
        message: "The REAPER companion is already processing another episode.",
        done: true,
        error: true,
      });
      return;
    }
    if (command.action === "build-play" && !allowPaidVoiceGeneration) {
      const status = {
        state: "error",
        stage: "paid-generation-lock",
        message: "Paid remote voice generation is locked on the Mac companion. Enable it locally only for an approved demo.",
        done: true,
        error: true,
      };
      completed.set(command.requestId, status);
      sendStatus(command.requestId, status);
      return;
    }

    let journalStarted = false;
    busy = true;
    try {
      if (command.action === "build-play" && approvePaidBuild) {
        sendStatus(command.requestId, {
          state: "progress",
          stage: "awaiting-local-approval",
          message: "Waiting for the REAPER Mac owner to approve this exact build.",
          done: false,
          error: false,
        });

        const approvalContext = {
          title: episodeTitle(command.script),
          runtimeMinutes: command.runtimeMinutes,
          requestId: command.requestId,
          commandSha256: command.commandSha256,
          scriptSha256: command.scriptSha256,
          expiresAt: command.expiresAt,
        };
        let decision;
        try {
          decision = await approvePaidBuild(approvalContext);
        } catch {
          decision = { approved: false, reason: "unavailable" };
        }

        if (!exactApprovalMatches(decision, approvalContext)) {
          const failure = localApprovalFailure(
            decision?.approved === true
              ? { approved: false, reason: "binding-mismatch" }
              : decision,
          );
          const status = {
            state: "error",
            ...failure,
            done: true,
            error: true,
          };
          completed.set(command.requestId, status);
          sendStatus(command.requestId, status);
          return;
        }

        if (Date.now() > command.expiresAt) {
          const status = {
            state: "error",
            stage: "command-expired-after-approval",
            message: "The remote build request expired while awaiting approval. Nothing was changed and no voice credits were used.",
            done: true,
            error: true,
          };
          completed.set(command.requestId, status);
          sendStatus(command.requestId, status);
          return;
        }

        sendStatus(command.requestId, {
          state: "progress",
          stage: "local-approval-granted",
          message: "The REAPER Mac owner approved this exact build.",
          done: false,
          error: false,
        });
      }

      await journal.begin(command);
      journalStarted = true;
      sendStatus(command.requestId, {
        state: "accepted",
        stage: "accepted",
        message: "The REAPER Mac accepted the command and recorded its safety checkpoint.",
        done: false,
        error: false,
      });
      let terminalStatus = null;
      await reaper.runJob(command, {
        allowPaidVoiceGeneration,
        onStatus(status) {
          if (status.done) {
            terminalStatus = status;
          } else {
            sendStatus(command.requestId, status);
          }
        },
      });
      const finalStatus = terminalStatus || {
        state: "complete",
        stage: "complete",
        message: "The REAPER job completed.",
        done: true,
        error: false,
      };
      if (finalStatus.state !== "complete") {
        throw new Error(finalStatus.message || "The REAPER job did not complete successfully.");
      }
      await journal.complete(command);
      completed.set(command.requestId, finalStatus);
      sendStatus(command.requestId, finalStatus);
    } catch (error) {
      const journalGateError =
        error instanceof DuplicatePaidBuildError ||
        error instanceof SafetyLockError;
      let message = error instanceof Error ? error.message : String(error);
      let state = "error";
      let stage = journalGateError ? "safety-lock" : "failed";
      if (journalStarted) {
        state = "needs_attention";
        stage = "needs-attention";
        try {
          await journal.needsAttention(command);
          message = `${message} Inspect REAPER, then run the local clear-safety-lock command before accepting another remote job.`;
        } catch (journalError) {
          message = `${message} The safety journal could not record failure cleanly; the existing running checkpoint remains locked. ${journalError instanceof Error ? journalError.message : String(journalError)}`;
        }
      }
      const status = {
        state,
        stage,
        message,
        done: true,
        error: true,
      };
      completed.set(command.requestId, status);
      sendStatus(command.requestId, status);
    } finally {
      busy = false;
      await reportReadiness();
    }
  }

  async function connect() {
    if (stopped) return;
    const readiness = await combinedReadiness();
    logger.info?.(`Connecting ${config.machineId} to the Story Cue Studio relay…`);
    socket = new WebSocket(config.relayUrl);

    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
      send({
        type: "pair",
        version: PROTOCOL_VERSION,
        role: "companion",
        machineId: config.machineId,
        token: config.pairingToken,
        ...(config.inviteAcceptUntil
          ? { inviteAcceptUntil: config.inviteAcceptUntil }
          : {}),
        reaperOnline: readiness.reaperOnline,
        readinessMessage: readiness.message,
      });
      logger.info?.(readiness.reaperOnline ? "Remote REAPER is ready." : readiness.message);
      readinessTimer = setInterval(() => {
        if (!busy) void reportReadiness();
      }, 5000);
    });

    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === "paired") {
          void reportRecoveredAttentionLock().catch((error) => {
            logger.error?.(`Safety journal recovery status failed: ${error instanceof Error ? error.message : String(error)}`);
          });
        }
        if (message.type === "command") void handleCommand(message);
        if (message.type === "error") logger.error?.(`Relay: ${String(message.message || "error")}`);
      } catch {
        logger.error?.("Relay sent an invalid message.");
      }
    });

    socket.addEventListener("close", () => {
      if (readinessTimer) clearInterval(readinessTimer);
      readinessTimer = null;
      if (stopped) return;
      reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
      const delay = Math.min(1000 * (2 ** (reconnectAttempt - 1)), 15000);
      logger.info?.(`Relay disconnected. Reconnecting in ${Math.round(delay / 1000)}s…`);
      reconnectTimer = setTimeout(() => void connect(), delay);
    });

    socket.addEventListener("error", () => {
      logger.error?.("The remote relay connection failed.");
    });
  }

  return {
    config: {
      relayUrl: config.relayUrl,
      machineId: config.machineId,
      reaperBaseUrl,
      allowPaidVoiceGeneration,
      requiresPaidBuildApproval: Boolean(approvePaidBuild),
      inviteAcceptUntil: config.inviteAcceptUntil,
      journalPath: journal.filePath || "",
    },
    async start() {
      await journal.initialize({ recoverInterrupted: true });
      await connect();
    },
    async stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (readinessTimer) clearInterval(readinessTimer);
      socket?.close(1000, "Companion stopped");
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const journal = new FileJobJournal({
      filePath: process.env.REAPER_JOB_JOURNAL_PATH || defaultJournalPath(),
    });
    const localCommand = process.argv[2] || "";
    if (localCommand === "--journal-status") {
      await journal.initialize({ recoverInterrupted: true });
      console.log(JSON.stringify(await journal.status(), null, 2));
    } else if (localCommand === "--clear-safety-lock") {
      await journal.initialize({ recoverInterrupted: false });
      await journal.clearSafetyLock();
      console.log(`Companion safety lock cleared locally: ${journal.filePath}`);
    } else if (localCommand === "--allow-repeat-build") {
      await journal.initialize({ recoverInterrupted: true });
      await journal.armRepeatBuildOverride();
      console.log("One local repeat override is armed for the next Build Immersive & Play request.");
    } else if (localCommand) {
      throw new Error(`Unknown companion command: ${localCommand}`);
    } else {
      const companion = createCompanion({ journal });
      process.once("SIGINT", () => void companion.stop().finally(() => process.exit(0)));
      process.once("SIGTERM", () => void companion.stop().finally(() => process.exit(0)));
      await companion.start();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
