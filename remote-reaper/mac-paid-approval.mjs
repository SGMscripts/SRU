import { execFile } from "node:child_process";

export const APPLESCRIPT_APPROVAL_TIMEOUT_SECONDS = 45;
export const NODE_APPROVAL_TIMEOUT_MS = 50_000;
export const FAILED_APPROVAL_COOLDOWN_MS = 25_000;

const APPROVAL_SENTINEL = "APPROVED";
const DENIAL_SENTINEL = "DENIED";
const TIMEOUT_SENTINEL = "TIMED_OUT";

export const PAID_BUILD_APPROVAL_APPLESCRIPT = `
on run argv
  set episodeTitle to item 1 of argv
  set runtimeLabel to item 2 of argv
  set requestLabel to item 3 of argv
  set actionLabel to item 4 of argv
  set dialogText to "A remote guest requested " & actionLabel & "." & return & return & "Episode: " & episodeTitle & return & "Target runtime: " & runtimeLabel & return & "Request: " & requestLabel & return & return & "Approving may use ElevenLabs credits and will change the open REAPER project."
  try
    -- Standard Additions display dialog: Deny is both the default and cancel button.
    set answer to «event sysodlog» dialogText given «class btns»:{"Deny", "Approve This Build"}, «class dflt»:"Deny", «class cbtn»:"Deny", «class appr»:"Story Cue Studio", «class givu»:${APPLESCRIPT_APPROVAL_TIMEOUT_SECONDS}
    if «class gavu» of answer then
      return "${TIMEOUT_SENTINEL}"
    end if
    if «class bhit» of answer is "Approve This Build" then
      return "${APPROVAL_SENTINEL}"
    end if
    return "${DENIAL_SENTINEL}"
  on error errorMessage number errorNumber
    if errorNumber is -128 then
      return "${DENIAL_SENTINEL}"
    end if
    return "UNAVAILABLE"
  end try
end run
`.trim();

function sanitizedLabel(value, fallback, maxLength) {
  const clean = String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return clean || fallback;
}

function approvalArguments({ title, runtimeMinutes, requestId, action } = {}) {
  const runtime = Number(runtimeMinutes) === 7 ? "7 minutes" : "3 minutes";
  const shortRequest = sanitizedLabel(requestId, "unknown", 128).slice(-12);
  const actionLabel = action === "create"
    ? "Create (Import Story, Recall Cues, Generate All Voices)"
    : "Build Immersive & Play";
  return [
    sanitizedLabel(title, "Untitled storyboard", 100),
    runtime,
    shortRequest,
    actionLabel,
  ];
}

function failedDecision(reason) {
  return { approved: false, reason };
}

function exactBinding({ requestId, commandSha256, scriptSha256, expiresAt } = {}) {
  return {
    requestId: String(requestId || ""),
    commandSha256: String(commandSha256 || ""),
    scriptSha256: String(scriptSha256 || ""),
    expiresAt: Number(expiresAt) || 0,
  };
}

export function createMacPaidBuildApprover({
  execFileImpl = execFile,
  platform = process.platform,
  nodeTimeoutMs = NODE_APPROVAL_TIMEOUT_MS,
  failedApprovalCooldownMs = FAILED_APPROVAL_COOLDOWN_MS,
  now = Date.now,
} = {}) {
  let failureCooldownUntil = 0;

  return async function approvePaidBuild(context) {
    if (now() < failureCooldownUntil) return failedDecision("cooldown");

    const rememberFailure = (decision) => {
      if (decision.approved !== true) {
        failureCooldownUntil = now() + failedApprovalCooldownMs;
      }
      return decision;
    };

    if (platform !== "darwin") {
      return rememberFailure(failedDecision("unavailable"));
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (decision) => {
        if (settled) return;
        settled = true;
        resolve(rememberFailure(decision));
      };

      try {
        execFileImpl(
          "/usr/bin/osascript",
          [
            "-l",
            "AppleScript",
            "-e",
            PAID_BUILD_APPROVAL_APPLESCRIPT,
            ...approvalArguments(context),
          ],
          {
            encoding: "utf8",
            timeout: nodeTimeoutMs,
            killSignal: "SIGTERM",
            maxBuffer: 16 * 1024,
          },
          (error, stdout) => {
            if (error) {
              const timedOut =
                error.killed === true ||
                Boolean(error.signal) ||
                error.code === "ETIMEDOUT";
              finish(failedDecision(timedOut ? "timeout" : "unavailable"));
              return;
            }

            const result = String(stdout || "").trim();
            if (result === APPROVAL_SENTINEL) {
              finish({
                approved: true,
                reason: "approved",
                binding: exactBinding(context),
              });
            } else if (result === TIMEOUT_SENTINEL) {
              finish(failedDecision("timeout"));
            } else if (result === DENIAL_SENTINEL) {
              finish(failedDecision("denied"));
            } else {
              finish(failedDecision("unavailable"));
            }
          },
        );
      } catch {
        finish(failedDecision("unavailable"));
      }
    });
  };
}
