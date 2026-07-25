import { NextResponse } from "next/server";
import {
  enforceTrainingCueBank,
  trainingCueBankInstructions,
} from "../../training-cue-bank";
import {
  runtimeProfile,
  runtimeWordIssue,
} from "../../story-runtime";

type Provider = "openai" | "gemini" | "compatible";

type AIRequest = {
  provider?: Provider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

type CueType = "SFX" | "AMBIENT" | "MUSIC";

type CueRequest = {
  index: number;
  type: CueType;
  original: string;
  previousText: string;
  nextText: string;
};

const TRUSTED_COMPATIBLE_HOSTS = new Set([
  "openrouter.ai",
  "api.openrouter.ai",
  "api.groq.com",
  "api.together.xyz",
  "api.mistral.ai",
  "api.deepseek.com",
  "api.cerebras.ai",
  "api.fireworks.ai",
]);

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

function countCueType(script: string, type: CueType) {
  const pattern = new RegExp(`^\\s*\\[${type}:`, "i");
  return script.split(/\r?\n/).filter((line) => pattern.test(line)).length;
}

function cleanScript(value: string) {
  return value.trim().replace(/^```(?:text|txt|markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseJsonObject(value: string) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return valid cue data.");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function extractCueRequests(script: string) {
  const lines = script.split(/\r?\n/);
  const requests: CueRequest[] = [];
  const isStoryText = (line: string) => {
    const trimmed = line.trim();
    return Boolean(trimmed) && !trimmed.startsWith("[") && !/^EPISODE\b/i.test(trimmed);
  };
  lines.forEach((line, lineIndex) => {
    const match = line.match(/^\s*\[(SFX|AMBIENT|MUSIC):\s*(.*?)\]\s*$/i);
    if (!match) return;
    let previousText = "";
    let nextText = "";
    for (let index = lineIndex - 1; index >= 0; index -= 1) {
      if (isStoryText(lines[index])) {
        previousText = lines[index].trim().slice(0, 240);
        break;
      }
    }
    for (let index = lineIndex + 1; index < lines.length; index += 1) {
      if (isStoryText(lines[index])) {
        nextText = lines[index].trim().slice(0, 240);
        break;
      }
    }
    requests.push({
      index: lineIndex,
      type: match[1].toUpperCase() as CueType,
      original: line.trim(),
      previousText,
      nextText,
    });
  });
  return { lines, requests };
}

async function optimizeCueScript(ai: Required<AIRequest>, script: string, trainingCueBank: boolean) {
  const { lines, requests } = extractCueRequests(script);
  if (!requests.length) throw new Error("No SFX, Ambient, or Music cues were found.");
  const instructions = `You are a professional audio-drama sound designer preparing cue text for automated sound-library search.

Return one strict JSON object with this shape only:
{"cues":[{"index":12,"tag":"[SFX: door slam]"}]}

Rules:
- Return exactly one result for every input cue, preserving its numeric index and original cue type.
- Never rewrite dialogue, narration, titles, or VOICE directives.
- SFX: use one to three comma-separated chunks. Each chunk must contain one or two practical library-search words in lowercase and base form. Use "door slam", not a sentence. Remove names and words such as sound, noise, effect, suddenly, loudly, or slowly.
- AMBIENT: use only a concrete searchable location/environment of one to four words, such as "hospital room", "city street", or "abandoned station interior". Do not use ambience, atmosphere, background, fade, or voice.
- If an AMBIENT cue ends with | START or | END, preserve that exact range state. Never add range states to SFX.
- MUSIC: write one compact scene brief inside the tag using exactly: Scene: ... | Summary: ... | Mood: ... | Search: ...
- MUSIC Scene is 2–6 words; Summary is no more than 12 words; Mood has 2–4 comma-separated emotions; Search is a vivid phrase containing instrument, mood, and emotional arc.
- Use nearby story text to disambiguate abstract cues.
- Keep already-specific cues, but normalize their formatting.
- Never convert SFX, AMBIENT, and MUSIC into one another.
${trainingCueBank ? `\n${trainingCueBankInstructions()}` : ""}`;
  const raw = await providerText(ai, instructions, JSON.stringify({ cues: requests }));
  const parsed = parseJsonObject(raw);
  const returned = Array.isArray(parsed.cues) ? parsed.cues : [];
  const expected = new Map(requests.map((cue) => [cue.index, cue]));
  let optimizedCount = 0;
  for (const value of returned) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as { index?: unknown; tag?: unknown };
    const index = Number(candidate.index);
    const tag = String(candidate.tag || "").trim();
    const source = expected.get(index);
    if (!source) continue;
    const match = tag.match(/^\[(SFX|AMBIENT|MUSIC):\s*(.*?)\]$/i);
    if (!match || match[1].toUpperCase() !== source.type || !match[2].trim()) continue;
    if (source.type === "AMBIENT") {
      const sourceState = source.original.match(/\|\s*(START|END)\s*\]$/i)?.[1]?.toUpperCase() || "";
      const resultState = match[2].match(/\|\s*(START|END)\s*$/i)?.[1]?.toUpperCase() || "";
      if (sourceState !== resultState) continue;
    }
    lines[index] = `[${source.type}: ${match[2].trim()}]`;
    optimizedCount += 1;
  }
  if (!optimizedCount) throw new Error("The model did not return usable optimized cues.");
  const optimizedScript = lines.join("\n");
  if (!trainingCueBank) return { script: optimizedScript, optimizedCount };
  const constrained = enforceTrainingCueBank(optimizedScript);
  return { script: constrained.script, optimizedCount, cueBank: constrained.report };
}

function stripAmbientRanges(script: string) {
  return script.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*\[AMBIENT:\s*(.*?)\]\s*$/i);
    if (!match) return [line];
    const state = match[1].match(/\|\s*(START|END)\s*$/i)?.[1]?.toUpperCase();
    if (state === "END") return [];
    return [`[AMBIENT: ${match[1].replace(/\|\s*START\s*$/i, "").trim()}]`];
  }).join("\n");
}

async function applyAmbientCueRanges(ai: Required<AIRequest>, script: string, trainingCueBank: boolean) {
  const cleanScript = stripAmbientRanges(script);
  const lines = cleanScript.split(/\r?\n/);
  const ambientStarts = lines.flatMap((line, startLine) => {
    const match = line.match(/^\s*\[AMBIENT:\s*(.*?)\]\s*$/i);
    return match ? [{ cueId: `ambient-${startLine}`, startLine, location: match[1].trim() }] : [];
  });
  if (!ambientStarts.length) throw new Error("No Ambient cues were found.");

  const requests = ambientStarts.map((cue, index) => ({
    cue_id: cue.cueId,
    start_line: cue.startLine,
    location: cue.location,
    hard_max_line: (ambientStarts[index + 1]?.startLine ?? lines.length) - 1,
  }));
  const numberedScript = lines.map((line, index) => `${index}: ${line}`).join("\n");
  const instructions = `You are a senior audio-drama ambience editor.

Decide where every AMBIENT location bed stops in the numbered script. This is semantic cue ranging, not timing.

Rules:
- Analyze AMBIENT cues only. Never create ranges for SFX or MUSIC.
- An Ambient bed continues underneath dialogue, narration, Music cues, and short SFX that occur inside the same place.
- End it on the last story line where that environment is still present.
- End it when the story changes place, the environment explicitly stops or fades away, or another Ambient bed replaces it.
- Do not end Ambient merely because a Music or SFX cue appears.
- end_line must be at or after start_line and no later than hard_max_line.
- Use exact line numbers from the numbered script.
- Return every cue_id exactly once.
- Return only strict JSON in this shape:
{"ranges":[{"cue_id":"ambient-2","end_line":18,"confidence":"high","reason":"the characters leave the station"}]}`;

  const raw = await providerText(ai, instructions, JSON.stringify({ ambient_cues: requests, numbered_script: numberedScript }));
  const parsed = parseJsonObject(raw);
  const ranges = Array.isArray(parsed.ranges) ? parsed.ranges : [];
  const byId = new Map<string, { endLine: number }>();
  for (const value of ranges) {
    if (!value || typeof value !== "object") continue;
    const item = value as { cue_id?: unknown; end_line?: unknown };
    const cueId = String(item.cue_id || "");
    const endLine = Math.round(Number(item.end_line));
    if (cueId && Number.isFinite(endLine)) byId.set(cueId, { endLine });
  }

  const insertions: Array<{ endLine: number; marker: string }> = [];
  ambientStarts.forEach((cue, index) => {
    const hardMax = (ambientStarts[index + 1]?.startLine ?? lines.length) - 1;
    const requestedEnd = byId.get(cue.cueId)?.endLine ?? hardMax;
    let endLine = Math.max(cue.startLine, Math.min(hardMax, requestedEnd));
    if (/^\s*\[VOICE:/i.test(lines[endLine] || "")) {
      for (let candidate = endLine + 1; candidate <= hardMax; candidate += 1) {
        const trimmed = lines[candidate]?.trim() || "";
        if (trimmed && !trimmed.startsWith("[")) {
          endLine = candidate;
          break;
        }
      }
    }
    lines[cue.startLine] = `[AMBIENT: ${cue.location} | START]`;
    insertions.push({ endLine, marker: `[AMBIENT: ${cue.location} | END]` });
  });
  insertions.sort((a, b) => b.endLine - a.endLine).forEach(({ endLine, marker }) => {
    lines.splice(endLine + 1, 0, marker);
  });
  const rangedScript = lines.join("\n");
  if (!trainingCueBank) return { script: rangedScript, rangeCount: insertions.length };
  const constrained = enforceTrainingCueBank(rangedScript);
  return { script: constrained.script, rangeCount: insertions.length, cueBank: constrained.report };
}

function extractOpenAIText(data: Record<string, unknown>) {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  return output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? [text] : [];
    });
  }).join("\n");
}

function safeCompatibleBaseUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("The compatible API URL must use HTTPS.");
  }
  if (!TRUSTED_COMPATIBLE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("Use OpenRouter, Groq, Together, Mistral, DeepSeek, Cerebras, or Fireworks for the compatible provider.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

async function providerText(ai: Required<AIRequest>, instructions: string, input: string) {
  if (ai.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ai.apiKey}`,
      },
      body: JSON.stringify({
        model: ai.model,
        instructions,
        input,
        max_output_tokens: 12000,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${details.slice(0, 240)}`);
    }
    return extractOpenAIText(await response.json() as Record<string, unknown>);
  }

  if (ai.provider === "gemini") {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": ai.apiKey,
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: instructions }] },
        contents: [{ role: "user", parts: [{ text: input }] }],
        generationConfig: { maxOutputTokens: 12000 },
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Gemini request failed (${response.status}): ${details.slice(0, 240)}`);
    }
    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
  }

  const baseUrl = safeCompatibleBaseUrl(ai.baseUrl);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ai.apiKey}`,
    },
    body: JSON.stringify({
      model: ai.model,
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: input },
      ],
      max_tokens: 12000,
    }),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Compatible API request failed (${response.status}): ${details.slice(0, 240)}`);
  }
  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || "";
}

function generationInstructions(settings: Record<string, unknown>) {
  const profile = runtimeProfile(settings.runtimeMinutes);
  const lead = settings.useMe
    ? String(settings.yourName || "You").trim() || "You"
    : String(settings.lead || "Lead").trim() || "Lead";
  const rival = String(settings.rival || "Rival");
  const elevenModel = String(settings.elevenModel || "eleven_multilingual_v2");
  const performanceTaste = String(settings.performanceTaste || "cinematic");
  const narratorVoiceId = String(settings.narratorVoiceId || "").trim();
  const leadVoiceId = String(settings.leadVoiceId || "").trim();
  const rivalVoiceId = String(settings.rivalVoiceId || "").trim();
  const musicCueCount = Math.max(1, Math.min(20, Number(settings.musicCueCount) || profile.defaultMusicCues));
  const optimizeCues = settings.optimizeCues !== false;
  const ambientRanges = settings.ambientRanges !== false;
  const trainingCueBank = settings.trainingCueBank !== false;
  return `Convert the supplied prose into a complete REAPER PodcastVoice audio-drama cue script.

Runtime and story:
- Create the ${profile.label}.
- Aim for ${profile.targetWords} spoken words, excluding every directive and the episode-title line.
- Never return fewer than ${profile.minWords} spoken words.${profile.maxWords === null ? " This is required for at least seven minutes at normal narration speed." : ` Never return more than ${profile.maxWords} spoken words; the short version must remain a genuine three-minute demo.`}
- Expand short source material into a coherent setup, escalation, reversal, climax, and resolution.
- Preserve the source premise and important facts. Add meaningful scenes, action, sensory detail, decisions, and consequences; do not pad by repeating sentences.

Cast and format:
- Use only Narrator plus exactly two speaking characters: ${lead} and ${rival}.
- Narrator must never speak character dialogue.
- Direct the performances in a ${performanceTaste} style. Keep acting choices varied and appropriate to the moment rather than applying one emotion everywhere.
- Put every spoken passage immediately after one [VOICE: speaker=... | type=... | emotion=... | intensity=0-3 | delivery=... | pace=... | voice_id=... | model_id=${elevenModel} | performance_taste=${performanceTaste}] directive.
- Use these exact voice assignments in every matching directive:
  Narrator voice_id=${narratorVoiceId || "(leave empty)"}
  ${lead} voice_id=${leadVoiceId || "(leave empty)"}
  ${rival} voice_id=${rivalVoiceId || "(leave empty)"}
- Never invent, shorten, or swap a voice_id. Use model_id=${elevenModel} for every speaker.
- Use [AMBIENT:], [MUSIC:], and [SFX:] directives for sound design. Put each directive on its own line.
- Use ${Number(settings.places) === 1 ? "one sound location" : "no more than two sound locations"}.
- Never place more than two SFX directives between spoken passages.
- Place exactly ${musicCueCount} MUSIC cues across the episode's most important scenes, spread from opening through resolution.
- A MUSIC cue must be a single line in this format:
  [MUSIC: Scene: 2–6 word scene name | Summary: physical event in 12 words or fewer | Mood: 2–4 emotional descriptors | Search: instrument, mood, and evolving emotional arc]
- Each music cue must describe a new scene or emotional handoff. Do not repeat a music cue.
${optimizeCues ? `- Optimize all cue data for sound-library search.
- SFX must contain one to three comma-separated chunks of one or two lowercase search words: [SFX: door slam, lock click]. Use concrete object + action terms, base verbs, no character names, and never the words sound, noise, or effect.
- AMBIENT must contain only a concrete one-to-four-word location/environment: [AMBIENT: abandoned station interior]. Never use placeholder labels such as PLACE 1, main story location, ambience, atmosphere, background, fade, or under voice.` : "- Keep SFX and Ambient descriptions concise, concrete, and tied to the nearby story action."}
${ambientRanges ? `- Give every Ambient location a semantic range using paired cues:
  [AMBIENT: abandoned station interior | START]
  [AMBIENT: abandoned station interior | END]
- Put START where the place first becomes audible. Put END immediately after the last spoken/action line that still occurs there.
- Ambient continues underneath narration, dialogue, Music, and spot SFX until the place actually changes or stops.
- Every Ambient START must have one matching END with the exact same location text.
- These are story-position markers only: never include timecodes, seconds, or durations.
- Never add START or END to SFX or Music cues.` : "- Do not add START or END range markers."}
${trainingCueBank ? trainingCueBankInstructions() : ""}
- Begin with EPISODE — followed by the title.
- Return only the finished cue script, with no markdown fence or explanation.`;
}

function repairInstructions(settings: Record<string, unknown>, issue: string) {
  return `${generationInstructions(settings)}

The supplied draft does not meet the production requirements: ${issue}
Rewrite it as a complete replacement. Keep its plot, cast, directives, and strongest writing, but fix every stated requirement.`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      action?: string;
      story?: string;
      script?: string;
      settings?: Record<string, unknown>;
      ai?: AIRequest;
    };
    const requested = body.ai || {};
    const provider: Provider = requested.provider === "gemini" || requested.provider === "compatible" ? requested.provider : "openai";
    const defaults = {
      openai: "gpt-5.6-terra",
      gemini: "gemini-3.6-flash",
      compatible: "",
    };
    const ai: Required<AIRequest> = {
      provider,
      apiKey: String(requested.apiKey || (provider === "openai" ? process.env.OPENAI_API_KEY || "" : "")).trim(),
      model: String(requested.model || defaults[provider]).trim(),
      baseUrl: String(requested.baseUrl || "https://openrouter.ai/api/v1").trim(),
    };
    if (!ai.apiKey) return NextResponse.json({ mode: "local", reason: "missing_api_key" });
    if (!ai.model) return NextResponse.json({ mode: "error", error: "Enter a model name in AI Settings." }, { status: 400 });
    const settings = body.settings || {};
    const trainingCueBank = settings.trainingCueBank !== false;

    if (body.action === "optimize_cues") {
      const script = String(body.script || "").trim();
      if (!script) return NextResponse.json({ mode: "error", error: "Generate a cue script first." }, { status: 400 });
      const optimized = await optimizeCueScript(ai, script, trainingCueBank);
      return NextResponse.json({ mode: "ai", provider, model: ai.model, ...optimized });
    }
    if (body.action === "ambient_ranges") {
      const script = String(body.script || "").trim();
      if (!script) return NextResponse.json({ mode: "error", error: "Generate a cue script first." }, { status: 400 });
      const ranged = await applyAmbientCueRanges(ai, script, trainingCueBank);
      return NextResponse.json({ mode: "ai", provider, model: ai.model, ...ranged });
    }

    const story = String(body.story || "").trim();
    if (!story) return NextResponse.json({ mode: "error", error: "Paste a story first." }, { status: 400 });
    const profile = runtimeProfile(settings.runtimeMinutes);
    const input = `Title: ${String(settings.title || "Untitled")}
Runtime: ${profile.label}
Places: ${Number(settings.places) || 2}
Source story:
${story}`;
    let script = cleanScript(await providerText(ai, generationInstructions(settings), input));
    let words = spokenWordCount(script);
    const requestedMusicCues = Math.max(1, Math.min(20, Number(settings.musicCueCount) || profile.defaultMusicCues));
    let musicCues = countCueType(script, "MUSIC");
    const ambientRanges = settings.ambientRanges !== false;
    let ambientStarts = script.split(/\r?\n/).filter((line) => /^\s*\[AMBIENT:.*\|\s*START\s*\]\s*$/i.test(line)).length;
    let ambientEnds = script.split(/\r?\n/).filter((line) => /^\s*\[AMBIENT:.*\|\s*END\s*\]\s*$/i.test(line)).length;

    let wordIssue = runtimeWordIssue(words, profile.minutes);
    if (wordIssue || musicCues !== requestedMusicCues || (ambientRanges && (ambientStarts === 0 || ambientStarts !== ambientEnds))) {
      const issues = [
        wordIssue,
        musicCues !== requestedMusicCues ? `${musicCues} MUSIC cues instead of exactly ${requestedMusicCues}` : "",
        ambientRanges && (ambientStarts === 0 || ambientStarts !== ambientEnds)
          ? `${ambientStarts} Ambient START cues and ${ambientEnds} Ambient END cues; every location needs one matching pair`
          : "",
      ].filter(Boolean).join("; ");
      script = cleanScript(await providerText(ai, repairInstructions(settings, issues), `Draft to replace:\n\n${script}`));
      words = spokenWordCount(script);
      wordIssue = runtimeWordIssue(words, profile.minutes);
      musicCues = countCueType(script, "MUSIC");
      ambientStarts = script.split(/\r?\n/).filter((line) => /^\s*\[AMBIENT:.*\|\s*START\s*\]\s*$/i.test(line)).length;
      ambientEnds = script.split(/\r?\n/).filter((line) => /^\s*\[AMBIENT:.*\|\s*END\s*\]\s*$/i.test(line)).length;
    }
    let cueBank;
    if (trainingCueBank) {
      const constrained = enforceTrainingCueBank(script);
      script = constrained.script;
      cueBank = constrained.report;
    }
    if (wordIssue) {
      return NextResponse.json({
        mode: "error",
        error: `The selected model returned ${words} spoken words after a retry, outside the ${profile.label} requirement. Choose a stronger model or try again.`,
      }, { status: 502 });
    }
    if (musicCues !== requestedMusicCues) {
      return NextResponse.json({
        mode: "error",
        error: `The selected model returned ${musicCues} music cues after a retry; exactly ${requestedMusicCues} were requested.`,
      }, { status: 502 });
    }
    if (ambientRanges && (ambientStarts === 0 || ambientStarts !== ambientEnds)) {
      return NextResponse.json({
        mode: "error",
        error: `The selected model returned ${ambientStarts} Ambient START cues and ${ambientEnds} Ambient END cues after a retry.`,
      }, { status: 502 });
    }
    if (!script.includes("[VOICE:") || !/\[(?:SFX|AMBIENT|MUSIC):/i.test(script)) {
      return NextResponse.json({ mode: "error", error: "The selected model did not return a valid cue script." }, { status: 502 });
    }

    return NextResponse.json({
      mode: "ai",
      provider,
      model: ai.model,
      script,
      spokenWords: words,
      estimatedMinutes: Number((words / 145).toFixed(1)),
      cueBank,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Story generation failed.";
    return NextResponse.json({ mode: "error", error: message }, { status: 502 });
  }
}
