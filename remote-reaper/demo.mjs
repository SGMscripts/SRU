import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createCompanion } from "./companion.mjs";
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

function tunnelUrlFromLine(line) {
  const match = String(line).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match ? match[0] : "";
}

const pairingToken = String(process.env.REAPER_PAIRING_TOKEN || "");
if (pairingToken.length < 16) {
  throw new Error("Create .env from .env.example and set a private REAPER_PAIRING_TOKEN first.");
}

const cloudflared = await findCloudflared();
const relay = await startRelay({ port: 8787, host: "127.0.0.1" });
const companion = createCompanion({
  relayUrl: "ws://127.0.0.1:8787",
  pairingToken,
});
await companion.start();

const tunnel = spawn(cloudflared, [
  "tunnel",
  "--no-autoupdate",
  "--url",
  "http://127.0.0.1:8787",
], {
  stdio: ["ignore", "pipe", "pipe"],
});

let announced = false;
function inspectTunnelOutput(chunk) {
  const text = String(chunk);
  const publicUrl = tunnelUrlFromLine(text);
  if (publicUrl && !announced) {
    announced = true;
    const websocketUrl = publicUrl.replace(/^https:/, "wss:");
    console.log("\nREMOTE DEMO READY");
    console.log(`Paste this Relay URL into Story Cue Studio: ${websocketUrl}`);
    console.log(`Machine ID: ${process.env.REAPER_MACHINE_ID || "sruthin-studio"}`);
    console.log("Use the same pairing token saved in this folder's .env file.");
    console.log("Keep this window, REAPER, and the dedicated story project open.\n");
  }
  if (!announced && /error|failed/i.test(text)) process.stderr.write(text);
}
tunnel.stdout.on("data", inspectTunnelOutput);
tunnel.stderr.on("data", inspectTunnelOutput);

async function shutdown() {
  tunnel.kill("SIGTERM");
  await companion.stop();
  await relay.close();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
tunnel.once("exit", (code) => {
  if (code && !announced) console.error(`Cloudflare Tunnel exited with code ${code}.`);
  void shutdown().finally(() => process.exit(code || 0));
});
