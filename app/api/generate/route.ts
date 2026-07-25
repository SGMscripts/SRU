import { NextResponse } from "next/server";

type Provider = "openai" | "gemini" | "compatible";

type AIRequest = {
  provider?: Provider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
};

const MIN_SPOKEN_WORDS = 1050;
const TARGET_SPOKEN_WORDS = "1,100–1,250";
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

function cleanScript(value: string) {
  return value.trim().replace(/^```(?:text|txt|markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
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
  const lead = settings.useMe ? "You" : String(settings.lead || "Lead");
  const rival = String(settings.rival || "Rival");
  return `Convert the supplied prose into a complete REAPER PodcastVoice audio-drama cue script.

Runtime and story:
- Write ${TARGET_SPOKEN_WORDS} spoken words, excluding every directive and the episode-title line.
- Never return fewer than ${MIN_SPOKEN_WORDS} spoken words. This is required for at least seven minutes at normal narration speed.
- Expand short source material into a coherent setup, escalation, reversal, climax, and resolution.
- Preserve the source premise and important facts. Add meaningful scenes, action, sensory detail, decisions, and consequences; do not pad by repeating sentences.

Cast and format:
- Use only Narrator plus exactly two speaking characters: ${lead} and ${rival}.
- Narrator must never speak character dialogue.
- Put every spoken passage immediately after one [VOICE: speaker=... | type=... | emotion=... | intensity=0-3 | delivery=... | pace=...] directive.
- Use [AMBIENT:], [MUSIC:], and [SFX:] directives for sound design.
- Use ${Number(settings.places) === 1 ? "one sound location" : "no more than two sound locations"}.
- Never place more than two SFX directives between spoken passages.
- Begin with EPISODE — followed by the title.
- Return only the finished cue script, with no markdown fence or explanation.`;
}

function repairInstructions(settings: Record<string, unknown>) {
  return `${generationInstructions(settings)}

The supplied draft is too short. Rewrite it as a complete replacement. Keep its plot, cast, directives, and strongest writing, but deepen the scenes until the spoken text alone reaches ${TARGET_SPOKEN_WORDS}.`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      story?: string;
      settings?: Record<string, unknown>;
      ai?: AIRequest;
    };
    const story = String(body.story || "").trim();
    if (!story) return NextResponse.json({ mode: "error", error: "Paste a story first." }, { status: 400 });

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
    const input = `Title: ${String(settings.title || "Untitled")}
Places: ${Number(settings.places) || 2}
Source story:
${story}`;
    let script = cleanScript(await providerText(ai, generationInstructions(settings), input));
    let words = spokenWordCount(script);

    if (words < MIN_SPOKEN_WORDS) {
      script = cleanScript(await providerText(ai, repairInstructions(settings), `Short draft (${words} spoken words):\n\n${script}`));
      words = spokenWordCount(script);
    }
    if (words < MIN_SPOKEN_WORDS) {
      return NextResponse.json({
        mode: "error",
        error: `The selected model returned only ${words} spoken words after a retry. Choose a stronger model or increase its output limit.`,
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Story generation failed.";
    return NextResponse.json({ mode: "error", error: message }, { status: 502 });
  }
}
