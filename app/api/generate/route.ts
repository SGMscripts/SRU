import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const key = process.env.OPENAI_API_KEY;
  if (!key) return NextResponse.json({ mode: "local" });
  const settings = body.settings || {};
  const instructions = `Convert the supplied prose into a REAPER PodcastVoice cue script. Use only Narrator plus exactly two speaking characters: ${settings.useMe ? "You" : settings.lead || "Lead"} and ${settings.rival || "Rival"}. Narrator must never speak dialogue. Use [AMBIENT:], [MUSIC:], [SFX:], and [VOICE: speaker=... | type=... | emotion=... | intensity=0-3 | delivery=... | pace=...] directives. Use one or two places as requested. Never place more than two SFX directives between spoken lines. Return only the script.`;
  try {
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "gpt-5.6-sol", instructions, input: `Title: ${settings.title || "Untitled"}\nPlaces: ${settings.places || 2}\nStory:\n${body.story}` }) });
    if (!response.ok) throw new Error("GPT generation failed");
    const data = await response.json() as { output_text?: string };
    return NextResponse.json({ mode: "gpt", script: data.output_text || "" });
  } catch {
    return NextResponse.json({ mode: "local" });
  }
}
