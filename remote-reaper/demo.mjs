import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createCompanion } from "./companion.mjs";
import { createMacPaidBuildApprover } from "./mac-paid-approval.mjs";
import {
  copyTextToMacClipboard,
  createEphemeralDemoIdentity,
  createGuestInviteUrl,
  DEMO_HARD_STOP_MS,
  DEMO_INVITE_ACCEPTANCE_MS,
  extractQuickTunnelUrl,
} from "./invite.mjs";
import { startRelay } from "./relay.mjs";

const cloudflaredCandidates = [
  process.env.CLOUDFLARED_PATH,
  "/usr/local/bin/cloudflared",
  "/opt/homebrew/bin/cloudflared",
].filter(Boolean);

async function findCloudflared() {
  for (const candidate of cloudflaredCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard installation location.
    }
  }
  throw new Error(
    "cloudflared is not installed. Install it with Homebrew (`brew install cloudflared`) and run this demo again.",
  );
}

async function runDemo() {
  const demoStartedAt = Date.now();
  const inviteAcceptUntil = demoStartedAt + DEMO_INVITE_ACCEPTANCE_MS;
  const demoStopsAt = demoStartedAt + DEMO_HARD_STOP_MS;
  const identity = createEphemeralDemoIdentity();
  const cloudflared = await findCloudflared();
  const relay = await startRelay({ port: 8787, host: "127.0.0.1" });
  let companion = null;
  let tunnel = null;
  let hardStopTimer = null;
  let tunnelReadyTimer = null;
  let shutdownPromise = null;

  async function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      if (hardStopTimer) clearTimeout(hardStopTimer);
      if (tunnelReadyTimer) clearTimeout(tunnelReadyTimer);
      if (tunnel && !tunnel.killed) tunnel.kill("SIGTERM");
      await companion?.stop();
      await relay.close();
    })();
    return shutdownPromise;
  }

  function finish(code) {
    void shutdown().finally(() => process.exit(code));
  }

  try {
    companion = createCompanion({
      relayUrl: "ws://127.0.0.1:8787",
      machineId: identity.machineId,
      pairingToken: identity.token,
      inviteAcceptUntil,
      // Every guest build must be approved once, on this Mac, before any mutation.
      allowPaidVoiceGeneration: true,
      approvePaidBuild: createMacPaidBuildApprover(),
    });
    await companion.start();

    tunnel = spawn(cloudflared, [
      "tunnel",
      "--no-autoupdate",
      "--url",
      "http://127.0.0.1:8787",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    hardStopTimer = setTimeout(() => {
      console.log("\nThe 90-minute demo window ended. Closing the tunnel and relay.");
      finish(0);
    }, Math.max(1, demoStopsAt - Date.now()));

    let announced = false;
    let tunnelRegistered = false;
    let tunnelOutput = "";
    tunnelReadyTimer = setTimeout(() => {
      if (announced) return;
      console.error("Cloudflare Tunnel did not become reachable within 60 seconds. Run the launcher again.");
      finish(1);
    }, 60_000);

    async function announce(publicUrl) {
      const issuedAt = Date.now();
      if (issuedAt >= inviteAcceptUntil) return;
      const websocketUrl = publicUrl.replace(/^https:/i, "wss:");
      const invite = createGuestInviteUrl({
        relayUrl: websocketUrl,
        machineId: identity.machineId,
        token: identity.token,
        nonce: identity.nonce,
        issuedAt,
        expiresAt: inviteAcceptUntil,
      });
      const copied = await copyTextToMacClipboard(invite.url);
      const acceptanceText = new Date(invite.payload.expiresAt).toLocaleString();
      const stopText = new Date(demoStopsAt).toLocaleString();

      console.log("\nREMOTE REAPER DEMO READY");
      console.log("1. Send or open this private guest link on the phone or laptop:");
      console.log(invite.url);
      console.log(
        copied
          ? "   The link is also copied to this Mac's clipboard."
          : "   Copy the complete link above, including everything after #.",
      );
      console.log("2. Keep REAPER and this Terminal window open.");
      console.log("3. Use Import Story or Recall Cues in Story Cue Studio.");
      console.log(`New connections and commands are accepted until ${acceptanceText}.`);
      console.log(`Accepted work may report status until the demo closes at ${stopText}.`);
      console.log("Each Build Immersive & Play request opens one approval dialog on this Mac.");
      console.log('The default is Deny; click "Approve This Build" within 45 seconds to continue.');
      console.log("Treat the link like a password and share it only with the intended guest.\n");
    }

    function inspectTunnelOutput(chunk) {
      const text = String(chunk);
      tunnelOutput = `${tunnelOutput}${text}`.slice(-16 * 1024);
      tunnelRegistered =
        tunnelRegistered ||
        /Registered tunnel connection/i.test(tunnelOutput);
      const publicUrl = extractQuickTunnelUrl(tunnelOutput);
      if (publicUrl && tunnelRegistered && !announced) {
        announced = true;
        if (tunnelReadyTimer) clearTimeout(tunnelReadyTimer);
        tunnelReadyTimer = null;
        void announce(publicUrl).catch((error) => {
          console.error(
            `Could not create the guest link: ${error instanceof Error ? error.message : String(error)}`,
          );
          finish(1);
        });
      }
      if (!announced && /error|failed/i.test(text)) process.stderr.write(text);
    }

    tunnel.stdout.on("data", inspectTunnelOutput);
    tunnel.stderr.on("data", inspectTunnelOutput);
    tunnel.once("error", (error) => {
      console.error(`Cloudflare Tunnel could not start: ${error.message}`);
      finish(1);
    });
    tunnel.once("exit", (code) => {
      if (code && !announced) {
        console.error(`Cloudflare Tunnel exited with code ${code}.`);
      }
      finish(code || 0);
    });

    process.once("SIGINT", () => finish(0));
    process.once("SIGTERM", () => finish(0));
  } catch (error) {
    await shutdown();
    throw error;
  }
}

runDemo().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
