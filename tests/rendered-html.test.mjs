import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function compileInviteParser(page) {
  const helperStart = page.indexOf("function normalizeRelayUrl");
  const helperEnd = page.indexOf("function generatePairingToken");
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "invite helper source must be extractable");
  const source = `
    const REMOTE_PROTOCOL_VERSION = 1;
    const REMOTE_INVITE_PREFIX = "#reaper-invite=";
    const REMOTE_INVITE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    const REMOTE_INVITE_MAX_LIFETIME_MS = 90 * 60 * 1000;
    const REMOTE_INVITE_CLOCK_SKEW_MS = 5 * 60 * 1000;
    ${page.slice(helperStart, helperEnd)}
    globalThis.parseInvite = parseRemoteReaperInviteFragment;
  `;
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const context = vm.createContext({
    URL,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    atob,
    btoa,
  });
  vm.runInContext(javascript, context);
  return context.parseInvite;
}

function compileGroqRouteConfig(route) {
  const configStart = route.indexOf("type Provider");
  const configEnd = route.indexOf("function spokenWordCount");
  const urlStart = route.indexOf("function safeGroqBaseUrl");
  const urlEnd = route.indexOf("async function providerText");
  assert.ok(configStart >= 0 && configEnd > configStart, "Groq config source must be extractable");
  assert.ok(urlStart >= 0 && urlEnd > urlStart, "Groq URL validator source must be extractable");
  const source = `
    ${route.slice(configStart, configEnd)}
    ${route.slice(urlStart, urlEnd)}
    globalThis.groqRouteConfig = { requestedProvider, validatedApiKey, safeGroqBaseUrl };
  `;
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const context = vm.createContext({ URL });
  vm.runInContext(javascript, context);
  return context.groqRouteConfig;
}

function inviteFragment(payload) {
  return `#reaper-invite=${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

test("server-renders the Audio Story Engine demo controls", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Audio Story Engine<\/title>/i);
  assert.match(html, /3-minute demo/);
  assert.match(html, /7\+ minute storyboard/);
  assert.match(html, /Generate 3-minute demo/);
  assert.match(html, /Original storyboard retained/);
  assert.match(html, /Training Cue Bank · Demo Lock/);
  assert.match(html, /388(?:<!-- -->)? exact SFX/);
  assert.match(html, /78(?:<!-- -->)? exact Ambient/);
  assert.match(html, /maximum one new cue/i);
  assert.match(html, /Music stays on MUSIC POD/);
  assert.match(html, /Send the next step to REAPER/);
  assert.match(html, /Local \/ Wi-Fi/);
  assert.match(html, /Internet Relay/);
  assert.match(html, /Node companion · different networks/);
  assert.match(html, /Make me the lead/);
  assert.match(html, /Your name/);
  assert.match(html, /Search voices/);
  assert.match(html, /Advanced: enter a voice ID manually/);
});

test("wires runtime selection and the same strict cue-bank policy into local and API generation", async () => {
  const [page, route, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /trainingCueBank:\s*true/);
  assert.match(page, /runtimeMinutes:\s*3/);
  assert.match(page, /runtimeMinutes:\s*settings\.runtimeMinutes/);
  assert.match(page, /chooseRuntime\(7\)/);
  assert.match(page, /enforceTrainingCueBank\(locallyOptimized, 0\)/);
  assert.match(page, /enforceTrainingCueBank\(locallyRanged\)/);
  assert.match(page, /function prepareGeneratedCueScript\(script: string, settings: Settings\)/);
  assert.match(page, /if \(settings\.optimizeCues\) prepared = optimizeCueScriptLocally\(prepared\)/);
  assert.match(page, /if \(settings\.ambientRanges\) \{\s*prepared = applyAmbientRangesLocally\(prepared\);\s*\} else \{[\s\S]*?stripAmbientRangeMarkers\(prepared\)/);
  assert.match(page, /settings\.trainingCueBank\s*\?\s*enforceTrainingCueBank\(prepared\)/);
  assert.match(page, /const fallback = prepareGeneratedCueScript\(localStoryboard\(story, settings\), settings\)/);
  assert.match(page, /const prepared = prepareGeneratedCueScript\(data\.script, settings\)/);
  assert.match(page, /Cue prep:/);
  assert.match(page, /transport-play-pause/);
  assert.match(page, /function createReaperAudio/);
  assert.match(page, /Import Story → wait 2 sec → Recall Cues → wait 2 sec → Generate All Voices/);
  assert.match(page, /sendRemoteReaperCommand\(createReaperAction\)/);
  assert.match(page, /action\.id === "create" \|\| action\.id === "build-play"/);
  assert.match(page, /_dbab6e45e2cf4c988650dfad12851cc1/);
  assert.match(page, /transport-seek/);
  assert.match(page, /_RS905359b5cf6473ddef8a02e350cd4115c357ca1c/);
  assert.match(page, /REAPER_TIMECODE_FPS = 25/);
  assert.match(page, /function formatReaperTimecode/);
  assert.match(page, /HH:MM:SS:FF timecode/);
  assert.match(page, /_RS9acc96ef9b416e2be08f75b70bc9d0143a5391e3/);
  assert.match(page, /Generate All Voices/);
  assert.match(page, /jumpToNextCue/);
  assert.match(page, /Story edit cursor/);
  assert.match(page, /Click or drag to seek the REAPER edit cursor/);
  assert.match(page, /type AIProvider = "openai" \| "gemini" \| "groq" \| "compatible"/);
  assert.match(page, /groq:\s*\{ apiKey: "", model: "openai\/gpt-oss-20b"/);
  assert.match(page, /Groq Fast · GPT-OSS 20B/);
  assert.match(page, /Groq Studio · GPT-OSS 120B/);
  assert.match(page, /Llama 3\.3 70B · Groq/);
  assert.match(page, /llama-3\.3-70b-versatile/);
  assert.match(page, /OpenAI Fast · GPT-5 nano/);
  assert.match(page, /OpenAI Story · GPT-5 mini/);
  assert.match(page, /https:\/\/platform\.openai\.com\/api-keys/);
  assert.match(page, /https:\/\/console\.groq\.com\/keys/);
  assert.match(page, /Groq API key \(gsk_/);
  assert.match(page, /Training Cue Bank · Demo Lock/);
  assert.match(page, /REMOTE_REAPER_STORAGE_KEY/);
  assert.match(page, /Internet relay URLs must begin with wss:\/\//);
  assert.match(page, /role:\s*"controller"/);
  assert.match(page, /type:\s*"command"/);
  assert.match(page, /action:\s*action\.id/);
  assert.match(page, /cancelPendingRemoteCommand/);
  assert.match(page, /remoteCompletionTimerRef/);
  assert.match(page, /suppressReconnect/);
  assert.match(page, /REMOTE_PENDING_STORAGE_KEY/);
  assert.match(page, /sessionStorage\.setItem/);
  assert.match(page, /type:\s*"status_query"/);
  assert.match(page, /story-cue-reaper-remote\.zip/);
  assert.match(page, /settings\.yourName/);
  assert.match(page, /Your name/);
  assert.match(page, /PUBLIC_VOICE_LOOKUP_IDS/);
  assert.match(page, /\/api\/elevenlabs\/voices/);
  assert.match(page, /Search voices/);
  assert.match(page, /Preview voice/);
  assert.match(page, /Advanced: enter a voice ID manually/);
  assert.match(page, /REMOTE_INVITE_PREFIX\s*=\s*"#reaper-invite="/);
  assert.match(page, /REMOTE_INVITE_MAX_LIFETIME_MS\s*=\s*90\s*\*\s*60\s*\*\s*1000/);
  assert.match(page, /parseRemoteReaperInviteFragment/);
  assert.match(page, /window\.history\.replaceState/);
  assert.match(page, /sessionStorage\.setItem\(\s*REMOTE_INVITE_SETTINGS_STORAGE_KEY/);
  assert.doesNotMatch(page, /localStorage\.(?:getItem|setItem)\(\s*REMOTE_INVITE_SETTINGS_STORAGE_KEY/);
  assert.match(page, /if \(inviteFragment && pendingText\)/);
  assert.match(page, /private relay invites cannot be accepted inside an embedded REAPER bridge/);
  assert.match(page, /Connecting without running any REAPER action/);
  assert.match(page, /Invite Accepted/);
  assert.match(page, /Invite Expired/);
  assert.match(page, /Invite Invalid/);
  assert.match(page, /Create the private guest link/);
  assert.match(page, /Download Mac demo package/);
  assert.match(page, /Start Audio Story Engine Remote Demo\.command/);
  assert.match(page, /Advanced \/ manual connection/);
  assert.match(page, /replayable bearer link until it expires or the Mac launcher/);
  assert.match(page, /separately approve this exact request before ElevenLabs credits/);
  assert.match(page, /Every remote request that can generate voices requires/);
  assert.doesNotMatch(page, /setShowPairingToken/);
  assert.doesNotMatch(page, /type=\{showPairingToken/);
  assert.match(page, /type="password"\s+value=\{draftRemoteSettings\.pairingToken\}/);
  const inviteRestoreStart = page.indexOf("const inviteFragment = window.location.hash");
  const fragmentRemoval = page.indexOf("window.history.replaceState", inviteRestoreStart);
  const embeddedBridgeDetection = page.indexOf(
    "const embeddedBridge = window.parent !== window",
    inviteRestoreStart,
  );
  assert.ok(
    inviteRestoreStart >= 0 &&
      fragmentRemoval > inviteRestoreStart &&
      fragmentRemoval < embeddedBridgeDetection,
    "the invite bearer must leave the address bar before bridge detection or connection",
  );
  assert.ok(
    page.indexOf('if (window.parent !== window)') < page.indexOf('if (reaperMode === "remote")'),
    "the existing embedded REAPER bridge must keep priority over remote mode",
  );

  assert.match(route, /settings\.trainingCueBank !== false/);
  assert.match(route, /runtimeProfile\(settings\.runtimeMinutes\)/);
  assert.match(route, /runtimeWordIssue\(words, profile\.minutes\)/);
  assert.match(route, /trainingCueBankInstructions\(\)/);
  assert.match(route, /enforceTrainingCueBank\(script\)/);
  assert.match(route, /optimizeCueScript\(ai, script, true\)/);
  assert.match(route, /cueBank/);
  assert.match(route, /settings\.yourName/);
  assert.match(route, /type Provider = "openai" \| "gemini" \| "groq" \| "compatible"/);
  assert.match(route, /GROQ_DEFAULT_BASE_URL\s*=\s*"https:\/\/api\.groq\.com\/openai\/v1"/);
  assert.match(route, /safeGroqBaseUrl/);
  assert.match(route, /provider === "groq"/);
  assert.match(route, /openai\/gpt-oss-20b/);
  assert.match(route, /reasoning_effort:\s*"low"/);
  assert.match(route, /reasoning_effort:\s*"medium"/);
  assert.match(route, /gsk_\[A-Za-z0-9_-\]/);

  assert.match(layout, /(?:title:\s*|const title\s*=\s*)"Audio Story Engine"/);
  assert.match(layout, /REAPER-ready (?:immersive )?audio drama/);
});

test("strictly limits Groq to a browser-supplied gsk key and its official OpenAI-compatible endpoint", async () => {
  const route = await readFile(new URL("../app/api/generate/route.ts", import.meta.url), "utf8");
  const { requestedProvider, validatedApiKey, safeGroqBaseUrl } = compileGroqRouteConfig(route);
  const validGroqKey = `gsk_${"a".repeat(32)}`;

  assert.equal(requestedProvider("groq"), "groq");
  assert.equal(requestedProvider("unsupported"), null);
  assert.equal(
    validatedApiKey("groq", validGroqKey),
    validGroqKey,
  );
  assert.throws(() => validatedApiKey("groq", "sk-not-groq"), /valid Groq API key/i);
  assert.equal(
    safeGroqBaseUrl("https://api.groq.com/openai/v1/"),
    "https://api.groq.com/openai/v1",
  );
  assert.throws(
    () => safeGroqBaseUrl("https://example.test/openai/v1"),
    /Groq API URL/i,
  );
});

test("strictly validates ephemeral private REAPER invite fragments", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const parseInvite = compileInviteParser(page);
  const now = 1_800_000_000_000;
  const valid = {
    version: 1,
    relayUrl: "wss://relay.example.test/story",
    machineId: "sruthin-studio",
    token: "T".repeat(43),
    nonce: "N".repeat(22),
    issuedAt: now - 60_000,
    expiresAt: now + 50 * 60_000,
  };

  const accepted = parseInvite(inviteFragment(valid), now);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.settings.relayUrl, "wss://relay.example.test/story");
  assert.equal(accepted.settings.machineId, "sruthin-studio");
  assert.equal(accepted.settings.pairingToken, valid.token);
  assert.equal(parseInvite(inviteFragment({ ...valid, relayUrl: "ws://localhost:8787" }), now).status, "accepted");

  assert.equal(parseInvite(inviteFragment({ ...valid, relayUrl: "ws://relay.example.test" }), now).status, "invalid");
  assert.equal(parseInvite(inviteFragment({ ...valid, token: "T".repeat(42) }), now).status, "invalid");
  assert.equal(parseInvite(inviteFragment({ ...valid, token: "+".repeat(43) }), now).status, "invalid");
  assert.equal(
    parseInvite(inviteFragment({ ...valid, relayUrl: "wss://relay.example.test/?secret=query" }), now).status,
    "invalid",
  );
  assert.equal(parseInvite(inviteFragment({ ...valid, nonce: undefined }), now).status, "invalid");
  assert.equal(parseInvite(inviteFragment({ ...valid, extra: true }), now).status, "invalid");
  assert.equal(
    parseInvite(inviteFragment({ ...valid, issuedAt: now - 1_000, expiresAt: now + 91 * 60_000 }), now).status,
    "invalid",
  );
  assert.equal(
    parseInvite(inviteFragment({ ...valid, issuedAt: now + 6 * 60_000, expiresAt: now + 50 * 60_000 }), now).status,
    "invalid",
  );
  assert.equal(
    parseInvite(inviteFragment({ ...valid, issuedAt: now - 60_000, expiresAt: now - 1 }), now).status,
    "expired",
  );
  const legacyField = { ...valid, pairingToken: valid.token };
  delete legacyField.token;
  assert.equal(parseInvite(inviteFragment(legacyField), now).status, "invalid");
  assert.equal(parseInvite("#reaper-invite=not_base64url!", now).status, "invalid");
  assert.equal(parseInvite("#some-other-fragment", now).status, "none");
});
