"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  enforceTrainingCueBank,
  TRAINING_CUE_BANK_META,
  type TrainingCueBankReport,
} from "./training-cue-bank";
import {
  normalizeRuntimeMinutes,
  runtimeProfile,
  type RuntimeMinutes,
} from "./story-runtime";

type Settings = {
  title: string;
  lead: string;
  yourName: string;
  rival: string;
  runtimeMinutes: RuntimeMinutes;
  places: number;
  useMe: boolean;
  musicCueCount: number;
  optimizeCues: boolean;
  ambientRanges: boolean;
  trainingCueBank: boolean;
  elevenModel: string;
  performanceTaste: string;
  narratorVoiceId: string;
  leadVoiceId: string;
  rivalVoiceId: string;
};

type AIProvider = "openai" | "gemini" | "groq" | "compatible";

type ProviderConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

type VoiceOption = {
  voiceId: string;
  name: string;
  category: string | null;
  description: string | null;
  labels: Record<string, string>;
  previewUrl: string | null;
};

type VoiceRole = "narrator" | "lead" | "rival";

type AISettings = {
  provider: AIProvider;
  openai: ProviderConfig;
  gemini: ProviderConfig;
  groq: ProviderConfig;
  compatible: ProviderConfig;
};

type ReaperAction = {
  id: string;
  label: string;
  description: string;
  command: string;
  tone: "lime" | "orange" | "blue" | "purple";
};

type StoryTimelineMarker = {
  seconds: number;
  label: string;
  type: "SFX" | "AMBIENT" | "MUSIC" | "VOICE";
};

type ReaperConnectionMode = "local" | "remote";

type RemoteReaperSettings = {
  relayUrl: string;
  machineId: string;
  pairingToken: string;
};

type RemoteInviteState = "idle" | "accepted" | "expired" | "invalid";

type RemoteInviteResult =
  | { status: "none" | "expired" | "invalid" }
  | {
      status: "accepted";
      settings: RemoteReaperSettings;
      nonce: string;
      issuedAt: number;
      expiresAt: number;
    };

type RemoteReaperState =
  | "disconnected"
  | "connecting"
  | "relay-only"
  | "online"
  | "error";

type RemoteRelayMessage = {
  type?: string;
  machineId?: string;
  requestId?: string;
  online?: boolean;
  reaperOnline?: boolean;
  state?: string;
  stage?: string;
  message?: string;
  done?: boolean;
  error?: boolean;
  actualDurationSeconds?: number;
};

type PendingRemoteCommand = {
  requestId: string;
  action: string;
  machineId: string;
  createdAt: number;
};

type ExpansionBeat = {
  sfx: string;
  music?: string;
  narratorA: (moment: string, lead: string, rival: string) => string;
  lead: string;
  narratorB: (moment: string, lead: string, rival: string) => string;
  rival: string;
  close: (moment: string, lead: string, rival: string) => string;
};

const WORDS_PER_MINUTE = 145;
const REAPER_TIMECODE_FPS = 25;
const AI_STORAGE_KEY = "story-cue-studio-ai-settings-v1";
const VOICE_STORAGE_KEY = "story-cue-studio-voice-settings-v1";
const REMOTE_REAPER_STORAGE_KEY = "story-cue-studio-remote-reaper-v1";
const REMOTE_PENDING_STORAGE_KEY = "story-cue-studio-remote-pending-v1";
const REMOTE_INVITE_SETTINGS_STORAGE_KEY = "story-cue-studio-remote-invite-v1";
const CUE_TAG_PATTERN = /^\s*\[(SFX|AMBIENT|MUSIC):\s*(.*?)\]\s*$/i;
const REMOTE_PROTOCOL_VERSION = 1;
const REMOTE_INVITE_PREFIX = "#reaper-invite=";
const REMOTE_INVITE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REMOTE_INVITE_MAX_LIFETIME_MS = 90 * 60 * 1000;
const REMOTE_INVITE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const PUBLIC_VOICE_LOOKUP_IDS = new Set([
  "cPoqAvGWCPfCfyPMwe4z",
  "si0svtk05vPEuvwAW93c",
]);

const defaultRemoteReaperSettings: RemoteReaperSettings = {
  relayUrl: "",
  machineId: "sruthin-studio",
  pairingToken: "",
};

const elevenModels = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2 · stable long-form" },
  { id: "eleven_v3", label: "Eleven v3 · most expressive" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5 · fastest" },
];

const performanceTastes = [
  { id: "cinematic", label: "Cinematic · controlled tension and dynamic turns" },
  { id: "natural", label: "Natural · conversational and grounded" },
  { id: "intimate", label: "Intimate · close, quiet and emotionally detailed" },
  { id: "dramatic", label: "Dramatic · bold emotion and stronger contrast" },
  { id: "documentary", label: "Documentary · clear, restrained and factual" },
];

const groqModels = [
  {
    id: "openai/gpt-oss-20b",
    label: "Groq Fast · GPT-OSS 20B",
    description: "Best speed for a complete REAPER-ready draft",
  },
  {
    id: "openai/gpt-oss-120b",
    label: "Groq Studio · GPT-OSS 120B",
    description: "More story detail while remaining very fast",
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B · Groq",
    description: "Fast, capable long-form story and cue writing",
  },
] as const;

const openAIModels = [
  {
    id: "gpt-5-nano",
    label: "OpenAI Fast · GPT-5 nano",
    description: "Fastest, most cost-efficient GPT-5 option",
  },
  {
    id: "gpt-5-mini",
    label: "OpenAI Story · GPT-5 mini",
    description: "A stronger fast choice for structured story drafts",
  },
] as const;

const defaultAISettings: AISettings = {
  provider: "openai",
  openai: { apiKey: "", model: "gpt-5-nano", baseUrl: "" },
  gemini: { apiKey: "", model: "gemini-3.6-flash", baseUrl: "" },
  groq: { apiKey: "", model: "openai/gpt-oss-20b", baseUrl: "https://api.groq.com/openai/v1" },
  compatible: { apiKey: "", model: "gpt-5-nano", baseUrl: "https://openrouter.ai/api/v1" },
};

const providerLabels: Record<AIProvider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  groq: "Groq Fast",
  compatible: "Other model",
};

const reaperActions: ReaperAction[] = [
  {
    id: "story-importer",
    label: "Import Story",
    description: "Copy this generated script and import it directly into REAPER.",
    command: "_RS99a1bb9381b40ba9ade9d82fa74add533356b26c",
    tone: "lime",
  },
  {
    id: "cue-recall",
    label: "Recall Cues",
    description: "Open Cue Recall for the imported SFX, ambience, and music cue items.",
    command: "_RS419e01a1897fa99332fb4b216371f2f2cd868122",
    tone: "orange",
  },
  {
    id: "elevenlabs",
    label: "Generate All Voices",
    description: "Generate every imported character voice on its own VO Audio track.",
    command: "_RS9acc96ef9b416e2be08f75b70bc9d0143a5391e3",
    tone: "blue",
  },
  {
    id: "build-play",
    label: "Build Immersive & Play",
    description: "Import, auto-recall the best cue stacks, generate every voice, then start playback.",
    command: "",
    tone: "purple",
  },
];

const transportPlayPauseAction: ReaperAction = {
  id: "transport-play-pause",
  label: "Play / Pause",
  description: "Toggle REAPER playback from the story timeline.",
  command: "_dbab6e45e2cf4c988650dfad12851cc1",
  tone: "purple",
};

const transportSeekAction: ReaperAction = {
  id: "transport-seek",
  label: "Move edit cursor",
  description: "Move the REAPER edit cursor to the selected story moment.",
  command: "_RS905359b5cf6473ddef8a02e350cd4115c357ca1c",
  tone: "blue",
};

const allReaperActions = [...reaperActions, transportPlayPauseAction, transportSeekAction];

const reaperBaseUrls = [
  "http://127.0.0.1:8080",
  "http://127.0.0.1:8089",
];

const expansionBeats: ExpansionBeat[] = [
  {
    sfx: "room shift",
    music: "restrained pulse",
    narratorA: (moment, lead) => `The meaning of the moment did not settle immediately. ${moment} ${lead} replayed every detail, separating what had truly happened from what fear and urgency had added afterward.`,
    lead: "We cannot rush past this. Something important is hiding inside the details, and I want to understand it before we make the next mistake.",
    narratorB: (_moment, lead, rival) => `${rival} watched ${lead} in silence. The pause between them carried its own warning, because both understood that the safest answer and the honest answer might lead in opposite directions.`,
    rival: "Understanding it will not make it harmless. Whatever we decide, we will still have to face the consequence together.",
    close: (_moment, lead) => `${lead} accepted that truth without answering. The situation had changed from a mystery into a choice, and every second of hesitation was quietly narrowing the choices that remained.`,
  },
  {
    sfx: "wall movement",
    narratorA: (moment, lead, rival) => `Pressure built around them in small, unmistakable signs. ${moment} ${lead} noticed the change first, while ${rival} studied the surrounding space for anything that did not belong.`,
    lead: "Stay close and listen. If this is meant to frighten us away, then someone is counting on us to stop asking questions.",
    narratorB: (_moment, lead, rival) => `For the first time, ${rival} looked less certain. Doubt did not weaken the warning in their voice; it made the warning feel earned, sharpened by something they had not yet admitted.`,
    rival: "There is more happening here than you know. If we continue, you may learn why I tried to keep you out of it.",
    close: (_moment, lead, rival) => `The admission opened a distance between ${lead} and ${rival}. It was not betrayal yet, but it was close enough that neither of them could pretend trust would survive without an explanation.`,
  },
  {
    sfx: "object impact",
    music: "suspicion build",
    narratorA: (moment, lead) => `A new piece of the story forced everything into a different shape. ${moment} What had seemed accidental now carried intention, and ${lead} could finally see a pattern running beneath the confusion.`,
    lead: "You knew this could happen. Maybe not every detail, but enough to recognize the pattern when it started.",
    narratorB: (_moment, lead, rival) => `${rival} did not deny it. Their expression tightened as if the truth had been waiting behind their teeth, dangerous not because it was complicated, but because it was simple.`,
    rival: "I knew there was a risk. I did not know you would be placed at the center of it, and I was trying to buy us time.",
    close: (_moment, lead) => `Time had been purchased with silence, and the price was now visible. ${lead} felt anger rise, but beneath it was a colder realization: the threat was already close enough to act.`,
  },
  {
    sfx: "approach footstep",
    narratorA: (moment, lead, rival) => `The next decision arrived before either of them was ready. ${moment} ${lead} and ${rival} heard the world around them become suddenly still, the kind of stillness that comes just before movement.`,
    lead: "We choose now. We can keep reacting to whatever comes through that door, or we can move first and control where this ends.",
    narratorB: (_moment, lead, rival) => `${rival} measured the proposal against every danger they had avoided naming. Running promised temporary safety. Moving forward promised answers, but it also removed the protection of uncertainty.`,
    rival: "If we move first, there is no going back to the life we had before tonight. Be certain that the truth is worth that cost.",
    close: (_moment, lead) => `${lead} was not certain. Certainty belonged to people with complete information, and they had almost none. What remained was resolve—the willingness to act while fear argued for delay.`,
  },
  {
    sfx: "electric pulse",
    music: "dark action",
    narratorA: (moment, lead) => `Their plan survived only until the world pushed back. ${moment} The response was faster and more precise than ${lead} expected, turning a careful approach into a race against consequences already in motion.`,
    lead: "Keep moving. Do not let the noise decide where you look. The real danger is using it to pull our attention away.",
    narratorB: (_moment, lead, rival) => `${rival} followed the instruction, covering the angle ${lead} could not see. For a brief stretch they moved as one unit, old distrust forced aside by the immediate need to survive.`,
    rival: "I see it. There is another route ahead, but once we take it, we will be exposed until we reach the other side.",
    close: (_moment, lead, rival) => `They committed without counting down. ${lead} moved first and ${rival} stayed close, while the pressure behind them grew loud enough to erase every thought except the next necessary step.`,
  },
  {
    sfx: "heavy impact",
    narratorA: (moment, lead, rival) => `At the height of the struggle, the assumption guiding them finally broke. ${moment} ${lead} saw the hidden connection, and ${rival} understood from their expression that the entire conflict had changed.`,
    lead: "This was never only about stopping us. We were being pushed toward this exact place, and we followed the path they prepared.",
    narratorB: (_moment, lead, rival) => `${rival} turned toward the evidence with new fear. Every earlier warning now sounded different, not like an attempt to escape danger, but like part of the mechanism that had delivered them to it.`,
    rival: "Then we stop playing the role they gave us. We change the ending now, while they still believe we are trapped.",
    close: (_moment, lead) => `${lead} felt the balance shift. They were still outmatched, but surprise no longer belonged entirely to the other side. One honest decision could become the advantage they had been missing.`,
  },
  {
    sfx: "structure strain",
    music: "climactic tension",
    narratorA: (moment, lead, rival) => `The final confrontation gathered every unresolved choice into one place. ${moment} ${lead} stepped forward while ${rival} held the remaining route open, each trusting the other with a different part of the outcome.`,
    lead: "You wanted us divided and uncertain. That part worked. But you also gave us enough time to understand what matters, and that is the mistake you cannot take back.",
    narratorB: (_moment, lead, rival) => `${rival} answered with action rather than reassurance. The last barrier gave way, and the sound rolled through the space as the plan changed from possibility into irreversible motion.`,
    rival: "Finish it. I will hold this position for as long as you need, but you only get one chance to make the truth impossible to hide.",
    close: (_moment, lead) => `${lead} used that chance. Fear remained, loud and physical, but it no longer controlled the direction of the story. The decisive act belonged to the person who had once entered without answers.`,
  },
  {
    sfx: "air release",
    narratorA: (moment, lead, rival) => `When the immediate danger passed, silence returned in a gentler form. ${moment} ${lead} and ${rival} stood among the consequences, changed by what they had learned and by what they had chosen to protect.`,
    lead: "I thought the answer would make everything simple. It did not. But at least the next decision will belong to us.",
    narratorB: (_moment, lead, rival) => `${rival} looked toward the way back. Home still existed, but neither of them could return as the people they had been before the first warning disturbed the ordinary shape of the day.`,
    rival: "Then we tell the story honestly. Not because honesty fixes the damage, but because silence is what allowed it to grow.",
    close: (_moment, lead, rival) => `${lead} nodded, and together they moved toward what came next. The mystery had ended, but its meaning would continue through every choice ${lead} and ${rival} made after leaving that place.`,
  },
];

const sample = `Maya heard the phone ring in the abandoned station. Rain hammered the glass roof while she searched for the source. A familiar voice came through the receiver and warned her not to open the locked platform door. She opened it anyway. Beyond the door, Elias waited in the dark, holding her missing brother's jacket.`;

function clean(value: string, fallback: string) {
  return value.trim() || fallback;
}

function leadCharacterName(settings: Settings) {
  return settings.useMe
    ? clean(settings.yourName, "You")
    : clean(settings.lead, "Lead");
}

function spokenWordCount(script: string) {
  return script
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("[") && !/^EPISODE\b/i.test(trimmed);
    })
    .join(" ")
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length || 0;
}

function formatTimelineTime(seconds: number) {
  const rounded = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatReaperTimecode(seconds: number) {
  const frames = Math.max(0, Math.round((Number(seconds) || 0) * REAPER_TIMECODE_FPS));
  const frame = frames % REAPER_TIMECODE_FPS;
  const wholeSeconds = Math.floor(frames / REAPER_TIMECODE_FPS);
  const second = wholeSeconds % 60;
  const wholeMinutes = Math.floor(wholeSeconds / 60);
  const minute = wholeMinutes % 60;
  const hour = Math.floor(wholeMinutes / 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}:${String(frame).padStart(2, "0")}`;
}

function createStoryTimelineMarkers(script: string): StoryTimelineMarker[] {
  let spokenWords = 0;
  const markers: StoryTimelineMarker[] = [];
  for (const line of script.split(/\r?\n/)) {
    const match = line.match(/^\s*\[(SFX|AMBIENT|MUSIC|VOICE):\s*(.*?)\]\s*$/i);
    if (match) {
      const type = match[1].toUpperCase() as StoryTimelineMarker["type"];
      const detail = match[2].replace(/\s*\|\s*(?:START|END)\s*$/i, "").trim();
      markers.push({
        seconds: (spokenWords / WORDS_PER_MINUTE) * 60,
        label: detail || type,
        type,
      });
      continue;
    }
    if (line.trim() && !/^EPISODE\b/i.test(line)) spokenWords += spokenWordCount(line);
  }
  return markers.filter((marker, index) => index < 32 && marker.type !== "VOICE");
}

function limitProseWords(value: string, maximum: number) {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maximum) return value;
  return `${words.slice(0, maximum).join(" ").replace(/[,:;—-]+$/, "")}.`;
}

function fitLocalScriptToRuntime(script: string, settings: Settings) {
  const profile = runtimeProfile(settings.runtimeMinutes);
  if (profile.maxWords === null) return script;
  const lines = script.split(/\r?\n/);
  let total = spokenWordCount(script);
  for (let index = lines.length - 1; index >= 0 && total > profile.maxWords; index -= 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("[") || /^EPISODE\b/i.test(line)) continue;
    const lineWords = line.split(/\s+/).filter(Boolean);
    const excess = total - profile.maxWords;
    if (lineWords.length > excess + 8) {
      const keep = lineWords.length - excess;
      lines[index] = `${lineWords.slice(0, keep).join(" ").replace(/[,:;—-]+$/, "").replace(/[.!?]+$/, "")}.`;
      total = profile.maxWords;
      break;
    }
    if (total - lineWords.length >= profile.minWords) {
      lines[index] = "";
      if (/^\s*\[VOICE:/i.test(lines[index - 1] || "")) lines[index - 1] = "";
      total -= lineWords.length;
    }
  }
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n");
}

const sfxStopWords = new Set([
  "a", "an", "the", "and", "or", "of", "to", "with", "without", "in", "on", "at", "by", "for", "from",
  "into", "over", "under", "up", "down", "back", "front", "near", "far", "as", "while", "when", "then",
  "just", "only", "very", "really", "suddenly", "quietly", "loudly", "slowly", "quickly", "tense",
  "heavy", "light", "soft", "hard", "fast", "slow", "sound", "noise", "effect", "accent",
]);

const sfxWordMap: Record<string, string> = {
  breathing: "breath", breathes: "breath", breaths: "breath", creaking: "creak", creaks: "creak",
  footsteps: "footstep", squealing: "squeak", squeaking: "squeak", screeching: "screech",
  thumping: "impact", thump: "impact", banging: "impact", bang: "impact", clanging: "clang",
  clank: "clang", knocking: "knock", knocks: "knock", slamming: "slam", slams: "slam",
  crashing: "crash", crashes: "crash", scraping: "scrape", scrapes: "scrape", rattling: "rattle",
  rattles: "rattle", rustling: "rustle", rustles: "rustle", gasping: "gasp", gasps: "gasp",
  panting: "pant", pants: "pant", running: "run", walking: "walk", hitting: "hit",
  punching: "punch", moving: "move", movement: "move", heartbeat: "heart beat",
};

const sfxActions = new Set([
  "impact", "whoosh", "creak", "squeak", "scrape", "slam", "crack", "shatter", "crash", "thud",
  "bang", "knock", "hit", "punch", "rattle", "rustle", "hiss", "gasp", "pant", "move", "splash",
  "ring", "vibrate", "footstep", "pulse", "strain", "release",
]);

function optimizeSfxChunk(chunk: string) {
  const rawTokens = chunk.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  for (const raw of rawTokens) {
    if (sfxStopWords.has(raw)) continue;
    let mapped = sfxWordMap[raw] || raw;
    if (!sfxWordMap[raw] && mapped.endsWith("ing") && mapped.length > 5) mapped = mapped.slice(0, -3);
    mapped.split(/\s+/).forEach((part) => {
      if (part && !sfxStopWords.has(part) && !tokens.includes(part)) tokens.push(part);
    });
  }
  if (!tokens.length) return "action detail";
  const action = tokens.find((token) => sfxActions.has(token));
  if (action) {
    const subject = tokens.find((token) => token !== action);
    return subject ? `${subject} ${action}` : `human ${action}`;
  }
  return tokens.slice(0, 2).join(" ");
}

function optimizeSfxBody(body: string) {
  const chunks = body.split(/,|\bor\b/i).map(optimizeSfxChunk).filter(Boolean);
  return Array.from(new Set(chunks)).slice(0, 3).join(", ");
}

function optimizeAmbientBody(body: string) {
  const state = body.match(/\|\s*(START|END)\s*$/i)?.[1]?.toUpperCase() || "";
  const normalized = body.replace(/\|\s*(?:START|END)\s*$/i, "").toLowerCase()
    .replace(/\b(place|main|story|location|continuous|low|under|voice|contrasting|inner|reveal|quieter|intimate|returns?|fade|in|out|ambience|atmosphere|background)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const location = normalized.split(" ").filter(Boolean).slice(0, 3).join(" ") || "quiet interior";
  return `${location}${state ? ` | ${state}` : ""}`;
}

function optimizeMusicBody(body: string) {
  if (/\bScene\s*:/i.test(body) && /\bMood\s*:/i.test(body)) return body;
  const searchable = body.toLowerCase()
    .replace(/\b(enter|fade|in|out|low|full|bed|music|cue)\b/g, " ")
    .replace(/[^a-z0-9\s,]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "restrained cinematic tension";
  return `Scene: Story transition | Summary: Emotional direction changes | Mood: ${searchable} | Search: cinematic ${searchable} evolving arc`;
}

function optimizeCueScriptLocally(script: string) {
  return script.split(/\r?\n/).map((line) => {
    const match = line.match(CUE_TAG_PATTERN);
    if (!match) return line;
    const type = match[1].toUpperCase();
    const body = match[2];
    if (type === "SFX") return `[SFX: ${optimizeSfxBody(body)}]`;
    if (type === "AMBIENT") return `[AMBIENT: ${optimizeAmbientBody(body)}]`;
    return `[MUSIC: ${optimizeMusicBody(body)}]`;
  }).join("\n");
}

function stripAmbientRangeMarkers(script: string) {
  return script.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*\[AMBIENT:\s*(.*?)\]\s*$/i);
    if (!match) return [line];
    const state = match[1].match(/\|\s*(START|END)\s*$/i)?.[1]?.toUpperCase();
    if (state === "END") return [];
    const location = match[1].replace(/\|\s*START\s*$/i, "").trim();
    return [`[AMBIENT: ${location}]`];
  }).join("\n");
}

function applyAmbientRangesLocally(script: string) {
  const lines = stripAmbientRangeMarkers(script).split(/\r?\n/);
  const starts = lines.flatMap((line, index) => /^\s*\[AMBIENT:\s*(.*?)\]\s*$/i.test(line) ? [index] : []);
  if (!starts.length) return script;
  const insertions = starts.map((startIndex, order) => {
    const location = lines[startIndex].match(/^\s*\[AMBIENT:\s*(.*?)\]\s*$/i)?.[1]?.trim() || "location";
    const hardEnd = (starts[order + 1] ?? lines.length) - 1;
    let endIndex = hardEnd;
    for (let index = hardEnd; index > startIndex; index -= 1) {
      const trimmed = lines[index].trim();
      if (trimmed && !trimmed.startsWith("[") && !/^EPISODE\b/i.test(trimmed)) {
        endIndex = index;
        break;
      }
    }
    lines[startIndex] = `[AMBIENT: ${location} | START]`;
    return { endIndex, marker: `[AMBIENT: ${location} | END]` };
  });
  insertions.sort((a, b) => b.endIndex - a.endIndex).forEach(({ endIndex, marker }) => {
    lines.splice(endIndex + 1, 0, marker);
  });
  return lines.join("\n");
}

type GeneratedCuePreparation = {
  script: string;
  cueBank?: TrainingCueBankReport;
  optimized: boolean;
  ranged: boolean;
};

/**
 * Keep the final hand-off deterministic. AI providers are asked to produce
 * search-ready cues and semantic ambient ranges, but this browser-side pass
 * makes the Generate button apply exactly the same policy to local and AI
 * scripts before either one reaches REAPER.
 */
function prepareGeneratedCueScript(script: string, settings: Settings): GeneratedCuePreparation {
  let prepared = script;
  if (settings.optimizeCues) prepared = optimizeCueScriptLocally(prepared);
  if (settings.ambientRanges) {
    prepared = applyAmbientRangesLocally(prepared);
  } else {
    // A provider can still return range markers despite the prompt. Keep the
    // disabled setting authoritative for both local and AI-generated scripts.
    prepared = stripAmbientRangeMarkers(prepared);
  }
  const constrained = settings.trainingCueBank
    ? enforceTrainingCueBank(prepared)
    : undefined;
  return {
    script: constrained?.script || prepared,
    cueBank: constrained?.report,
    optimized: settings.optimizeCues,
    ranged: settings.ambientRanges,
  };
}

function cuePreparationStatus(preparation: GeneratedCuePreparation) {
  const stages = [
    preparation.optimized ? "search-ready SFX, Ambient, and Music cues" : "",
    preparation.ranged ? "Ambient START/END ranges" : "",
  ].filter(Boolean);
  return stages.length ? ` Cue prep: ${stages.join(" + ")}.` : "";
}

function inferAmbientLocation(story: string, fallback: string) {
  const lower = story.toLowerCase();
  const locations = [
    "abandoned train station", "underground tunnel", "hospital room", "city street", "forest trail",
    "office interior", "family kitchen", "bedroom interior", "market crowd", "airport terminal",
    "railway platform", "warehouse interior", "apartment interior", "school hallway",
  ];
  return locations.find((location) => location.split(" ").some((word) => lower.includes(word))) || fallback;
}

const localMusicBriefs = [
  ["Opening uncertainty", "The ordinary world becomes unsafe", "tense, restrained", "sparse piano pulse building quiet suspicion"],
  ["First warning", "A discovery raises the emotional stakes", "uneasy, mysterious", "low strings and distant piano with a cautious rise"],
  ["Trust fractures", "The two characters begin doubting each other", "suspicious, intimate", "minimal cello pulse tightening beneath fragile piano"],
  ["Choice point", "The lead commits to a dangerous course", "determined, urgent", "restrained percussion and rising strings gathering momentum"],
  ["Hidden truth", "New evidence reverses the meaning of events", "shocked, ominous", "dark orchestral reveal with falling piano and low brass"],
  ["Final confrontation", "The central conflict reaches its decisive action", "intense, defiant", "driving cinematic strings swelling toward a sharp climax"],
  ["Aftermath", "The danger recedes but its emotional cost remains", "reflective, bittersweet", "warm solo piano resolving into a fragile final chord"],
];

function musicCue(index: number) {
  const cue = localMusicBriefs[index % localMusicBriefs.length];
  return `[MUSIC: Scene: ${cue[0]} | Summary: ${cue[1]} | Mood: ${cue[2]} | Search: ${cue[3]}]`;
}

function voiceLine(
  lines: string[],
  settings: Settings,
  speaker: string,
  type: "narration" | "dialogue",
  text: string,
  emotion = "tension",
  intensity = 2,
  pace = "normal",
) {
  const lead = leadCharacterName(settings);
  const rival = clean(settings.rival, "Rival");
  const voiceId = speaker === "Narrator"
    ? settings.narratorVoiceId
    : speaker === lead
      ? settings.leadVoiceId
      : speaker === rival
        ? settings.rivalVoiceId
        : "";
  const tasteDelivery = settings.performanceTaste === "intimate"
    ? "whispering"
    : settings.performanceTaste === "dramatic" && emotion !== "neutral"
      ? "urgent"
      : "restrained";
  const identity = voiceId.trim() ? ` | voice_id=${voiceId.trim()}` : "";
  lines.push(
    `[VOICE: speaker=${speaker} | type=${type} | emotion=${emotion} | intensity=${intensity} | delivery=${tasteDelivery} | pace=${pace}${identity} | model_id=${settings.elevenModel} | performance_taste=${settings.performanceTaste}]`,
    text,
    "",
  );
}

function localStoryboard(story: string, settings: Settings) {
  const profile = runtimeProfile(settings.runtimeMinutes);
  const lead = leadCharacterName(settings);
  const rival = clean(settings.rival, "Rival");
  const runtimeStory = settings.runtimeMinutes === 3 ? limitProseWords(story, 90) : story;
  const sentences = runtimeStory.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [runtimeStory];
  const safeMoments = sentences.map((sentence) => sentence.replace(/\[[^\]]+\]/g, "").replace(/[“”"]/g, "").trim()).filter(Boolean);
  const placeOne = inferAmbientLocation(story, "quiet interior");
  const placeTwo = inferAmbientLocation(
    story.replace(new RegExp(placeOne.split(" ").join("|"), "gi"), ""),
    "hidden service corridor",
  );
  const musicCueCount = Math.max(1, Math.min(20, settings.musicCueCount || 7));
  let musicIndex = 0;
  let activeAmbient = placeOne;
  const lines = [
    `EPISODE — ${clean(settings.title, "UNTITLED STORY").toUpperCase()}`,
    "",
    `[AMBIENT: ${placeOne}]`,
    musicCue(musicIndex++),
    "",
  ];

  sentences.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    const lower = text.toLowerCase();
    const isLead = lower.includes(lead.toLowerCase());
    const isRival = lower.includes(rival.toLowerCase());
    if (index > 0 && settings.places === 2 && index === Math.floor(sentences.length / 2)) {
      activeAmbient = placeTwo;
      lines.push("[SFX: transition whoosh]", `[AMBIENT: ${placeTwo}]`, "");
    }
    if (/(door|gun|phone|step|footstep|rain|hit|crash|knock|ring)/.test(lower)) {
      const cue = lower.includes("phone") || lower.includes("ring")
        ? "phone ring, phone vibrate"
        : lower.includes("rain")
          ? "glass rain"
          : lower.includes("door")
            ? "door handle, door open"
            : lower.includes("step")
              ? "person footstep"
              : "object impact";
      lines.push(`[SFX: ${cue}]`);
    }
    if (isLead && /["“]/.test(text)) {
      voiceLine(lines, settings, lead, "dialogue", text.replace(/[“”"]/g, ""), "tension", 2);
    } else if (isRival && /["“]/.test(text)) {
      voiceLine(lines, settings, rival, "dialogue", text.replace(/[“”"]/g, ""), "sarcasm", 2);
    } else {
      const emotion = /(fear|dark|warning|danger|locked|abandoned|missing|rain)/.test(lower) ? "tension" : /(smile|laugh|happy)/.test(lower) ? "joy" : "neutral";
      voiceLine(lines, settings, "Narrator", "narration", text, emotion, emotion === "neutral" ? 1 : 2);
    }
  });

  let beatIndex = 0;
  while (spokenWordCount(lines.join("\n")) < profile.minWords || musicIndex < musicCueCount - 1) {
    const beat = expansionBeats[beatIndex % expansionBeats.length];
    const moment = safeMoments[beatIndex % safeMoments.length] || "The situation changed before either person was ready.";
    if (musicIndex < musicCueCount - 1) lines.push(musicCue(musicIndex++));
    if (settings.places === 2 && beatIndex === 3 && activeAmbient !== placeTwo) {
      activeAmbient = placeTwo;
      lines.push("[SFX: transition whoosh]", `[AMBIENT: ${placeTwo}]`);
    }
    lines.push(`[SFX: ${beat.sfx}]`);
    voiceLine(lines, settings, "Narrator", "narration", beat.narratorA(moment, lead, rival));
    voiceLine(lines, settings, lead, "dialogue", beat.lead, "determination", 2);
    voiceLine(lines, settings, "Narrator", "narration", beat.narratorB(moment, lead, rival));
    voiceLine(lines, settings, rival, "dialogue", beat.rival, "tension", 2);
    voiceLine(lines, settings, "Narrator", "narration", beat.close(moment, lead, rival));
    beatIndex += 1;
  }

  if (musicIndex < musicCueCount) lines.push(musicCue(musicIndex));
  return fitLocalScriptToRuntime(lines.join("\n"), settings);
}

function cueBankStatus(report?: TrainingCueBankReport) {
  if (!report || report.total === 0) return "";
  const covered = report.total - report.novel;
  return ` Training bank: ${covered}/${report.total} SFX and Ambient cues covered; ${report.novel} new.`;
}

function cloneAISettings(settings: AISettings): AISettings {
  return {
    provider: settings.provider,
    openai: { ...settings.openai },
    gemini: { ...settings.gemini },
    groq: { ...settings.groq },
    compatible: { ...settings.compatible },
  };
}

function normalizeRelayUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter the secure WebSocket relay URL.");
  if (trimmed.length > 2048) throw new Error("The relay URL is too long.");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid WebSocket relay URL.");
  }
  if (url.username || url.password) {
    throw new Error("Do not place usernames or passwords in the relay URL.");
  }
  const localDevelopment =
    url.protocol === "ws:" &&
    (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  if (url.protocol !== "wss:" && !localDevelopment) {
    throw new Error("Internet relay URLs must begin with wss://.");
  }
  if (url.hash) throw new Error("The relay URL cannot contain a fragment.");
  return url.toString();
}

function validateRemoteReaperSettings(settings: RemoteReaperSettings) {
  const relayUrl = normalizeRelayUrl(settings.relayUrl);
  const machineId = settings.machineId.trim();
  const pairingToken = settings.pairingToken.trim();
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(machineId)) {
    throw new Error("Machine ID must be 3–64 letters, numbers, underscores, or dashes.");
  }
  if (pairingToken.length < 16) {
    throw new Error("Use a pairing token containing at least 16 characters.");
  }
  if (pairingToken.length > 256) {
    throw new Error("Pairing tokens cannot exceed 256 characters.");
  }
  if (!/^[\x21-\x7e]+$/.test(pairingToken)) {
    throw new Error("Pairing tokens must contain printable characters without spaces.");
  }
  return { relayUrl, machineId, pairingToken };
}

function decodeRemoteInvitePayload(encoded: string): unknown {
  if (
    encoded.length < 32 ||
    encoded.length > 8192 ||
    encoded.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded)
  ) {
    throw new Error("Invalid invite encoding.");
  }
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    encoded.length + ((4 - (encoded.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  if (binary.length > 4096) throw new Error("Invite payload is too large.");
  const canonical = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
  if (canonical !== encoded) throw new Error("Invalid invite encoding.");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function parseRemoteReaperInviteFragment(
  fragment: string,
  now = Date.now(),
): RemoteInviteResult {
  if (!fragment.startsWith(REMOTE_INVITE_PREFIX)) return { status: "none" };
  try {
    const value = decodeRemoteInvitePayload(fragment.slice(REMOTE_INVITE_PREFIX.length));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { status: "invalid" };
    }
    const payload = value as Record<string, unknown>;
    const requiredKeys = [
      "version",
      "relayUrl",
      "machineId",
      "token",
      "nonce",
      "issuedAt",
      "expiresAt",
    ].sort();
    const payloadKeys = Object.keys(payload).sort();
    if (
      payloadKeys.length !== requiredKeys.length ||
      !requiredKeys.every((key, index) => payloadKeys[index] === key)
    ) {
      return { status: "invalid" };
    }
    if (payload.version !== REMOTE_PROTOCOL_VERSION) return { status: "invalid" };
    if (
      typeof payload.relayUrl !== "string" ||
      typeof payload.machineId !== "string" ||
      typeof payload.token !== "string" ||
      typeof payload.nonce !== "string"
    ) {
      return { status: "invalid" };
    }
    if (
      payload.relayUrl !== payload.relayUrl.trim() ||
      payload.machineId !== payload.machineId.trim() ||
      payload.token !== payload.token.trim()
    ) {
      return { status: "invalid" };
    }
    const nonce = payload.nonce;
    if (!/^[A-Za-z0-9_-]{22,128}$/.test(nonce)) return { status: "invalid" };
    if (
      payload.token.length < 43 ||
      payload.token.length > 256 ||
      !/^[A-Za-z0-9_-]+$/.test(payload.token)
    ) {
      return { status: "invalid" };
    }
    const inviteRelayUrl = new URL(payload.relayUrl);
    if (inviteRelayUrl.search || inviteRelayUrl.hash) return { status: "invalid" };
    const issuedAt = payload.issuedAt;
    const expiresAt = payload.expiresAt;
    if (
      typeof issuedAt !== "number" ||
      typeof expiresAt !== "number" ||
      !Number.isSafeInteger(issuedAt) ||
      !Number.isSafeInteger(expiresAt) ||
      issuedAt < 1_704_067_200_000 ||
      issuedAt > now + REMOTE_INVITE_CLOCK_SKEW_MS ||
      issuedAt < now - REMOTE_INVITE_MAX_AGE_MS ||
      expiresAt <= issuedAt ||
      expiresAt - issuedAt > REMOTE_INVITE_MAX_LIFETIME_MS
    ) {
      return { status: "invalid" };
    }
    const settings = validateRemoteReaperSettings({
      relayUrl: payload.relayUrl,
      machineId: payload.machineId,
      pairingToken: payload.token,
    });
    if (expiresAt <= now) return { status: "expired" };
    return {
      status: "accepted",
      settings,
      nonce,
      issuedAt,
      expiresAt,
    };
  } catch {
    return { status: "invalid" };
  }
}

function generatePairingToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function generateRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${generatePairingToken().slice(0, 16)}`;
}

function formatRemoteDuration(value: number | undefined) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (!seconds) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function remoteCompletionLimit(action: string) {
  return action === "build-play" ? 35 * 60 * 1000 : 3 * 60 * 1000;
}

export default function Home() {
  const [story, setStory] = useState(sample);
  const [settings, setSettings] = useState<Settings>({
    title: "The Last Signal",
    lead: "Maya",
    yourName: "",
    rival: "Elias",
    runtimeMinutes: 3,
    places: 2,
    useMe: false,
    musicCueCount: 4,
    optimizeCues: true,
    ambientRanges: true,
    trainingCueBank: true,
    elevenModel: "eleven_multilingual_v2",
    performanceTaste: "cinematic",
    narratorVoiceId: "cPoqAvGWCPfCfyPMwe4z",
    leadVoiceId: "si0svtk05vPEuvwAW93c",
    rivalVoiceId: "",
  });
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("Ready to shape a three-minute demo or a seven-minute episode.");
  const [copied, setCopied] = useState(false);
  const [timelineCursorSeconds, setTimelineCursorSeconds] = useState(0);
  const [timelineScrubbing, setTimelineScrubbing] = useState(false);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [ranging, setRanging] = useState(false);
  const [runningReaperAction, setRunningReaperAction] = useState<string | null>(null);
  const [reaperStatus, setReaperStatus] = useState("Open REAPER before using these buttons.");
  const [reaperMode, setReaperMode] = useState<ReaperConnectionMode>("local");
  const [remoteSettings, setRemoteSettings] = useState<RemoteReaperSettings>(defaultRemoteReaperSettings);
  const [draftRemoteSettings, setDraftRemoteSettings] = useState<RemoteReaperSettings>(defaultRemoteReaperSettings);
  const [remoteState, setRemoteState] = useState<RemoteReaperState>("disconnected");
  const [remoteStateMessage, setRemoteStateMessage] = useState("Add a secure relay URL to control REAPER from another network.");
  const [remoteConnectRevision, setRemoteConnectRevision] = useState(0);
  const [remoteInviteState, setRemoteInviteState] = useState<RemoteInviteState>("idle");
  const [remoteInviteMessage, setRemoteInviteMessage] = useState(
    "Guests only need the private invite link from the REAPER Mac. No relay address, machine ID, or token typing is required.",
  );
  const [isEmbeddedBridge, setIsEmbeddedBridge] = useState(false);
  const [aiSettings, setAISettings] = useState<AISettings>(cloneAISettings(defaultAISettings));
  const [draftAISettings, setDraftAISettings] = useState<AISettings>(cloneAISettings(defaultAISettings));
  const [aiSettingsOpen, setAISettingsOpen] = useState(false);
  const [showAPIKey, setShowAPIKey] = useState(false);
  const [aiSettingsStatus, setAISettingsStatus] = useState("");
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [voiceCatalogState, setVoiceCatalogState] = useState<"loading" | "ready" | "error">("loading");
  const [voiceCatalogMessage, setVoiceCatalogMessage] = useState("Loading ElevenLabs voices…");
  const [voiceCatalogRevision, setVoiceCatalogRevision] = useState(0);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voiceRole, setVoiceRole] = useState<VoiceRole>("narrator");
  const [voiceLimit, setVoiceLimit] = useState(12);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const leadName = leadCharacterName(settings);
  const rivalName = clean(settings.rival, "Rival");
  const characters = useMemo(() => [leadName, rivalName], [leadName, rivalName]);
  const outputWords = useMemo(() => spokenWordCount(output), [output]);
  const outputMinutes = outputWords ? (outputWords / WORDS_PER_MINUTE).toFixed(1) : "0.0";
  const timelineDurationSeconds = Math.max(1, (outputWords / WORDS_PER_MINUTE) * 60);
  const storyTimelineMarkers = useMemo(() => createStoryTimelineMarkers(output), [output]);
  const activeProviderConfig = aiSettings[aiSettings.provider];
  const draftProviderConfig = draftAISettings[draftAISettings.provider];
  const selectedRuntime = runtimeProfile(settings.runtimeMinutes);
  const selectedVoiceIds = [
    settings.narratorVoiceId,
    settings.leadVoiceId,
    settings.rivalVoiceId,
  ]
    .map((voiceId) => voiceId.trim())
    .filter((voiceId, index, values) =>
      PUBLIC_VOICE_LOOKUP_IDS.has(voiceId) && values.indexOf(voiceId) === index,
    )
    .slice(0, 3)
    .join(",");
  const voiceById = useMemo(
    () => new Map(voiceOptions.map((voice) => [voice.voiceId, voice])),
    [voiceOptions],
  );
  const filteredVoiceOptions = useMemo(() => {
    const needle = voiceSearch.trim().toLowerCase();
    if (!needle) return voiceOptions;
    return voiceOptions.filter((voice) =>
      [
        voice.name,
        voice.category,
        voice.description,
        ...Object.values(voice.labels),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [voiceOptions, voiceSearch]);
  const remoteSocketRef = useRef<WebSocket | null>(null);
  const remoteRequestRef = useRef<string | null>(null);
  const remotePendingRef = useRef<PendingRemoteCommand | null>(null);
  const remoteAckTimerRef = useRef<number | null>(null);
  const remoteCompletionTimerRef = useRef<number | null>(null);
  const remoteReconnectAttemptRef = useRef(0);
  const remoteInviteActiveRef = useRef(false);
  const voicePreviewRef = useRef<HTMLAudioElement | null>(null);

  const cancelPendingRemoteCommand = useCallback((message?: string) => {
    if (remoteAckTimerRef.current !== null) {
      window.clearTimeout(remoteAckTimerRef.current);
      remoteAckTimerRef.current = null;
    }
    if (remoteCompletionTimerRef.current !== null) {
      window.clearTimeout(remoteCompletionTimerRef.current);
      remoteCompletionTimerRef.current = null;
    }
    remoteRequestRef.current = null;
    remotePendingRef.current = null;
    if (typeof window !== "undefined") sessionStorage.removeItem(REMOTE_PENDING_STORAGE_KEY);
    setRunningReaperAction(null);
    if (message) setReaperStatus(message);
  }, []);

  const armRemoteCompletionTimer = useCallback((pending: PendingRemoteCommand) => {
    if (remoteCompletionTimerRef.current !== null) {
      window.clearTimeout(remoteCompletionTimerRef.current);
      remoteCompletionTimerRef.current = null;
    }
    const remaining = remoteCompletionLimit(pending.action) - (Date.now() - pending.createdAt);
    if (remaining <= 0) {
      cancelPendingRemoteCommand(
        "Remote REAPER did not report completion in time. The outcome is unknown; inspect the Mac before trying again.",
      );
      return;
    }
    remoteCompletionTimerRef.current = window.setTimeout(() => {
      if (remoteRequestRef.current !== pending.requestId) return;
      cancelPendingRemoteCommand(
        "Remote REAPER did not report completion in time. The outcome is unknown; inspect the Mac before trying again.",
      );
    }, remaining);
  }, [cancelPendingRemoteCommand]);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(AI_STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved) as Partial<AISettings>;
        const restored: AISettings = {
          provider: parsed.provider === "gemini" || parsed.provider === "groq" || parsed.provider === "compatible" ? parsed.provider : "openai",
          openai: { ...defaultAISettings.openai, ...(parsed.openai || {}) },
          gemini: { ...defaultAISettings.gemini, ...(parsed.gemini || {}) },
          groq: { ...defaultAISettings.groq, ...(parsed.groq || {}) },
          compatible: { ...defaultAISettings.compatible, ...(parsed.compatible || {}) },
        };
        setAISettings(restored);
        setDraftAISettings(cloneAISettings(restored));
      } catch {
        localStorage.removeItem(AI_STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    setTimelineCursorSeconds((current) => Math.min(current, timelineDurationSeconds));
  }, [timelineDurationSeconds]);

  useEffect(() => {
    const inviteFragment = window.location.hash.startsWith(REMOTE_INVITE_PREFIX)
      ? window.location.hash
      : "";
    let inviteFragmentRemoved = !inviteFragment;
    if (inviteFragment) {
      try {
        window.history.replaceState(
          window.history.state,
          document.title,
          `${window.location.pathname}${window.location.search}`,
        );
        inviteFragmentRemoved = true;
      } catch {
        inviteFragmentRemoved = false;
      }
    }

    const restore = window.setTimeout(() => {
      const embeddedBridge = window.parent !== window;
      setIsEmbeddedBridge(embeddedBridge);
      let savedSettings = defaultRemoteReaperSettings;
      let savedMode: ReaperConnectionMode = "local";
      try {
        const saved = localStorage.getItem(REMOTE_REAPER_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as {
            mode?: ReaperConnectionMode;
            settings?: Partial<RemoteReaperSettings>;
          };
          const restored = {
            relayUrl: String(parsed.settings?.relayUrl || ""),
            machineId: String(parsed.settings?.machineId || defaultRemoteReaperSettings.machineId),
            pairingToken: String(parsed.settings?.pairingToken || ""),
          };
          savedSettings = restored;
          savedMode = parsed.mode === "remote" ? "remote" : "local";
        }
      } catch {
        localStorage.removeItem(REMOTE_REAPER_STORAGE_KEY);
      }

      let pendingText = "";
      let storedInvite = "";
      try {
        pendingText = sessionStorage.getItem(REMOTE_PENDING_STORAGE_KEY) || "";
        storedInvite = sessionStorage.getItem(REMOTE_INVITE_SETTINGS_STORAGE_KEY) || "";
      } catch {
        pendingText = "";
        storedInvite = "";
      }

      if (inviteFragment && !inviteFragmentRemoved) {
        remoteInviteActiveRef.current = false;
        setRemoteSettings(defaultRemoteReaperSettings);
        setDraftRemoteSettings(defaultRemoteReaperSettings);
        setReaperMode("remote");
        setRemoteInviteState("invalid");
        setRemoteInviteMessage(
          "Invite Invalid — this browser could not remove the private credential from the address bar, so it was not used.",
        );
        setRemoteState("error");
        setRemoteStateMessage("The private invite was not opened. Ask the host for a fresh link.");
        setReaperStatus("Private REAPER invite rejected before connection.");
        return;
      }

      if (embeddedBridge) {
        remoteInviteActiveRef.current = false;
        setRemoteSettings(savedSettings);
        setDraftRemoteSettings(savedSettings);
        setReaperMode("local");
        if (inviteFragment) {
          setRemoteInviteState("invalid");
          setRemoteInviteMessage(
            "Invite Invalid — private relay invites cannot be accepted inside an embedded REAPER bridge.",
          );
          setReaperStatus("The embedded REAPER Wi-Fi bridge has priority. Open private invites in a normal browser tab.");
        }
        return;
      }

      let selectedSettings = savedSettings;
      let selectedMode = savedMode;
      let selectedInvite: RemoteInviteResult = { status: "none" };
      let inviteStatusLocked = false;

      if (inviteFragment && pendingText) {
        inviteStatusLocked = true;
        setRemoteInviteState("invalid");
        setRemoteInviteMessage(
          "Invite Invalid — an unfinished REAPER command is being recovered first. Its connection was not replaced.",
        );
        setReaperStatus("The new invite was ignored because an unfinished remote command still needs recovery.");
        if (storedInvite) {
          selectedInvite = parseRemoteReaperInviteFragment(
            `${REMOTE_INVITE_PREFIX}${storedInvite}`,
          );
        }
      } else {
        const candidate = inviteFragment || (
          storedInvite ? `${REMOTE_INVITE_PREFIX}${storedInvite}` : ""
        );
        if (candidate) {
          selectedInvite = parseRemoteReaperInviteFragment(candidate);
          if (selectedInvite.status === "accepted" && inviteFragment) {
            try {
              sessionStorage.setItem(
                REMOTE_INVITE_SETTINGS_STORAGE_KEY,
                inviteFragment.slice(REMOTE_INVITE_PREFIX.length),
              );
            } catch {
              selectedInvite = { status: "invalid" };
              try {
                sessionStorage.removeItem(REMOTE_INVITE_SETTINGS_STORAGE_KEY);
              } catch {
                // The invite is rejected when session-only storage is unavailable.
              }
            }
          } else if (
            selectedInvite.status === "expired" ||
            selectedInvite.status === "invalid"
          ) {
            try {
              sessionStorage.removeItem(REMOTE_INVITE_SETTINGS_STORAGE_KEY);
            } catch {
              // The rejected credential is never copied into persistent storage.
            }
          }
        }
      }

      if (selectedInvite.status === "accepted") {
        selectedSettings = selectedInvite.settings;
        selectedMode = "remote";
        remoteInviteActiveRef.current = true;
        if (!inviteStatusLocked) {
          setRemoteInviteState("accepted");
          setRemoteInviteMessage(
            "Invite Accepted — connecting to the paired REAPER Mac. No connection details need to be typed.",
          );
          setReaperStatus("Private REAPER invite accepted. Connecting without running any REAPER action.");
        }
        setRemoteState("connecting");
        setRemoteStateMessage("Private invite accepted. Connecting securely to the remote relay…");
      } else {
        remoteInviteActiveRef.current = false;
        if (selectedInvite.status === "expired") {
          selectedMode = "remote";
          selectedSettings = defaultRemoteReaperSettings;
          setRemoteInviteState("expired");
          setRemoteInviteMessage("Invite Expired — ask the REAPER host to create a fresh private link.");
          setRemoteState("disconnected");
          setRemoteStateMessage("The private invite has expired and was not connected.");
          setReaperStatus("Private REAPER invite expired. No REAPER action was run.");
        } else if (selectedInvite.status === "invalid" && !inviteStatusLocked) {
          selectedMode = "remote";
          selectedSettings = defaultRemoteReaperSettings;
          setRemoteInviteState("invalid");
          setRemoteInviteMessage("Invite Invalid — ask the REAPER host to create a fresh private link.");
          setRemoteState("error");
          setRemoteStateMessage("The private invite could not be validated and was not connected.");
          setReaperStatus("Private REAPER invite rejected. No REAPER action was run.");
        }
      }

      setRemoteSettings(selectedSettings);
      setDraftRemoteSettings(selectedSettings);
      setReaperMode(selectedMode);

      if (!pendingText) return;
      try {
        const pending = JSON.parse(pendingText) as {
          requestId?: string;
          action?: string;
          machineId?: string;
          createdAt?: number;
        };
        const age = Date.now() - Number(pending.createdAt || 0);
        const action = String(pending.action || "");
        const machineId = String(pending.machineId || selectedSettings.machineId).trim();
        if (
          /^[a-z0-9][a-z0-9_-]{7,127}$/i.test(String(pending.requestId || "")) &&
          allReaperActions.some((candidate) => candidate.id === action) &&
          machineId === selectedSettings.machineId.trim() &&
          selectedMode === "remote" &&
          age >= 0 &&
          age < remoteCompletionLimit(action)
        ) {
          const restoredPending: PendingRemoteCommand = {
            requestId: String(pending.requestId),
            action,
            machineId,
            createdAt: Number(pending.createdAt),
          };
          remoteRequestRef.current = restoredPending.requestId;
          remotePendingRef.current = restoredPending;
          setRunningReaperAction(restoredPending.action);
          setReaperStatus("Recovering the unfinished remote REAPER command. Do not retry while its status is being checked.");
          armRemoteCompletionTimer(restoredPending);
        } else {
          sessionStorage.removeItem(REMOTE_PENDING_STORAGE_KEY);
        }
      } catch {
        sessionStorage.removeItem(REMOTE_PENDING_STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, [armRemoteCompletionTimer]);

  useEffect(() => {
    function receiveBridgeStatus(event: MessageEvent) {
      if (event.source !== window.parent) return;
      if (!event.data || event.data.type !== "story-cue-studio:status") return;
      setReaperStatus(String(event.data.message || "REAPER bridge updated."));
      if (event.data.done) setRunningReaperAction(null);
    }
    window.addEventListener("message", receiveBridgeStatus);
    return () => window.removeEventListener("message", receiveBridgeStatus);
  }, []);

  useEffect(() => {
    if (reaperMode !== "remote" || window.parent !== window) {
      remoteSocketRef.current?.close(1000, "Local bridge selected");
      remoteSocketRef.current = null;
      remoteReconnectAttemptRef.current = 0;
      return;
    }

    let validated: RemoteReaperSettings;
    try {
      validated = validateRemoteReaperSettings(remoteSettings);
    } catch (error) {
      const invalidTimer = window.setTimeout(() => {
        setRemoteState("disconnected");
        setRemoteStateMessage(error instanceof Error ? error.message : "Complete the remote connection settings.");
      }, 0);
      return () => window.clearTimeout(invalidTimer);
    }

    let stopped = false;
    let paired = false;
    let suppressReconnect = false;
    let reconnectTimer: number | null = null;

    function clearAckTimer() {
      if (remoteAckTimerRef.current !== null) {
        window.clearTimeout(remoteAckTimerRef.current);
        remoteAckTimerRef.current = null;
      }
    }

    function queryPendingStatus(socket: WebSocket) {
      const pending = remotePendingRef.current;
      if (!pending || pending.requestId !== remoteRequestRef.current) return;
      if (pending.machineId !== validated.machineId) {
        cancelPendingRemoteCommand(
          "The remote machine settings changed while a command was unfinished. Its outcome is unknown; inspect REAPER before trying again.",
        );
        return;
      }
      if (socket.readyState !== WebSocket.OPEN) return;
      setRunningReaperAction(pending.action);
      setReaperStatus("Reconnected. Recovering the unfinished remote REAPER command; do not retry it yet.");
      try {
        socket.send(JSON.stringify({
          type: "status_query",
          version: REMOTE_PROTOCOL_VERSION,
          machineId: validated.machineId,
          requestId: pending.requestId,
        }));
      } catch {
        setReaperStatus("Status recovery was interrupted. Reconnecting; do not retry the unfinished command.");
        socket.close(1011, "Status recovery interrupted");
        return;
      }
      clearAckTimer();
      remoteAckTimerRef.current = window.setTimeout(() => {
        if (remoteRequestRef.current !== pending.requestId) return;
        cancelPendingRemoteCommand(
          "The relay did not return the unfinished command status. Its outcome is unknown; inspect REAPER before trying again.",
        );
      }, 15000);
      armRemoteCompletionTimer(pending);
    }

    function connect() {
      if (stopped) return;
      paired = false;
      setRemoteState("connecting");
      setRemoteStateMessage("Connecting securely to the remote relay…");
      const socket = new WebSocket(validated.relayUrl);
      remoteSocketRef.current = socket;

      socket.addEventListener("open", () => {
        setRemoteStateMessage("Relay reached. Pairing with the REAPER computer…");
        socket.send(JSON.stringify({
          type: "pair",
          version: REMOTE_PROTOCOL_VERSION,
          role: "controller",
          machineId: validated.machineId,
          token: validated.pairingToken,
        }));
      });

      socket.addEventListener("message", (event) => {
        let payload: RemoteRelayMessage;
        try {
          payload = JSON.parse(String(event.data)) as RemoteRelayMessage;
        } catch {
          return;
        }
        if (payload.machineId && payload.machineId !== validated.machineId) return;

        if (payload.type === "paired" || payload.type === "machine_status") {
          if (payload.type === "paired") {
            paired = true;
            remoteReconnectAttemptRef.current = 0;
            queryPendingStatus(socket);
          }
          const machineOnline = Boolean(payload.online);
          const reaperOnline = payload.reaperOnline !== false;
          if (machineOnline && reaperOnline) {
            setRemoteState("online");
            setRemoteStateMessage("Remote REAPER is online and ready.");
          } else {
            setRemoteState("relay-only");
            setRemoteStateMessage(
              String(payload.message || (
                machineOnline
                  ? "The Mac companion is connected, but REAPER is not ready."
                  : "Relay connected. Waiting for the REAPER Mac companion."
              )),
            );
            if (payload.type === "machine_status" && remoteRequestRef.current) {
              clearAckTimer();
              setReaperStatus(
                "The remote Mac or REAPER is temporarily unavailable. The unfinished command is still being recovered; do not retry it.",
              );
            }
          }
          return;
        }

        if (payload.type === "command_status") {
          if (!payload.requestId || payload.requestId !== remoteRequestRef.current) return;
          clearAckTimer();
          const duration = formatRemoteDuration(payload.actualDurationSeconds);
          const message = String(payload.message || "Remote REAPER updated.");
          setReaperStatus(duration && !message.includes(duration) ? `${message} Actual voice duration: ${duration}.` : message);
          if (payload.done || payload.state === "complete" || payload.state === "error") {
            cancelPendingRemoteCommand();
          }
          return;
        }

        if (payload.type === "error") {
          clearAckTimer();
          if (payload.requestId && payload.requestId === remoteRequestRef.current) {
            cancelPendingRemoteCommand(String(payload.message || "The remote REAPER command failed."));
            return;
          }
          if (payload.requestId) return;
          setRemoteState("error");
          setRemoteStateMessage(String(payload.message || "The remote relay rejected the connection."));
          if (!paired) {
            suppressReconnect = true;
            socket.close(4003, "Pairing rejected");
          }
        }
      });

      socket.addEventListener("close", () => {
        if (remoteSocketRef.current === socket) remoteSocketRef.current = null;
        if (stopped) return;
        clearAckTimer();
        if (remoteRequestRef.current) {
          setReaperStatus(
            "The remote connection was interrupted. Reconnecting to recover the unfinished command; do not retry it.",
          );
        }
        if (suppressReconnect) return;
        setRemoteState("connecting");
        setRemoteStateMessage("Remote connection interrupted. Reconnecting…");
        const attempt = Math.min(remoteReconnectAttemptRef.current + 1, 5);
        remoteReconnectAttemptRef.current = attempt;
        const delay = Math.min(1000 * (2 ** (attempt - 1)), 15000);
        reconnectTimer = window.setTimeout(connect, delay);
      });

      socket.addEventListener("error", () => {
        setRemoteStateMessage("The relay could not be reached. Check the WSS address and tunnel.");
      });
    }

    reconnectTimer = window.setTimeout(connect, 0);
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      clearAckTimer();
      if (remoteCompletionTimerRef.current !== null) {
        window.clearTimeout(remoteCompletionTimerRef.current);
        remoteCompletionTimerRef.current = null;
      }
      const socket = remoteSocketRef.current;
      remoteSocketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Settings changed");
    };
  }, [armRemoteCompletionTimer, cancelPendingRemoteCommand, reaperMode, remoteSettings, remoteConnectRevision]);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(VOICE_STORAGE_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved) as Partial<Settings>;
        const restoredRuntime = normalizeRuntimeMinutes(parsed.runtimeMinutes);
        setSettings((previous) => ({
          ...previous,
          runtimeMinutes: restoredRuntime,
          musicCueCount: Number(parsed.musicCueCount) || runtimeProfile(restoredRuntime).defaultMusicCues,
          elevenModel: String(parsed.elevenModel || previous.elevenModel),
          performanceTaste: String(parsed.performanceTaste || previous.performanceTaste),
          useMe: parsed.useMe === true,
          yourName: String(parsed.yourName ?? previous.yourName),
          lead: String(parsed.lead ?? previous.lead),
          rival: String(parsed.rival ?? previous.rival),
          narratorVoiceId: String(parsed.narratorVoiceId ?? previous.narratorVoiceId),
          leadVoiceId: String(parsed.leadVoiceId ?? previous.leadVoiceId),
          rivalVoiceId: String(parsed.rivalVoiceId ?? previous.rivalVoiceId),
        }));
      } catch {
        localStorage.removeItem(VOICE_STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = window.setTimeout(() => {
      setVoiceCatalogState("loading");
      setVoiceCatalogMessage("Loading ElevenLabs voice cards…");
      const params = new URLSearchParams({ page_size: "100" });
      if (selectedVoiceIds) params.set("voice_ids", selectedVoiceIds);
      void fetch(`/api/elevenlabs/voices?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = await response.json() as {
            voices?: VoiceOption[];
            error?: string;
          };
          if (!response.ok) {
            throw new Error(data.error || "ElevenLabs voice catalog is unavailable.");
          }
          const voices = Array.isArray(data.voices)
            ? data.voices.filter((voice) =>
                voice &&
                typeof voice.voiceId === "string" &&
                typeof voice.name === "string",
              )
            : [];
          setVoiceOptions(voices);
          setVoiceCatalogState("ready");
          setVoiceCatalogMessage(
            voices.length
              ? `${voices.length} ElevenLabs voices ready. Choose a cast member, search, preview, then select.`
              : "No ElevenLabs voices were returned.",
          );
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setVoiceCatalogState("error");
          setVoiceCatalogMessage(
            error instanceof Error
              ? error.message
              : "ElevenLabs voice catalog is unavailable.",
          );
        });
    }, 0);
    return () => {
      window.clearTimeout(load);
      controller.abort();
    };
  }, [selectedVoiceIds, voiceCatalogRevision]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((previous) => {
      const next = { ...previous, [key]: value };
      if (["runtimeMinutes", "musicCueCount", "elevenModel", "performanceTaste", "useMe", "yourName", "lead", "rival", "narratorVoiceId", "leadVoiceId", "rivalVoiceId"].includes(key)) {
        localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }

  function voiceIdForRole(role: VoiceRole) {
    if (role === "narrator") return settings.narratorVoiceId;
    if (role === "lead") return settings.leadVoiceId;
    return settings.rivalVoiceId;
  }

  function voiceLabelForRole(role: VoiceRole) {
    if (role === "narrator") return "Narrator";
    if (role === "lead") return leadName;
    return rivalName;
  }

  function selectVoice(role: VoiceRole, voice: VoiceOption) {
    if (role === "narrator") update("narratorVoiceId", voice.voiceId);
    else if (role === "lead") update("leadVoiceId", voice.voiceId);
    else update("rivalVoiceId", voice.voiceId);
    setVoiceCatalogMessage(`${voice.name} selected for ${voiceLabelForRole(role)}.`);
  }

  async function toggleVoicePreview(voice: VoiceOption) {
    const audio = voicePreviewRef.current;
    if (!audio || !voice.previewUrl) {
      setVoiceCatalogMessage(`No preview is available for ${voice.name}.`);
      return;
    }
    if (previewingVoiceId === voice.voiceId && !audio.paused) {
      audio.pause();
      audio.currentTime = 0;
      setPreviewingVoiceId(null);
      return;
    }
    audio.pause();
    audio.src = voice.previewUrl;
    audio.currentTime = 0;
    try {
      await audio.play();
      setPreviewingVoiceId(voice.voiceId);
      setVoiceCatalogMessage(`Previewing ${voice.name}.`);
    } catch {
      setPreviewingVoiceId(null);
      setVoiceCatalogMessage(`The preview for ${voice.name} could not be played in this browser.`);
    }
  }

  function chooseRuntime(runtimeMinutes: RuntimeMinutes) {
    const profile = runtimeProfile(runtimeMinutes);
    setSettings((previous) => {
      const next = {
        ...previous,
        runtimeMinutes,
        musicCueCount: profile.defaultMusicCues,
      };
      localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
    setStatus(`${profile.label} selected. The original storyboard workflow and all REAPER controls remain available.`);
  }

  function saveRemotePreference(mode: ReaperConnectionMode, nextSettings: RemoteReaperSettings) {
    if (remoteInviteActiveRef.current) return;
    localStorage.setItem(REMOTE_REAPER_STORAGE_KEY, JSON.stringify({
      mode,
      settings: nextSettings,
    }));
  }

  function clearRemoteInviteSession() {
    try {
      sessionStorage.removeItem(REMOTE_INVITE_SETTINGS_STORAGE_KEY);
    } catch {
      // The in-memory credential is still cleared below.
    }
    remoteInviteActiveRef.current = false;
    setRemoteInviteState("idle");
    setRemoteInviteMessage(
      "Guests only need the private invite link from the REAPER Mac. No relay address, machine ID, or token typing is required.",
    );
  }

  function confirmPendingRemoteCancellation(change: string) {
    if (!remoteRequestRef.current) return true;
    return window.confirm(
      `${change} will stop recovery of the unfinished remote command. Its outcome may still be unknown in REAPER. Continue only after checking the Mac.`,
    );
  }

  function chooseReaperMode(mode: ReaperConnectionMode) {
    if (mode === reaperMode) return;
    if (!confirmPendingRemoteCancellation("Changing the connection mode")) return;
    const hadPending = Boolean(remoteRequestRef.current);
    if (hadPending) cancelPendingRemoteCommand();
    const hadInvite = remoteInviteActiveRef.current;
    let nextSettings = remoteSettings;
    if (hadInvite && mode === "local") {
      clearRemoteInviteSession();
      nextSettings = { ...remoteSettings, pairingToken: "" };
      setRemoteSettings(nextSettings);
      setDraftRemoteSettings(nextSettings);
    }
    setReaperMode(mode);
    if (!hadInvite) saveRemotePreference(mode, nextSettings);
    if (mode === "local") {
      setRemoteState("disconnected");
      setRemoteStateMessage("Internet Relay is disconnected. Local and Wi-Fi controls remain available.");
      setRunningReaperAction(null);
      setReaperStatus(
        hadPending
          ? "Remote mode was disconnected while a command was unfinished. Its outcome is unknown; inspect REAPER before trying again."
          : "Local mode selected. Open REAPER or use the REAPER-hosted Wi-Fi bridge.",
      );
    } else {
      setReaperStatus(
        hadPending
          ? "The connection mode changed while a command was unfinished. Its outcome is unknown; inspect REAPER before trying again."
          : "Internet Relay selected. Save the connection details and wait for Remote REAPER Online.",
      );
    }
  }

  function updateDraftRemoteSetting(key: keyof RemoteReaperSettings, value: string) {
    setDraftRemoteSettings((previous) => ({ ...previous, [key]: value }));
  }

  function saveAndConnectRemote() {
    try {
      const validated = validateRemoteReaperSettings(draftRemoteSettings);
      if (!confirmPendingRemoteCancellation("Saving new remote connection settings")) return;
      const hadPending = Boolean(remoteRequestRef.current);
      if (hadPending) cancelPendingRemoteCommand();
      setRemoteSettings(validated);
      setDraftRemoteSettings(validated);
      setReaperMode("remote");
      if (!remoteInviteActiveRef.current) saveRemotePreference("remote", validated);
      setRemoteConnectRevision((revision) => revision + 1);
      setRemoteState("connecting");
      setRemoteStateMessage("Connecting securely to the remote relay…");
      setReaperStatus(
        hadPending
          ? "Connection settings changed while a command was unfinished. Its outcome is unknown; inspect REAPER before trying again."
          : remoteInviteActiveRef.current
            ? "Connecting with a session-only private invite. No REAPER action was run."
            : "Connecting to the remote REAPER computer…",
      );
    } catch (error) {
      setRemoteState("error");
      setRemoteStateMessage(error instanceof Error ? error.message : "Check the remote connection settings.");
    }
  }

  function createNewPairingToken() {
    const nextToken = generatePairingToken();
    if (remoteInviteActiveRef.current) {
      const cleared = { ...remoteSettings, pairingToken: "" };
      clearRemoteInviteSession();
      setRemoteSettings(cleared);
      setDraftRemoteSettings({ ...cleared, pairingToken: nextToken });
      setReaperMode("remote");
      setRemoteState("disconnected");
    } else {
      updateDraftRemoteSetting("pairingToken", nextToken);
    }
    setRemoteStateMessage("New pairing token created. Put the same token in the Mac companion.");
  }

  function removeRemotePairingToken() {
    if (!confirmPendingRemoteCancellation("Removing the pairing token")) return;
    const hadPending = Boolean(remoteRequestRef.current);
    if (hadPending) cancelPendingRemoteCommand();
    const hadInvite = remoteInviteActiveRef.current;
    if (hadInvite) clearRemoteInviteSession();
    const cleared = { ...remoteSettings, pairingToken: "" };
    setRemoteSettings(cleared);
    setDraftRemoteSettings((previous) => ({ ...previous, pairingToken: "" }));
    setReaperMode("local");
    if (!hadInvite) saveRemotePreference("local", cleared);
    setRemoteState("disconnected");
    setRemoteStateMessage("Pairing token removed from this browser.");
    setReaperStatus(
      hadPending
        ? "Pairing was removed while a command was unfinished. Its outcome is unknown; inspect REAPER before trying again."
        : "Remote pairing removed. Local REAPER controls remain available.",
    );
  }

  function downloadRemoteCompanionConfig() {
    if (remoteInviteActiveRef.current) {
      setRemoteStateMessage(
        "Private invite credentials stay in this browser session and cannot be exported. Ask the Mac host for setup access.",
      );
      return;
    }
    try {
      const validated = validateRemoteReaperSettings({
        ...draftRemoteSettings,
        relayUrl: draftRemoteSettings.relayUrl.trim() || "ws://127.0.0.1:8787",
      });
      const contents = [
        `REAPER_RELAY_URL=${JSON.stringify(validated.relayUrl)}`,
        `REAPER_MACHINE_ID=${validated.machineId}`,
        `REAPER_PAIRING_TOKEN=${JSON.stringify(validated.pairingToken)}`,
        "REAPER_BASE_URL=http://127.0.0.1:8089",
        'CUE_ASSET_PATH="/Volumes/Extreme SSD/pocket fm/france/tool test/ai mastering training/ai mastering training.RPP"',
        "ALLOW_PAID_VOICE_GENERATION=false",
        "",
      ].join("\n");
      const blob = new Blob([contents], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = ".env";
      link.click();
      URL.revokeObjectURL(link.href);
      setRemoteStateMessage("Mac companion configuration downloaded. It does not contain any ElevenLabs key.");
    } catch (error) {
      setRemoteState("error");
      setRemoteStateMessage(error instanceof Error ? error.message : "Complete the remote connection settings first.");
    }
  }

  function updateDraftProvider(key: keyof ProviderConfig, value: string) {
    const provider = draftAISettings.provider;
    setDraftAISettings((previous) => ({
      ...previous,
      [provider]: { ...previous[provider], [key]: value },
    }));
  }

  function openAISettings() {
    setDraftAISettings(cloneAISettings(aiSettings));
    setAISettingsStatus("");
    setShowAPIKey(false);
    setAISettingsOpen(true);
  }

  function saveAISettings() {
    const config = draftAISettings[draftAISettings.provider];
    if (config.apiKey.trim() && !config.model.trim()) {
      setAISettingsStatus("Enter a model name.");
      return;
    }
    if (draftAISettings.provider === "compatible" && config.apiKey.trim() && !config.baseUrl.trim()) {
      setAISettingsStatus("Enter the compatible API base URL.");
      return;
    }
    const saved = cloneAISettings(draftAISettings);
    setAISettings(saved);
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(saved));
    setAISettingsStatus("AI settings saved on this browser.");
    window.setTimeout(() => setAISettingsOpen(false), 500);
  }

  function removeCurrentKey() {
    const provider = draftAISettings.provider;
    const cleared = {
      ...draftAISettings,
      [provider]: { ...draftAISettings[provider], apiKey: "" },
    };
    setDraftAISettings(cleared);
    setAISettings(cleared);
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(cleared));
    setAISettingsStatus(`${providerLabels[provider]} key removed from this browser.`);
  }

  async function generate() {
    if (!story.trim()) {
      setStatus("Paste a story first.");
      return;
    }
    setGenerating(true);
    setStatus(`Building a ${selectedRuntime.label} with ${activeProviderConfig.apiKey ? providerLabels[aiSettings.provider] : "the local generator"}…`);
    const fallback = prepareGeneratedCueScript(localStoryboard(story, settings), settings);
    if (!activeProviderConfig.apiKey.trim()) {
      setOutput(fallback.script);
      const words = spokenWordCount(fallback.script);
      setStatus(`Local ${selectedRuntime.label} created: ${words.toLocaleString()} spoken words, about ${(words / WORDS_PER_MINUTE).toFixed(1)} minutes.${cuePreparationStatus(fallback)}${cueBankStatus(fallback.cueBank)} Add an AI key for a richer adaptation.`);
      setGenerating(false);
      return;
    }
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          story,
          settings,
          ai: {
            provider: aiSettings.provider,
            apiKey: activeProviderConfig.apiKey,
            model: activeProviderConfig.model,
            baseUrl: activeProviderConfig.baseUrl,
          },
        }),
      });
      const data = await response.json() as {
        mode?: string;
        script?: string;
        error?: string;
        spokenWords?: number;
        estimatedMinutes?: number;
        cueBank?: TrainingCueBankReport;
      };
      if (!response.ok || !data.script) throw new Error(data.error || "The model did not return a cue script.");
      const prepared = prepareGeneratedCueScript(data.script, settings);
      const words = spokenWordCount(prepared.script);
      setOutput(prepared.script);
      setStatus(`${providerLabels[aiSettings.provider]} created ${words.toLocaleString()} spoken words, about ${(words / WORDS_PER_MINUTE).toFixed(1)} minutes.${cuePreparationStatus(prepared)}${cueBankStatus(prepared.cueBank || data.cueBank)}`);
    } catch (error) {
      setOutput(fallback.script);
      const message = error instanceof Error ? error.message : "AI generation failed.";
      setStatus(`${message} A local ${selectedRuntime.label} was created instead.${cuePreparationStatus(fallback)}${cueBankStatus(fallback.cueBank)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function optimizeCueData() {
    if (!output.trim()) {
      setStatus("Generate a cue script before optimizing its cues.");
      return;
    }
    setOptimizing(true);
    setStatus(`Optimizing with the ai mastering training cue bank: SFX and Ambient stay inside the REAPER session vocabulary…`);
    const locallyOptimized = optimizeCueScriptLocally(output);
    const localPolicy = enforceTrainingCueBank(locallyOptimized, 0);
    const localVersion = localPolicy.script;
    if (!activeProviderConfig.apiKey.trim()) {
      setOutput(localVersion);
      setStatus(`Cue data optimized locally against ai mastering training.RPP: every SFX and Ambient cue is from the REAPER session bank; Music stays on MUSIC POD.${cueBankStatus(localPolicy.report)}`);
      setOptimizing(false);
      return;
    }
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "optimize_cues",
          script: output,
          settings,
          ai: {
            provider: aiSettings.provider,
            apiKey: activeProviderConfig.apiKey,
            model: activeProviderConfig.model,
            baseUrl: activeProviderConfig.baseUrl,
          },
        }),
      });
      const data = await response.json() as {
        script?: string;
        error?: string;
        optimizedCount?: number;
        cueBank?: TrainingCueBankReport;
      };
      if (!response.ok || !data.script) throw new Error(data.error || "Cue optimization failed.");
      setOutput(data.script);
      setStatus(`${providerLabels[aiSettings.provider]} optimized ${Number(data.optimizedCount || 0)} SFX, Ambient, and Music cues without changing the story text.${cueBankStatus(data.cueBank)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cue optimization failed.";
      setOutput(localVersion);
      setStatus(`${message} The local cue optimizer was used instead.`);
    } finally {
      setOptimizing(false);
    }
  }

  async function applyAmbientCueRanges() {
    if (!output.trim()) {
      setStatus("Generate a cue script before setting Ambient cue ranges.");
      return;
    }
    setRanging(true);
    setStatus(`Reading the story to find where each Ambient location stops with ${activeProviderConfig.apiKey ? providerLabels[aiSettings.provider] : "the local range planner"}…`);
    const locallyRanged = applyAmbientRangesLocally(output);
    const localPolicy = settings.trainingCueBank
      ? enforceTrainingCueBank(locallyRanged)
      : { script: locallyRanged, report: undefined };
    const localVersion = localPolicy.script;
    if (!activeProviderConfig.apiKey.trim()) {
      setOutput(localVersion);
      setStatus(`Ambient ranges added without timecodes. Each location now has a START and END cue; SFX cues were not changed.${cueBankStatus(localPolicy.report)}`);
      setRanging(false);
      return;
    }
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ambient_ranges",
          script: output,
          settings,
          ai: {
            provider: aiSettings.provider,
            apiKey: activeProviderConfig.apiKey,
            model: activeProviderConfig.model,
            baseUrl: activeProviderConfig.baseUrl,
          },
        }),
      });
      const data = await response.json() as {
        script?: string;
        error?: string;
        rangeCount?: number;
        cueBank?: TrainingCueBankReport;
      };
      if (!response.ok || !data.script) throw new Error(data.error || "Ambient cue range analysis failed.");
      setOutput(data.script);
      setStatus(`${providerLabels[aiSettings.provider]} added ${Number(data.rangeCount || 0)} Ambient START/END range pairs without changing SFX or story text.${cueBankStatus(data.cueBank)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ambient cue range analysis failed.";
      setOutput(localVersion);
      setStatus(`${message} The local Ambient range planner was used instead.`);
    } finally {
      setRanging(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function download() {
    const blob = new Blob([output], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${clean(settings.title, "story").replace(/[^a-z0-9]+/gi, "-")}-cue-script.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function sendRemoteReaperCommand(action: ReaperAction, cursorSeconds?: number) {
    const socket = remoteSocketRef.current;
    const transportAction = action.id === "transport-play-pause" || action.id === "transport-seek";
    if ((!transportAction && remoteState !== "online") || !socket || socket.readyState !== WebSocket.OPEN) {
      setReaperStatus("Remote REAPER is not ready. Connect the relay and start the Mac companion with a dedicated story project open.");
      return;
    }
    if (action.id === "build-play") {
      const approved = window.confirm(
        remoteInviteActiveRef.current
          ? "Send this paid Build Immersive & Play request? The REAPER Mac owner must separately approve this exact request before ElevenLabs credits can be used."
          : "Build Immersive & Play will use the ElevenLabs account stored on the REAPER computer. Continue with paid voice generation?",
      );
      if (!approved) {
        setReaperStatus("Remote build cancelled before using ElevenLabs credits.");
        return;
      }
    }

    const requestId = generateRequestId();
    if (remoteRequestRef.current) {
      setReaperStatus("An earlier remote command is still being recovered. Do not retry it until REAPER reports its result.");
      return;
    }
    const pending: PendingRemoteCommand = {
      requestId,
      machineId: remoteSettings.machineId,
      action: action.id,
      createdAt: Date.now(),
    };
    try {
      sessionStorage.setItem(REMOTE_PENDING_STORAGE_KEY, JSON.stringify(pending));
    } catch {
      setReaperStatus("This browser could not save remote recovery state, so the command was not sent.");
      return;
    }
    remoteRequestRef.current = requestId;
    remotePendingRef.current = pending;
    setRunningReaperAction(action.id);
    setReaperStatus(`Sending “${action.label}” securely to the remote REAPER computer…`);
    try {
      socket.send(JSON.stringify({
        type: "command",
        version: REMOTE_PROTOCOL_VERSION,
        requestId,
        machineId: remoteSettings.machineId,
        action: action.id,
        script: action.id === "story-importer" || action.id === "build-play" ? output : "",
        runtimeMinutes: settings.runtimeMinutes,
        cursorSeconds: Number.isFinite(cursorSeconds) ? Math.max(0, Number(cursorSeconds)) : undefined,
        timecode: action.id === "transport-seek" ? formatReaperTimecode(cursorSeconds || 0) : undefined,
      }));
    } catch {
      cancelPendingRemoteCommand("The remote socket closed before the command could be sent. Reconnect and try again.");
      return;
    }
    if (remoteAckTimerRef.current !== null) window.clearTimeout(remoteAckTimerRef.current);
    remoteAckTimerRef.current = window.setTimeout(() => {
      if (remoteRequestRef.current !== requestId) return;
      cancelPendingRemoteCommand("The relay did not acknowledge the command. Nothing was resent automatically; check the companion before trying again.");
    }, 15000);
    armRemoteCompletionTimer(pending);
  }

  async function sendReaperCommand(action: ReaperAction, cursorSeconds?: number) {
    if (action.id === "story-importer" || action.id === "build-play") {
      if (!output.trim()) {
        setReaperStatus("Generate a cue script before importing it.");
        return;
      }
    }

    if (action.id === "transport-seek" && (window.parent !== window || reaperMode !== "remote")) {
      try {
        await navigator.clipboard.writeText(formatReaperTimecode(cursorSeconds || 0));
      } catch {
        setReaperStatus("Clipboard access was blocked. Allow clipboard access so REAPER can read the HH:MM:SS:FF timecode.");
        return;
      }
    }

    if (window.parent !== window) {
      setRunningReaperAction(action.id);
      setReaperStatus(`Sending “${action.label}” through the REAPER Wi‑Fi bridge…`);
      window.parent.postMessage({
        type: "story-cue-studio:reaper",
        action: action.id,
        script: output,
        runtimeMinutes: settings.runtimeMinutes,
        cursorSeconds: Number.isFinite(cursorSeconds) ? Math.max(0, Number(cursorSeconds)) : undefined,
        timecode: action.id === "transport-seek" ? formatReaperTimecode(cursorSeconds || 0) : undefined,
      }, "*");
      return;
    }

    if (reaperMode === "remote") {
      sendRemoteReaperCommand(action, cursorSeconds);
      return;
    }

    if (action.id === "build-play") {
      setReaperStatus("For one-click immersive build, open this studio through the REAPER Wi‑Fi Bridge page. The three individual local buttons still work here.");
      return;
    }

    if (action.id === "story-importer") {
      try {
        await navigator.clipboard.writeText(output);
      } catch {
        setReaperStatus("Clipboard access was blocked. Use Copy, allow clipboard access, then try Import Story again.");
        return;
      }
    }

    const command = action.command;
    if (!command) {
      setReaperStatus("This REAPER command is not configured.");
      return;
    }

    setRunningReaperAction(action.id);
    setReaperStatus(
      action.id === "story-importer"
        ? "Script copied. Sending Import Story to REAPER…"
        : action.id === "transport-seek"
          ? `Moving the REAPER edit cursor to ${formatTimelineTime(cursorSeconds || 0)}…`
          : `Sending “${action.label}” to REAPER…`,
    );
    let sent = false;
    for (const baseUrl of reaperBaseUrls) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1500);
      try {
        await fetch(`${baseUrl}/_/${encodeURIComponent(command)};`, {
          method: "GET",
          mode: "no-cors",
          cache: "no-store",
          signal: controller.signal,
        });
        sent = true;
        break;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          sent = true;
          break;
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }
    setRunningReaperAction(null);
    setReaperStatus(
      sent
        ? action.id === "story-importer"
          ? "Script copied and Import Story was sent to REAPER."
          : action.id === "transport-seek"
            ? `REAPER edit cursor moved to ${formatTimelineTime(cursorSeconds || 0)}.`
            : `“${action.label}” was sent to REAPER.`
        : "REAPER could not be reached. Open REAPER and enable Web Control on port 8080 or 8089.",
    );
  }

  function commitTimelineCursor(seconds: number) {
    const next = Math.max(0, Math.min(timelineDurationSeconds, seconds));
    setTimelineCursorSeconds(next);
    void sendReaperCommand(transportSeekAction, next);
  }

  function jumpToNextCue() {
    const nextCue = storyTimelineMarkers.find((marker) => marker.seconds > timelineCursorSeconds + 0.25);
    commitTimelineCursor(nextCue?.seconds ?? 0);
  }

  function updateTimelineCursorFromPointer(event: ReactPointerEvent<HTMLDivElement>, commit = false) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    const seconds = ratio * timelineDurationSeconds;
    setTimelineCursorSeconds(seconds);
    if (commit) commitTimelineCursor(seconds);
  }

  function toggleTimelinePlayback() {
    setTimelinePlaying((playing) => !playing);
    void sendReaperCommand(transportPlayPauseAction);
  }

  return <main className="shell">
    <section className="hero">
      <div className="hero-toolbar">
        <p className="eyebrow">STORY → PERFORMANCE → REAPER</p>
        <button className="ai-settings-trigger" onClick={openAISettings}>
          <span className={`provider-light ${activeProviderConfig.apiKey ? "configured" : ""}`} />
          AI Settings
          <small>{activeProviderConfig.apiKey ? providerLabels[aiSettings.provider] : "Local"}</small>
        </button>
      </div>
      <h1>Audio Story Engine</h1>
      <p className="subhead">Turn a plain story into either a fast three-minute demo or the complete seven-minute storyboard, with full-cast narration, acting direction, ambience, music, and clean sound cues.</p>
      <div className="promise"><span>01</span> 3 or 7+ minutes <span>02</span> Original storyboard retained <span>03</span> Full character voices <span>04</span> Maximum two SFX per gap</div>
    </section>

    <section className="workspace">
      <div className="panel input-panel">
        <div className="panel-head"><h2>1. Your normal story</h2><button className="text-button" onClick={() => setStory(sample)}>Load example</button></div>
        <textarea aria-label="Normal story" value={story} onChange={(event) => setStory(event.target.value)} placeholder="Paste your story here…" />
        <p className="hint">Paste prose, a chapter, or a scene. Short material will be expanded into a complete dramatic arc.</p>
      </div>

      <div className="panel director-panel">
        <h2>2. Direct the adaptation</h2>
        <label>Episode title<input value={settings.title} onChange={(event) => update("title", event.target.value)} /></label>
        <fieldset className="runtime-fieldset">
          <legend>Episode runtime</legend>
          <div className="runtime-options">
            <button
              type="button"
              className={`runtime-option ${settings.runtimeMinutes === 3 ? "active" : ""}`}
              aria-pressed={settings.runtimeMinutes === 3}
              onClick={() => chooseRuntime(3)}
            >
              <strong>3-minute demo</strong>
              <small>About 435 words · 4 music cues · full cast</small>
            </button>
            <button
              type="button"
              className={`runtime-option ${settings.runtimeMinutes === 7 ? "active" : ""}`}
              aria-pressed={settings.runtimeMinutes === 7}
              onClick={() => chooseRuntime(7)}
            >
              <strong>7+ minute storyboard</strong>
              <small>Original 1,050+ word workflow · 7 music cues</small>
            </button>
          </div>
        </fieldset>
        <div className="toggle-row"><div><strong>Make me the lead</strong><small>Turn this on to use the name entered below as the main character</small></div><button aria-pressed={settings.useMe} className={`toggle ${settings.useMe ? "on" : ""}`} onClick={() => update("useMe", !settings.useMe)}><span /></button></div>
        <div className="field-grid">
          <label>Your name<input value={settings.yourName} onChange={(event) => update("yourName", event.target.value)} placeholder="Type your name, then turn on Make me the lead" autoComplete="name" /></label>
          {!settings.useMe && (
            <label>Main lead<input value={settings.lead} onChange={(event) => update("lead", event.target.value)} /></label>
          )}
          <label>Second character<input value={settings.rival} onChange={(event) => update("rival", event.target.value)} /></label>
        </div>
        <fieldset><legend>Sound locations</legend><button className={settings.places === 1 ? "choice active" : "choice"} onClick={() => update("places", 1)}>One place</button><button className={settings.places === 2 ? "choice active" : "choice"} onClick={() => update("places", 2)}>Two places</button></fieldset>
        <div className="cue-controls">
          <label>
            Music cues per episode
            <input
              type="number"
              min="1"
              max="20"
              value={settings.musicCueCount}
              onChange={(event) => update("musicCueCount", Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
            />
          </label>
          <div className="toggle-row compact">
            <div><strong>Optimize cue data</strong><small>Automatically make SFX, Ambient and Music cues search-ready when you Generate</small></div>
            <button aria-pressed={settings.optimizeCues} className={`toggle ${settings.optimizeCues ? "on" : ""}`} onClick={() => update("optimizeCues", !settings.optimizeCues)}><span /></button>
          </div>
          <div className="toggle-row compact ambient-range-option">
            <div><strong>Ambient cue ranges</strong><small>Automatically add semantic START/END cues when you Generate—no timecodes and no SFX ranges</small></div>
            <button aria-pressed={settings.ambientRanges} className={`toggle ${settings.ambientRanges ? "on" : ""}`} onClick={() => update("ambientRanges", !settings.ambientRanges)}><span /></button>
          </div>
          <div className="toggle-row compact cue-bank-option">
            <div>
              <strong>Training Cue Bank · Demo Lock</strong>
              <small>{TRAINING_CUE_BANK_META.distinctSfx} exact SFX + {TRAINING_CUE_BANK_META.distinctAmbient} exact Ambient names; maximum one new cue. Music stays on MUSIC POD.</small>
            </div>
            <button aria-pressed={settings.trainingCueBank} className={`toggle ${settings.trainingCueBank ? "on" : ""}`} onClick={() => update("trainingCueBank", !settings.trainingCueBank)}><span /></button>
          </div>
        </div>
        <div className="voice-direction">
          <div className="voice-direction-head">
            <div><span>ELEVENLABS PERFORMANCE</span><strong>🎤 Choose voices by name and sound</strong></div>
            <small>Voice metadata is loaded server-side. Paid speech generation still happens only on the REAPER Mac.</small>
          </div>
          <div className="voice-select-grid">
            <label>
              Audio model
              <select value={settings.elevenModel} onChange={(event) => update("elevenModel", event.target.value)}>
                {elevenModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </select>
            </label>
            <label>
              Performance taste
              <select value={settings.performanceTaste} onChange={(event) => update("performanceTaste", event.target.value)}>
                {performanceTastes.map((taste) => <option key={taste.id} value={taste.id}>{taste.label}</option>)}
              </select>
            </label>
          </div>

          <div className="voice-role-tabs" role="tablist" aria-label="Character receiving the selected voice">
            {(["narrator", "lead", "rival"] as VoiceRole[]).map((role) => {
              const voiceId = voiceIdForRole(role);
              return (
                <button
                  key={role}
                  type="button"
                  role="tab"
                  aria-selected={voiceRole === role}
                  className={voiceRole === role ? "active" : ""}
                  onClick={() => {
                    setVoiceRole(role);
                    setVoiceLimit(12);
                  }}
                >
                  <strong>{voiceLabelForRole(role)}</strong>
                  <small>{voiceById.get(voiceId)?.name || (voiceId ? "Saved REAPER voice" : "Choose a voice")}</small>
                </button>
              );
            })}
          </div>

          <div className="voice-browser-toolbar">
            <label>
              <span>🔍 Search voices</span>
              <input
                type="search"
                value={voiceSearch}
                onChange={(event) => {
                  setVoiceSearch(event.target.value);
                  setVoiceLimit(12);
                }}
                placeholder="Search by voice name, accent, age, or style"
                autoComplete="off"
              />
            </label>
            <p className={`voice-catalog-status ${voiceCatalogState}`} role="status">
              {voiceCatalogMessage}
              {voiceCatalogState === "error" && (
                <button type="button" onClick={() => setVoiceCatalogRevision((value) => value + 1)}>
                  Retry
                </button>
              )}
            </p>
          </div>

          {voiceCatalogState === "ready" && (
            <>
              <div className="voice-card-grid">
                {filteredVoiceOptions.slice(0, voiceLimit).map((voice) => {
                  const selected = voiceIdForRole(voiceRole) === voice.voiceId;
                  const labelEntries = Object.entries(voice.labels || {}).slice(0, 3);
                  return (
                    <article key={voice.voiceId} className={`voice-card ${selected ? "selected" : ""}`}>
                      <button
                        type="button"
                        className="voice-card-select"
                        aria-pressed={selected}
                        onClick={() => selectVoice(voiceRole, voice)}
                      >
                        <span className="voice-avatar" aria-hidden="true">🎤</span>
                        <span className="voice-card-copy">
                          <strong>{voice.name}</strong>
                          <small>{voice.category || "ElevenLabs voice"}</small>
                        </span>
                        <span className="voice-selected-mark" aria-hidden="true">{selected ? "✓" : "+"}</span>
                      </button>
                      {labelEntries.length > 0 && (
                        <div className="voice-labels">
                          {labelEntries.map(([key, value]) => <span key={`${voice.voiceId}-${key}`}>{value}</span>)}
                        </div>
                      )}
                      {voice.description && <p>{voice.description}</p>}
                      <button
                        type="button"
                        className="voice-preview"
                        onClick={() => void toggleVoicePreview(voice)}
                        disabled={!voice.previewUrl}
                      >
                        {previewingVoiceId === voice.voiceId ? "■ Stop preview" : voice.previewUrl ? "▶ Preview voice" : "Preview unavailable"}
                      </button>
                    </article>
                  );
                })}
              </div>
              {filteredVoiceOptions.length === 0 && (
                <div className="voice-empty">No voices match “{voiceSearch.trim()}”. Try a name, accent, or style.</div>
              )}
              {filteredVoiceOptions.length > voiceLimit && (
                <button type="button" className="voice-show-more" onClick={() => setVoiceLimit((value) => value + 12)}>
                  Show 12 more voices
                </button>
              )}
            </>
          )}

          <audio
            ref={voicePreviewRef}
            preload="none"
            onEnded={() => setPreviewingVoiceId(null)}
            onError={() => setPreviewingVoiceId(null)}
          />

          <details className="voice-manual-ids">
            <summary>Advanced: enter a voice ID manually</summary>
            <div className="voice-id-grid">
              <label>Narrator voice ID<input value={settings.narratorVoiceId} onChange={(event) => update("narratorVoiceId", event.target.value.trim())} placeholder="ElevenLabs voice ID" /></label>
              <label>{leadName} voice ID<input value={settings.leadVoiceId} onChange={(event) => update("leadVoiceId", event.target.value.trim())} placeholder="ElevenLabs voice ID" /></label>
              <label>{rivalName} voice ID<input value={settings.rivalVoiceId} onChange={(event) => update("rivalVoiceId", event.target.value.trim())} placeholder="ElevenLabs voice ID" /></label>
            </div>
          </details>
          <p>Import still writes the selected ID into <code>VO - Character-voiceID</code> behind the scenes. Generated speech remains on a separate <code>VO Audio - Character</code> track directly below.</p>
        </div>
        <div className="cast"><span>CAST</span>{characters.map((name) => <b key={name}>{name}</b>)}<i>Narrator</i></div>
        <button className="generate" onClick={generate} disabled={generating}>{generating ? `Generating ${selectedRuntime.shortLabel}…` : `Generate ${selectedRuntime.label}`} <span>→</span></button>
        <p className="status" role="status">{status}</p>
      </div>

      <div className="panel output-panel">
        <div className="panel-head">
          <div>
            <h2>3. REAPER-ready output</h2>
            <p>{output ? `${outputWords.toLocaleString()} spoken words · about ${outputMinutes} minutes` : settings.runtimeMinutes === 3 ? "Target: 420–470 spoken words." : "Minimum target: 1,050 spoken words."}</p>
          </div>
          {output && <div className="actions">
            <button className="range" onClick={() => void applyAmbientCueRanges()} disabled={ranging}>
              {ranging ? "Finding ranges…" : "Ambient Cue Range"}
            </button>
            <button className="optimize" onClick={() => void optimizeCueData()} disabled={optimizing}>
              {optimizing ? "Optimizing…" : "Optimize Cue Data"}
            </button>
            <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            <button className="download" onClick={download}>Download .txt</button>
          </div>}
        </div>
        {output ? <>
          <section className="story-transport" aria-label="REAPER story timeline">
            <div className="story-transport-head">
              <div><span>DAW TRANSPORT</span><strong>Story edit cursor</strong></div>
              <p>Click or drag to seek the REAPER edit cursor, jump between cues, then play the audio story.</p>
            </div>
            <div className="story-transport-controls">
              <button
                type="button"
                className={`story-play ${timelinePlaying ? "playing" : ""}`}
                onClick={toggleTimelinePlayback}
                disabled={runningReaperAction !== null}
                aria-label={timelinePlaying ? "Pause REAPER playback" : "Play REAPER audio story"}
                title="Play / Pause in REAPER"
              >
                {timelinePlaying ? "Ⅱ" : "▶"}
              </button>
              <output className="story-time" aria-label="Edit cursor time">{formatReaperTimecode(timelineCursorSeconds)} <span>/ {formatReaperTimecode(timelineDurationSeconds)}</span></output>
              <div
                className={`story-timeline ${timelineScrubbing ? "scrubbing" : ""}`}
                role="slider"
                tabIndex={0}
                aria-label="REAPER edit cursor"
                aria-valuemin={0}
                aria-valuemax={Math.round(timelineDurationSeconds)}
                aria-valuenow={Math.round(timelineCursorSeconds)}
                aria-valuetext={`${formatTimelineTime(timelineCursorSeconds)} of ${formatTimelineTime(timelineDurationSeconds)}`}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setTimelineScrubbing(true);
                  updateTimelineCursorFromPointer(event);
                }}
                onPointerMove={(event) => {
                  if (timelineScrubbing) updateTimelineCursorFromPointer(event);
                }}
                onPointerUp={(event) => {
                  if (!timelineScrubbing) return;
                  updateTimelineCursorFromPointer(event, true);
                  setTimelineScrubbing(false);
                }}
                onPointerCancel={() => setTimelineScrubbing(false)}
                onKeyDown={(event) => {
                  const adjustment = event.key === "ArrowLeft" ? -5 : event.key === "ArrowRight" ? 5 : 0;
                  if (!adjustment) return;
                  event.preventDefault();
                  commitTimelineCursor(timelineCursorSeconds + adjustment);
                }}
              >
                <div className="story-timeline-fill" style={{ width: `${(timelineCursorSeconds / timelineDurationSeconds) * 100}%` }} />
                {storyTimelineMarkers.map((marker, index) => <span
                  key={`${marker.type}-${marker.seconds}-${index}`}
                  className={`story-marker ${marker.type.toLowerCase()}`}
                  style={{ left: `${Math.min(100, (marker.seconds / timelineDurationSeconds) * 100)}%` }}
                  title={`${formatTimelineTime(marker.seconds)} · ${marker.type}: ${marker.label}`}
                  aria-hidden="true"
                />)}
                <span className="story-cursor" style={{ left: `${(timelineCursorSeconds / timelineDurationSeconds) * 100}%` }} aria-hidden="true" />
              </div>
            </div>
            <div className="story-transport-actions" aria-label="Timeline controls">
              <button type="button" onClick={() => commitTimelineCursor(0)} disabled={runningReaperAction !== null}>↺ Start</button>
              <button type="button" onClick={() => commitTimelineCursor(timelineCursorSeconds - 5)} disabled={runningReaperAction !== null}>−5 sec</button>
              <button type="button" onClick={jumpToNextCue} disabled={runningReaperAction !== null}>Next cue →</button>
            </div>
            <div className="story-legend"><span className="sfx">SFX</span><span className="ambient">Ambient</span><span className="music">Music</span><i>Click or drag the timeline · use the REAPER seek action</i></div>
          </section>
          <pre>{output}</pre>
        </> : <div className="empty"><div className="terminal-mark">›_</div><h3>Your selected production storyboard appears here.</h3><p>Choose three minutes or the original seven-minute format. Both include structured voice directions and cue tracks for REAPER.</p></div>}
      </div>

      <section className="panel reaper-panel" aria-labelledby="reaper-heading">
        <div className="reaper-heading">
          <div>
            <p className="reaper-kicker">REAPER CONNECTION</p>
            <h2 id="reaper-heading">4. Send the next step to REAPER</h2>
            <p>
              {isEmbeddedBridge
                ? "This studio is running inside the REAPER-hosted bridge, which has priority over other connection settings."
                : reaperMode === "remote"
                  ? "Use the secure Node relay to reach the paired REAPER Mac from mobile data or another network."
                  : "On this Mac, the buttons call REAPER directly. The existing REAPER Wi-Fi bridge remains available."}
            </p>
          </div>
          <span className={`local-badge ${remoteState === "online" ? "online" : ""}`}>
            {isEmbeddedBridge
              ? "REAPER WI-FI BRIDGE"
              : reaperMode === "local"
                ? "LOCAL + SAME WI-FI"
                : remoteState === "online"
                  ? "REMOTE REAPER ONLINE"
                  : remoteState === "relay-only"
                    ? "MAC / REAPER OFFLINE"
                    : remoteState === "connecting"
                      ? "REMOTE CONNECTING"
                      : "INTERNET RELAY"}
          </span>
        </div>
        <div className="reaper-connection">
          <div className="connection-tabs" role="tablist" aria-label="REAPER connection type">
            <button
              type="button"
              role="tab"
              aria-selected={isEmbeddedBridge || reaperMode === "local"}
              className={isEmbeddedBridge || reaperMode === "local" ? "active" : ""}
              onClick={() => chooseReaperMode("local")}
              disabled={isEmbeddedBridge}
            >
              Local / Wi-Fi
              <small>Current bridge and localhost controls</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!isEmbeddedBridge && reaperMode === "remote"}
              className={!isEmbeddedBridge && reaperMode === "remote" ? "active remote" : ""}
              onClick={() => chooseReaperMode("remote")}
              disabled={isEmbeddedBridge}
            >
              Internet Relay
              <small>Node companion · different networks</small>
            </button>
          </div>

          {isEmbeddedBridge ? (
            <div className="bridge-priority">
              <span className="connection-dot online" />
              <div><strong>REAPER-hosted bridge active</strong><small>The storyboard and existing action buttons continue through this bridge.</small></div>
            </div>
          ) : reaperMode === "remote" ? (
            <div className="remote-reaper-form">
              <div
                className={`remote-invite-card ${remoteInviteState}`}
                role="status"
                aria-live="polite"
              >
                <span className="remote-invite-kicker">PRIVATE REAPER INVITE</span>
                <strong>
                  {remoteInviteState === "accepted"
                    ? "Invite Accepted"
                    : remoteInviteState === "expired"
                      ? "Invite Expired"
                      : remoteInviteState === "invalid"
                        ? "Invite Invalid"
                        : "Guests: open the private link"}
                </strong>
                <p>{remoteInviteMessage}</p>
                <small>
                  A private invite is a replayable bearer link until it expires or the Mac launcher
                  stops. Do not forward it. Every paid voice build requires separate approval for
                  that exact request on the REAPER Mac.
                </small>
              </div>

              {remoteInviteState === "idle" && (
                <div className="remote-host-setup">
                  <div>
                    <span>ON THE REAPER MAC</span>
                    <strong>Create the private guest link</strong>
                    <p>
                      Unzip the package, double-click <code>Start Remote REAPER Demo.command</code>,
                      then send the complete link copied to the Mac clipboard.
                    </p>
                  </div>
                  <a href="/story-cue-reaper-remote.zip" download>
                    Download Mac demo package
                    <small>Node.js + cloudflared required once</small>
                  </a>
                </div>
              )}

              <div className={`remote-presence invite-presence ${remoteState}`}>
                <span className={`connection-dot ${remoteState === "online" ? "online" : ""}`} />
                <div>
                  <strong>{remoteState === "online" ? "Remote REAPER Online" : "Remote connection"}</strong>
                  <small>{remoteStateMessage}</small>
                </div>
              </div>

              <details className="remote-manual">
                <summary>
                  Advanced / manual connection
                  <span>Host setup and fallback controls</span>
                </summary>
                <div className="remote-manual-body">
                  <div className="remote-route" aria-label="Remote REAPER connection route">
                    <span>Online Studio</span>
                    <b aria-hidden="true">→</b>
                    <span>Secure WSS Relay</span>
                    <b aria-hidden="true">→</b>
                    <span>Node Companion on Mac</span>
                    <b aria-hidden="true">→</b>
                    <span>REAPER</span>
                  </div>
                  <div className="remote-fields">
                    <label>
                      Secure relay URL
                      <input
                        value={draftRemoteSettings.relayUrl}
                        onChange={(event) => updateDraftRemoteSetting("relayUrl", event.target.value)}
                        placeholder="wss://your-relay.example.com"
                        inputMode="url"
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={2048}
                      />
                    </label>
                    <label>
                      REAPER machine ID
                      <input
                        value={draftRemoteSettings.machineId}
                        onChange={(event) => updateDraftRemoteSetting("machineId", event.target.value)}
                        placeholder="sruthin-studio"
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={64}
                      />
                    </label>
                    <label>
                      Pairing token
                      <input
                        type="password"
                        value={draftRemoteSettings.pairingToken}
                        onChange={(event) => updateDraftRemoteSetting("pairingToken", event.target.value)}
                        placeholder="Same private token as the Mac companion"
                        autoComplete="new-password"
                        autoCapitalize="none"
                        spellCheck={false}
                        maxLength={256}
                      />
                    </label>
                  </div>
                  <div className="remote-connection-footer">
                    <div className="remote-buttons">
                      <button type="button" className="token-button" onClick={createNewPairingToken}>New token</button>
                      {remoteSettings.pairingToken && <button type="button" className="token-button danger" onClick={removeRemotePairingToken}>Remove token</button>}
                      <button type="button" className="token-button" onClick={downloadRemoteCompanionConfig}>Download config</button>
                      <button type="button" className="connect-button" onClick={saveAndConnectRemote}>Save &amp; Connect</button>
                    </div>
                  </div>
                  <a className="download-companion" href="/story-cue-reaper-remote.zip" download>Download the Node.js Mac companion package →</a>
                  <p className="remote-safety">Safety requirement: open a separate saved storyboard project and run <code>Enable Story Cue Studio Remote Target.lua</code>. The companion will refuse the master cue project.</p>
                  <p className="remote-privacy">Manual pairing tokens are saved on this browser until removed. Private invite credentials stay in session storage only and are removed from the address bar before connection. ElevenLabs credentials and generated audio remain on the REAPER Mac.</p>
                </div>
              </details>
            </div>
          ) : (
            <div className="local-connection-summary">
              <span className="connection-dot online" />
              <div><strong>Original local workflow retained</strong><small>Use localhost on this Mac or open the existing REAPER-hosted Wi-Fi bridge.</small></div>
            </div>
          )}
        </div>
        <div className="reaper-actions">
          {reaperActions.map((action, index) => (
            <button
              key={action.id}
              className={`reaper-action ${action.tone}`}
              disabled={runningReaperAction !== null}
              onClick={() => void sendReaperCommand(action)}
              aria-busy={runningReaperAction === action.id}
            >
              <span className="action-number">0{index + 1}</span>
              <span className="action-copy">
                <strong>{runningReaperAction === action.id ? "Sending…" : action.label}</strong>
                <small>{action.description}</small>
              </span>
              <span className="action-arrow" aria-hidden="true">→</span>
            </button>
          ))}
        </div>
        <p className="reaper-status" role="status">{reaperStatus}</p>
      </section>
    </section>

    {aiSettingsOpen && <div className="modal-shell">
      <button className="modal-backdrop" aria-label="Close AI settings" onClick={() => setAISettingsOpen(false)} />
      <section className="ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <div className="modal-head">
          <div><p>STORY MODEL</p><h2 id="ai-settings-title">AI Settings</h2></div>
          <button className="modal-close" aria-label="Close AI settings" onClick={() => setAISettingsOpen(false)}>×</button>
        </div>

        <div className="provider-tabs" role="tablist" aria-label="AI provider">
          {(["openai", "gemini", "groq", "compatible"] as AIProvider[]).map((provider) => (
            <button
              key={provider}
              role="tab"
              aria-selected={draftAISettings.provider === provider}
              className={draftAISettings.provider === provider ? "active" : ""}
              onClick={() => setDraftAISettings((previous) => ({ ...previous, provider }))}
            >
              {providerLabels[provider]}
            </button>
          ))}
        </div>

        <div className="ai-form">
          <label>
            API key
            <div className="secret-field">
              <input
                type={showAPIKey ? "text" : "password"}
                autoComplete="off"
                value={draftProviderConfig.apiKey}
                onChange={(event) => updateDraftProvider("apiKey", event.target.value)}
                placeholder={draftAISettings.provider === "gemini" ? "Gemini API key" : draftAISettings.provider === "groq" ? "Groq API key (gsk_…)" : "API key"}
              />
              <button type="button" onClick={() => setShowAPIKey((visible) => !visible)}>{showAPIKey ? "Hide" : "Show"}</button>
            </div>
          </label>
          <label>
            Model
            <input
              value={draftProviderConfig.model}
              onChange={(event) => updateDraftProvider("model", event.target.value)}
              placeholder={draftAISettings.provider === "openai" ? "gpt-5-nano" : draftAISettings.provider === "gemini" ? "gemini-3.6-flash" : draftAISettings.provider === "groq" ? "openai/gpt-oss-20b" : "Provider model ID"}
            />
          </label>
          {draftAISettings.provider === "openai" && <div className="groq-models" role="group" aria-label="OpenAI story model">
            <strong>Fast ChatGPT API models</strong>
            <div>
              {openAIModels.map((model) => <button
                key={model.id}
                type="button"
                className={draftProviderConfig.model === model.id ? "active" : ""}
                onClick={() => updateDraftProvider("model", model.id)}
              >
                <span>{model.label}</span>
                <small>{model.description}</small>
              </button>)}
            </div>
            <p><a className="api-key-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Get an OpenAI API key ↗</a></p>
          </div>}
          {draftAISettings.provider === "groq" && <div className="groq-models" role="group" aria-label="Groq story model">
            <strong>Fast REAPER-ready models</strong>
            <div>
              {groqModels.map((model) => <button
                key={model.id}
                type="button"
                className={draftProviderConfig.model === model.id ? "active" : ""}
                onClick={() => updateDraftProvider("model", model.id)}
              >
                <span>{model.label}</span>
                <small>{model.description}</small>
              </button>)}
            </div>
            <p>Groq uses its fixed official API endpoint. Choose Fast for the quickest story, SFX optimization, and Ambient range hand-off. <a className="api-key-link" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get a Groq API key ↗</a></p>
          </div>}
          {draftAISettings.provider === "compatible" && <label>
            OpenAI-compatible base URL
            <input
              value={draftProviderConfig.baseUrl}
              onChange={(event) => updateDraftProvider("baseUrl", event.target.value)}
              placeholder="https://openrouter.ai/api/v1"
            />
          </label>}
          <div className="privacy-note">
            <strong>Stored only on this browser</strong>
            <span>Your key is sent only when you generate or optimize cues. The site does not save it on the server.</span>
          </div>
          {draftAISettings.provider === "compatible" && <p className="compatible-note">Supported: OpenRouter, Together, Mistral, DeepSeek, Cerebras, and Fireworks. Use the dedicated Groq Fast tab for Groq.</p>}
        </div>

        <p className="ai-settings-status" role="status">{aiSettingsStatus}</p>
        <div className="modal-actions">
          <button className="remove-key" onClick={removeCurrentKey}>Remove key</button>
          <button className="cancel-settings" onClick={() => setAISettingsOpen(false)}>Cancel</button>
          <button className="save-settings" onClick={saveAISettings}>Save settings</button>
        </div>
      </section>
    </div>}
  </main>;
}
