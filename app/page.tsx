"use client";

import { useMemo, useState } from "react";

type Settings = {
  title: string;
  lead: string;
  rival: string;
  places: number;
  useMe: boolean;
};

type ReaperAction = {
  id: string;
  label: string;
  description: string;
  command: string;
  tone: "lime" | "orange" | "blue";
};

const reaperActions: ReaperAction[] = [
  {
    id: "story-importer",
    label: "Import Story",
    description: "Open Podcast Storyboard Importer and choose the downloaded TXT file.",
    command: "_RS99a1bb9381b40ba9ade9d82fa74add533356b26c",
    tone: "lime",
  },
  {
    id: "cue-recall",
    label: "Recall Cues",
    description: "Open Cue Recall for the imported SFX, ambience, and music cue items.",
    command: "_RSb33e9ff14b29c13afa557ac9abaae96dd2fb3f79",
    tone: "orange",
  },
  {
    id: "elevenlabs",
    label: "Generate Voices",
    description: "Open the ElevenLabs voice generator for the imported character tracks.",
    command: "_RS3f041675526b507bc147e0a1002e05e5b868215a",
    tone: "blue",
  },
];

const reaperBaseUrls = [
  "http://127.0.0.1:8080",
  "http://127.0.0.1:8089",
];

const sample = `Maya heard the phone ring in the abandoned station. Rain hammered the glass roof while she searched for the source. A familiar voice came through the receiver and warned her not to open the locked platform door. She opened it anyway. Beyond the door, Elias waited in the dark, holding her missing brother's jacket.`;

function clean(value: string, fallback: string) {
  return value.trim() || fallback;
}

function localStoryboard(story: string, settings: Settings) {
  const lead = clean(settings.lead, settings.useMe ? "You" : "Lead");
  const rival = clean(settings.rival, "Rival");
  const sentences = story.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [story];
  const placeOne = "PLACE 1 — MAIN STORY LOCATION, CONTINUOUS AND LOW UNDER VOICE";
  const placeTwo = "PLACE 2 — CONTRASTING INNER OR REVEAL LOCATION, QUIETER AND MORE INTIMATE";
  const lines = [
    `EPISODE — ${clean(settings.title, "UNTITLED STORY").toUpperCase()}`,
    "",
    `[AMBIENT: ${placeOne}]`,
    "[MUSIC: OPENING TENSION BED — LOW]",
    "",
  ];
  sentences.forEach((raw, index) => {
    const text = raw.trim();
    if (!text) return;
    const lower = text.toLowerCase();
    const isLead = new RegExp(`\\b${lead.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&").toLowerCase()}\\b`).test(lower);
    const isRival = new RegExp(`\\b${rival.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&").toLowerCase()}\\b`).test(lower);
    if (index > 0 && settings.places === 2 && index === Math.floor(sentences.length / 2)) {
      lines.push("[SFX: LOCATION TRANSITION WHOOSH]", `[AMBIENT: ${placeTwo}]`, "");
    }
    if (/(door|gun|phone|step|footstep|rain|hit|crash|knock|ring)/.test(lower)) {
      const cue = lower.includes("phone") || lower.includes("ring") ? "PHONE RING OR VIBRATION" : lower.includes("rain") ? "RAIN ON GLASS" : lower.includes("door") ? "DOOR HANDLE OR DOOR OPEN" : lower.includes("step") ? "TENSE FOOTSTEPS" : "IMPACT OR MOVEMENT ACCENT";
      lines.push(`[SFX: ${cue}]`);
    }
    if (isLead && /["“]/.test(text)) {
      lines.push(`[VOICE: speaker=${lead} | type=dialogue | emotion=tension | intensity=2 | delivery=restrained | pace=normal]`, text.replace(/[“”"]/g, ""));
    } else if (isRival && /["“]/.test(text)) {
      lines.push(`[VOICE: speaker=${rival} | type=dialogue | emotion=sarcasm | intensity=2 | delivery=restrained | pace=normal]`, text.replace(/[“”"]/g, ""));
    } else {
      const emotion = /(fear|dark|warning|danger|locked|abandoned|missing|rain)/.test(lower) ? "tension" : /(smile|laugh|happy)/.test(lower) ? "joy" : "neutral";
      lines.push(`[VOICE: speaker=Narrator | type=narration | emotion=${emotion} | intensity=${emotion === "neutral" ? 1 : 2} | delivery=restrained | pace=normal]`, text);
    }
    lines.push("");
  });
  if (settings.places === 2) lines.push(`[AMBIENT: PLACE 1 RETURNS — MAIN STORY LOCATION, FADE IN]`);
  lines.push("[MUSIC: ENDING STING — FADE OUT]");
  return lines.join("\n");
}

export default function Home() {
  const [story, setStory] = useState(sample);
  const [settings, setSettings] = useState<Settings>({ title: "The Last Signal", lead: "Maya", rival: "Elias", places: 2, useMe: false });
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("Ready to shape your story.");
  const [copied, setCopied] = useState(false);
  const [runningReaperAction, setRunningReaperAction] = useState<string | null>(null);
  const [reaperStatus, setReaperStatus] = useState("Open REAPER before using these buttons.");
  const characters = useMemo(() => [clean(settings.lead, settings.useMe ? "You" : "Lead"), clean(settings.rival, "Rival")], [settings]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) { setSettings((previous) => ({ ...previous, [key]: value })); }
  async function generate() {
    if (!story.trim()) { setStatus("Paste a story first."); return; }
    setStatus("Building your cue script…");
    const fallback = localStoryboard(story, settings);
    try {
      const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ story, settings }) });
      const data = await response.json();
      setOutput(data.script || fallback);
      setStatus(data.mode === "gpt" ? "GPT created your REAPER-ready script." : "Cue script created. Add an API key later for GPT story analysis.");
    } catch {
      setOutput(fallback);
      setStatus("Cue script created locally.");
    }
  }
  async function copy() { await navigator.clipboard.writeText(output); setCopied(true); setTimeout(() => setCopied(false), 1600); }
  function download() { const blob = new Blob([output], { type: "text/plain" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${clean(settings.title, "story").replace(/[^a-z0-9]+/gi, "-")}-cue-script.txt`; link.click(); URL.revokeObjectURL(link.href); }
  async function sendReaperCommand(action: ReaperAction) {
    setRunningReaperAction(action.id);
    setReaperStatus(`Sending “${action.label}” to REAPER…`);

    let sent = false;
    for (const baseUrl of reaperBaseUrls) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1500);
      try {
        await fetch(`${baseUrl}/_/${encodeURIComponent(action.command)};`, {
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
        ? `“${action.label}” was sent to REAPER.`
        : "REAPER could not be reached. Open REAPER and enable Web Control on port 8080 or 8089."
    );
  }

  return <main className="shell">
    <section className="hero">
      <p className="eyebrow">STORY → PERFORMANCE → REAPER</p>
      <h1>Story Cue Studio</h1>
      <p className="subhead">Turn a plain story into a two-character audio-drama script with narration, acting direction, places, ambience, music, and clean sound cues.</p>
      <div className="promise"><span>01</span> Narrator never speaks dialogue <span>02</span> Two character voices <span>03</span> Maximum two SFX per gap</div>
    </section>

    <section className="workspace">
      <div className="panel input-panel">
        <div className="panel-head"><h2>1. Your normal story</h2><button className="text-button" onClick={() => setStory(sample)}>Load example</button></div>
        <textarea aria-label="Normal story" value={story} onChange={(event) => setStory(event.target.value)} placeholder="Paste your story here…" />
        <p className="hint">Paste prose, a chapter, or a scene. The final script stays editable.</p>
      </div>

      <div className="panel director-panel">
        <h2>2. Direct the adaptation</h2>
        <label>Episode title<input value={settings.title} onChange={(event) => update("title", event.target.value)} /></label>
        <div className="toggle-row"><div><strong>Make me the lead</strong><small>Use “You” as the main character</small></div><button aria-pressed={settings.useMe} className={`toggle ${settings.useMe ? "on" : ""}`} onClick={() => update("useMe", !settings.useMe)}><span /></button></div>
        <div className="field-grid">
          <label>Main lead<input disabled={settings.useMe} value={settings.useMe ? "You" : settings.lead} onChange={(event) => update("lead", event.target.value)} /></label>
          <label>Second character<input value={settings.rival} onChange={(event) => update("rival", event.target.value)} /></label>
        </div>
        <fieldset><legend>Sound locations</legend><button className={settings.places === 1 ? "choice active" : "choice"} onClick={() => update("places", 1)}>One place</button><button className={settings.places === 2 ? "choice active" : "choice"} onClick={() => update("places", 2)}>Two places</button></fieldset>
        <div className="cast"><span>CAST</span>{characters.map((name) => <b key={name}>{name}</b>)}<i>Narrator</i></div>
        <button className="generate" onClick={generate}>Generate cue script <span>→</span></button>
        <p className="status" role="status">{status}</p>
      </div>

      <div className="panel output-panel">
        <div className="panel-head"><div><h2>3. REAPER-ready output</h2><p>Import directly with Podcast Storyboard Importer.</p></div>{output && <div className="actions"><button onClick={copy}>{copied ? "Copied" : "Copy"}</button><button className="download" onClick={download}>Download .txt</button></div>}</div>
        {output ? <pre>{output}</pre> : <div className="empty"><div className="terminal-mark">›_</div><h3>Your production script appears here.</h3><p>It will include structured voice directions and cue tracks, ready for your REAPER pipeline.</p></div>}
      </div>

      <section className="panel reaper-panel" aria-labelledby="reaper-heading">
        <div className="reaper-heading">
          <div>
            <p className="reaper-kicker">LOCAL REAPER CONTROL</p>
            <h2 id="reaper-heading">4. Send the next step to REAPER</h2>
            <p>Download your TXT first, keep REAPER open, then run each stage in order.</p>
          </div>
          <span className="local-badge">127.0.0.1</span>
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
  </main>;
}
