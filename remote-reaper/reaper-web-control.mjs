import { access } from "node:fs/promises";
import { copyTextToMacClipboard } from "./invite.mjs";

export const IMPORT_ACTION = "_RS99a1bb9381b40ba9ade9d82fa74add533356b26c";
export const RECALL_ACTION = "_RS419e01a1897fa99332fb4b216371f2f2cd868122";
export const ELEVEN_ACTION = "_RS9acc96ef9b416e2be08f75b70bc9d0143a5391e3";
export const PLAY_PAUSE_ACTION = "_dbab6e45e2cf4c988650dfad12851cc1";
export const SEEK_ACTION = "_RS905359b5cf6473ddef8a02e350cd4115c357ca1c";
export const PROJECT_SECTION = "StoryCueStudio";
export const STORY_TARGET_ROLE = "story_target";
export const CHUNK_SIZE = 1800;
export const MAX_CHUNKS = 1000;
export const TIMECODE_FPS = 25;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function formatReaperTimecode(seconds) {
  const frames = Math.max(0, Math.round((Number(seconds) || 0) * TIMECODE_FPS));
  const frame = frames % TIMECODE_FPS;
  const wholeSeconds = Math.floor(frames / TIMECODE_FPS);
  const second = wholeSeconds % 60;
  const wholeMinutes = Math.floor(wholeSeconds / 60);
  const minute = wholeMinutes % 60;
  const hour = Math.floor(wholeMinutes / 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}:${String(frame).padStart(2, "0")}`;
}

function segment(value) {
  return encodeURIComponent(String(value));
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || "http://127.0.0.1:8089"));
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new Error("The companion may connect only to REAPER Web Control on localhost.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function encodeStoryChunks(script) {
  const encoded = Buffer.from(String(script), "utf8").toString("base64url");
  const chunks = [];
  for (let index = 0; index < encoded.length; index += CHUNK_SIZE) {
    chunks.push(encoded.slice(index, index + CHUNK_SIZE));
  }
  if (!chunks.length) throw new Error("Storyboard is empty.");
  if (chunks.length > MAX_CHUNKS) throw new Error("Storyboard exceeds the REAPER inbox limit.");
  return chunks;
}

export class ReaperWebControl {
  constructor({
    baseUrl = "http://127.0.0.1:8089",
    fetchImpl = globalThis.fetch,
    assetPath = "",
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchImpl = fetchImpl;
    this.assetPath = assetPath;
  }

  async command(value, timeoutMs = 15000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/_/${value};`, {
        method: "GET",
        headers: { "cache-control": "no-cache" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`REAPER Web Control returned HTTP ${response.status}.`);
      return await response.text();
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("REAPER Web Control did not answer in time.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async setProject(key, value) {
    await this.command(`SET/PROJEXTSTATE/${segment(PROJECT_SECTION)}/${segment(key)}/${segment(value)}`);
  }

  async setProjectSection(section, key, value) {
    await this.command(`SET/PROJEXTSTATE/${segment(section)}/${segment(key)}/${segment(value)}`);
  }

  async getProject(key) {
    return this.getProjectSection(PROJECT_SECTION, key);
  }

  async getProjectSection(section, key) {
    const text = await this.command(`GET/PROJEXTSTATE/${segment(section)}/${segment(key)}`);
    const line = text.split(/\r?\n/).find((entry) => entry.startsWith("PROJEXTSTATE\t"));
    if (!line) return "";
    return line
      .split("\t")
      .slice(3)
      .join("\t")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }

  async transport() {
    const text = await this.command("TRANSPORT");
    const line = text.split(/\r?\n/).find((entry) => entry.startsWith("TRANSPORT\t"));
    if (!line) throw new Error("REAPER returned an invalid transport response.");
    const fields = line.split("\t");
    return {
      raw: line,
      playState: Number(fields[1]) || 0,
      positionSeconds: Number(fields[2]) || 0,
      repeatEnabled: Number(fields[3]) !== 0,
    };
  }

  async readiness() {
    try {
      const transport = await this.transport();
      const role = await this.getProject("ProjectRole");
      const targetId = await this.getProject("RemoteTargetId");
      if (role !== STORY_TARGET_ROLE || !targetId) {
        return {
          reaperOnline: false,
          targetId: "",
          message: "Open a dedicated story project and run “Enable Story Cue Studio Remote Target”.",
        };
      }
      if (transport.playState !== 0) {
        return {
          reaperOnline: false,
          targetId,
          message: "Stop REAPER playback before accepting a remote production job.",
        };
      }
      return {
        reaperOnline: true,
        targetId,
        message: "Dedicated Story Cue Studio project is ready.",
      };
    } catch (error) {
      return {
        reaperOnline: false,
        targetId: "",
        message: error instanceof Error ? error.message : "REAPER Web Control is offline.",
      };
    }
  }

  async assertTargetReady() {
    const state = await this.readiness();
    if (!state.reaperOnline) throw new Error(state.message);
    return state.targetId;
  }

  async assertTransportTarget() {
    const role = await this.getProject("ProjectRole");
    const targetId = await this.getProject("RemoteTargetId");
    if (role !== STORY_TARGET_ROLE || !targetId) {
      throw new Error("Open a dedicated story project and run “Enable Story Cue Studio Remote Target”.");
    }
    return targetId;
  }

  async assertTargetUnchanged(expectedTargetId) {
    const role = await this.getProject("ProjectRole");
    const targetId = await this.getProject("RemoteTargetId");
    if (role !== STORY_TARGET_ROLE || !targetId || targetId !== expectedTargetId) {
      throw new Error("The active REAPER project changed during the remote job. Processing stopped.");
    }
  }

  async runAction(action) {
    await this.command(action);
    await sleep(250);
  }

  async setEditCursor(seconds) {
    const position = Math.max(0, Math.min(86400, Number(seconds) || 0));
    await this.command(`SET/POS/${position.toFixed(3)}`);
    return position;
  }

  async waitFor(key, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await this.getProject(key);
      if (value === "complete") return value;
      if (value.startsWith("failed:")) throw new Error(value.slice(7));
      await sleep(1000);
    }
    throw new Error(`${key} did not finish before the companion timeout.`);
  }

  async uploadStory(script, mode, requestedRuntime, requestId) {
    if (!/\[VOICE:/i.test(script) || !/\[(?:SFX|AMBIENT|MUSIC):/i.test(script)) {
      throw new Error("Storyboard must contain VOICE directions and at least one production cue.");
    }
    const chunks = encodeStoryChunks(script);
    await this.setProject("InboxReady", "");
    await this.setProject("InboxCount", chunks.length);
    await this.setProject("InboxMode", mode);
    await this.setProject("InboxToken", requestId);
    await this.setProject("RequestedRuntimeMinutes", Number(requestedRuntime) === 7 ? 7 : 3);
    await this.setProject("VoiceDurationSeconds", "");
    for (let index = 0; index < chunks.length; index += 1) {
      await this.setProject(`Inbox${index + 1}`, chunks[index]);
    }
    await this.setProject("ImportStatus", "queued");
    await this.setProject("InboxReady", requestId);
  }

  async importStory(script, mode, requestedRuntime, requestId, targetId) {
    await this.assertTargetUnchanged(targetId);
    await this.uploadStory(script, mode, requestedRuntime, requestId);
    await this.runAction(IMPORT_ACTION);
    await this.waitFor("ImportStatus", 120000);
    const importedToken = await this.getProject("ImportToken");
    if (importedToken !== requestId) {
      throw new Error("REAPER completed a different import token. The remote job was stopped.");
    }
  }

  async preflightCueAssets() {
    if (!this.assetPath) return;
    try {
      await access(this.assetPath);
    } catch {
      throw new Error(`Cue Recall asset project is unavailable: ${this.assetPath}`);
    }
  }

  async runJob(command, {
    allowPaidVoiceGeneration = false,
    onStatus = () => {},
  } = {}) {
    const transportAction = command.action === "transport-play-pause" || command.action === "transport-seek";
    const targetId = transportAction ? await this.assertTransportTarget() : await this.assertTargetReady();
    const status = (state, stage, message, extras = {}) => onStatus({
      state,
      stage,
      message,
      done: state === "complete" || state === "error" || state === "needs_attention",
      error: state === "error" || state === "needs_attention",
      ...extras,
    });

    if (command.action === "story-importer") {
      status("progress", "importing", "Sending the structured storyboard into REAPER…");
      await this.importStory(command.script, "import", command.runtimeMinutes, command.requestId, targetId);
      status("complete", "complete", "Story imported into the dedicated REAPER project.");
      return;
    }

    if (command.action === "cue-recall") {
      await this.assertTargetUnchanged(targetId);
      status("progress", "cue-recall", "Opening Cue Recall on the REAPER computer…");
      await this.runAction(RECALL_ACTION);
      status("complete", "complete", "Cue Recall opened on the REAPER computer.");
      return;
    }

    if (command.action === "elevenlabs") {
      await this.assertTargetUnchanged(targetId);
      status("progress", "voices", "Opening the ElevenLabs voice tool on the REAPER computer…");
      await this.runAction(ELEVEN_ACTION);
      status("complete", "complete", "ElevenLabs voice tool opened. No paid generation was started.");
      return;
    }

    if (command.action === "transport-seek") {
      await this.assertTargetUnchanged(targetId);
      const position = Math.max(0, Math.min(86400, Number(command.cursorSeconds) || 0));
      const copied = await copyTextToMacClipboard(formatReaperTimecode(position));
      if (!copied) throw new Error("Could not copy the HH:MM:SS:FF timecode to the REAPER Mac clipboard.");
      await this.runAction(SEEK_ACTION);
      status("complete", "cursor", `REAPER edit cursor moved to ${Math.floor(position / 60)}:${String(Math.round(position) % 60).padStart(2, "0")}.`);
      return;
    }

    if (command.action === "transport-play-pause") {
      await this.assertTargetUnchanged(targetId);
      status("progress", "transport", "Toggling REAPER playback…");
      await this.runAction(PLAY_PAUSE_ACTION);
      status("complete", "transport", "REAPER Play/Pause command was sent.");
      return;
    }

    if (command.action !== "build-play") throw new Error("Unsupported companion job.");
    if (!allowPaidVoiceGeneration) {
      throw new Error("Paid remote voice generation is locked on the Mac companion. Set ALLOW_PAID_VOICE_GENERATION=true only for the approved demo.");
    }

    await this.preflightCueAssets();
    status("progress", "importing", "Importing the storyboard into the dedicated REAPER project…");
    await this.importStory(command.script, "build_play", command.runtimeMinutes, command.requestId, targetId);
    await this.assertTargetUnchanged(targetId);

    status("progress", "cue-recall", "Matching and applying the approved SFX and Ambient cue stacks…");
    await this.setProject("CueRecallToken", command.requestId);
    await this.setProject("CueRecallStatus", "queued");
    await this.setProject("CueRecallRemoteCommand", "match_apply");
    await this.runAction(RECALL_ACTION);
    await this.waitFor("CueRecallStatus", 900000);
    await this.assertTargetUnchanged(targetId);

    status("progress", "voices", "Cue stacks applied. ElevenLabs is generating the complete cast…");
    await this.setProject("VoiceToken", command.requestId);
    await this.setProject("VoiceStatus", "queued");
    await this.setProjectSection("PodcastVoice", "Autorun", "generate_play");
    await this.runAction(ELEVEN_ACTION);
    await this.waitFor("VoiceStatus", 1800000);
    const actualDurationSeconds = Number(await this.getProject("VoiceDurationSeconds")) || 0;
    const minutes = Math.floor(actualDurationSeconds / 60);
    const seconds = String(Math.round(actualDurationSeconds) % 60).padStart(2, "0");
    const duration = actualDurationSeconds > 0 ? `${minutes}:${seconds}` : "not reported";
    const outsideDemoRange =
      command.runtimeMinutes === 3 &&
      actualDurationSeconds > 0 &&
      (actualDurationSeconds < 165 || actualDurationSeconds > 200);
    status(
      "complete",
      "complete",
      `${command.runtimeMinutes === 3 ? "Three-minute episode" : "Seven-minute storyboard"} built and playback started. Actual voice duration: ${duration}.${outsideDemoRange ? " Target is 2:45–3:20; voices were not time-stretched." : ""}`,
      { actualDurationSeconds },
    );
  }
}
