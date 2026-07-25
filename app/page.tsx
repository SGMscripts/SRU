"use client";

import { useEffect, useMemo, useState } from "react";

type Settings = {
  title: string;
  lead: string;
  rival: string;
  places: number;
  useMe: boolean;
};

type AIProvider = "openai" | "gemini" | "compatible";

type ProviderConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

type AISettings = {
  provider: AIProvider;
  openai: ProviderConfig;
  gemini: ProviderConfig;
  compatible: ProviderConfig;
};

type ReaperAction = {
  id: string;
  label: string;
  description: string;
  command: string;
  tone: "lime" | "orange" | "blue";
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

const MIN_SPOKEN_WORDS = 1050;
const WORDS_PER_MINUTE = 145;
const AI_STORAGE_KEY = "story-cue-studio-ai-settings-v1";

const defaultAISettings: AISettings = {
  provider: "openai",
  openai: { apiKey: "", model: "gpt-5.6-terra", baseUrl: "" },
  gemini: { apiKey: "", model: "gemini-3.6-flash", baseUrl: "" },
  compatible: { apiKey: "", model: "openai/gpt-5.6-terra", baseUrl: "https://openrouter.ai/api/v1" },
};

const providerLabels: Record<AIProvider, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
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

const expansionBeats: ExpansionBeat[] = [
  {
    sfx: "LOW ROOM TONE SHIFTS",
    music: "INVESTIGATION PULSE — SUBTLE",
    narratorA: (moment, lead) => `The meaning of the moment did not settle immediately. ${moment} ${lead} replayed every detail, separating what had truly happened from what fear and urgency had added afterward.`,
    lead: "We cannot rush past this. Something important is hiding inside the details, and I want to understand it before we make the next mistake.",
    narratorB: (_moment, lead, rival) => `${rival} watched ${lead} in silence. The pause between them carried its own warning, because both understood that the safest answer and the honest answer might lead in opposite directions.`,
    rival: "Understanding it will not make it harmless. Whatever we decide, we will still have to face the consequence together.",
    close: (_moment, lead) => `${lead} accepted that truth without answering. The situation had changed from a mystery into a choice, and every second of hesitation was quietly narrowing the choices that remained.`,
  },
  {
    sfx: "DISTANT MOVEMENT BEHIND WALL",
    narratorA: (moment, lead, rival) => `Pressure built around them in small, unmistakable signs. ${moment} ${lead} noticed the change first, while ${rival} studied the surrounding space for anything that did not belong.`,
    lead: "Stay close and listen. If this is meant to frighten us away, then someone is counting on us to stop asking questions.",
    narratorB: (_moment, lead, rival) => `For the first time, ${rival} looked less certain. Doubt did not weaken the warning in their voice; it made the warning feel earned, sharpened by something they had not yet admitted.`,
    rival: "There is more happening here than you know. If we continue, you may learn why I tried to keep you out of it.",
    close: (_moment, lead, rival) => `The admission opened a distance between ${lead} and ${rival}. It was not betrayal yet, but it was close enough that neither of them could pretend trust would survive without an explanation.`,
  },
  {
    sfx: "OBJECT SET DOWN WITH CONTROLLED IMPACT",
    music: "SUSPICION BED — SLOW BUILD",
    narratorA: (moment, lead) => `A new piece of the story forced everything into a different shape. ${moment} What had seemed accidental now carried intention, and ${lead} could finally see a pattern running beneath the confusion.`,
    lead: "You knew this could happen. Maybe not every detail, but enough to recognize the pattern when it started.",
    narratorB: (_moment, lead, rival) => `${rival} did not deny it. Their expression tightened as if the truth had been waiting behind their teeth, dangerous not because it was complicated, but because it was simple.`,
    rival: "I knew there was a risk. I did not know you would be placed at the center of it, and I was trying to buy us time.",
    close: (_moment, lead) => `Time had been purchased with silence, and the price was now visible. ${lead} felt anger rise, but beneath it was a colder realization: the threat was already close enough to act.`,
  },
  {
    sfx: "FOOTSTEPS APPROACH THEN STOP",
    narratorA: (moment, lead, rival) => `The next decision arrived before either of them was ready. ${moment} ${lead} and ${rival} heard the world around them become suddenly still, the kind of stillness that comes just before movement.`,
    lead: "We choose now. We can keep reacting to whatever comes through that door, or we can move first and control where this ends.",
    narratorB: (_moment, lead, rival) => `${rival} measured the proposal against every danger they had avoided naming. Running promised temporary safety. Moving forward promised answers, but it also removed the protection of uncertainty.`,
    rival: "If we move first, there is no going back to the life we had before tonight. Be certain that the truth is worth that cost.",
    close: (_moment, lead) => `${lead} was not certain. Certainty belonged to people with complete information, and they had almost none. What remained was resolve—the willingness to act while fear argued for delay.`,
  },
  {
    sfx: "FAST MECHANICAL OR ELECTRICAL PULSE",
    music: "DARK ACTION RHYTHM — ENTER",
    narratorA: (moment, lead) => `Their plan survived only until the world pushed back. ${moment} The response was faster and more precise than ${lead} expected, turning a careful approach into a race against consequences already in motion.`,
    lead: "Keep moving. Do not let the noise decide where you look. The real danger is using it to pull our attention away.",
    narratorB: (_moment, lead, rival) => `${rival} followed the instruction, covering the angle ${lead} could not see. For a brief stretch they moved as one unit, old distrust forced aside by the immediate need to survive.`,
    rival: "I see it. There is another route ahead, but once we take it, we will be exposed until we reach the other side.",
    close: (_moment, lead, rival) => `They committed without counting down. ${lead} moved first and ${rival} stayed close, while the pressure behind them grew loud enough to erase every thought except the next necessary step.`,
  },
  {
    sfx: "HEAVY IMPACT FOLLOWED BY SILENCE",
    narratorA: (moment, lead, rival) => `At the height of the struggle, the assumption guiding them finally broke. ${moment} ${lead} saw the hidden connection, and ${rival} understood from their expression that the entire conflict had changed.`,
    lead: "This was never only about stopping us. We were being pushed toward this exact place, and we followed the path they prepared.",
    narratorB: (_moment, lead, rival) => `${rival} turned toward the evidence with new fear. Every earlier warning now sounded different, not like an attempt to escape danger, but like part of the mechanism that had delivered them to it.`,
    rival: "Then we stop playing the role they gave us. We change the ending now, while they still believe we are trapped.",
    close: (_moment, lead) => `${lead} felt the balance shift. They were still outmatched, but surprise no longer belonged entirely to the other side. One honest decision could become the advantage they had been missing.`,
  },
  {
    sfx: "RISING ENERGY OR STRUCTURAL STRAIN",
    music: "CLIMACTIC TENSION — FULL",
    narratorA: (moment, lead, rival) => `The final confrontation gathered every unresolved choice into one place. ${moment} ${lead} stepped forward while ${rival} held the remaining route open, each trusting the other with a different part of the outcome.`,
    lead: "You wanted us divided and uncertain. That part worked. But you also gave us enough time to understand what matters, and that is the mistake you cannot take back.",
    narratorB: (_moment, lead, rival) => `${rival} answered with action rather than reassurance. The last barrier gave way, and the sound rolled through the space as the plan changed from possibility into irreversible motion.`,
    rival: "Finish it. I will hold this position for as long as you need, but you only get one chance to make the truth impossible to hide.",
    close: (_moment, lead) => `${lead} used that chance. Fear remained, loud and physical, but it no longer controlled the direction of the story. The decisive act belonged to the person who had once entered without answers.`,
  },
  {
    sfx: "TENSION RELEASE AND DISTANT AIR",
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

function voiceLine(
  lines: string[],
  speaker: string,
  type: "narration" | "dialogue",
  text: string,
  emotion = "tension",
  intensity = 2,
  pace = "normal",
) {
  lines.push(
    `[VOICE: speaker=${speaker} | type=${type} | emotion=${emotion} | intensity=${intensity} | delivery=restrained | pace=${pace}]`,
    text,
    "",
  );
}

function localStoryboard(story: string, settings: Settings) {
  const lead = clean(settings.lead, settings.useMe ? "You" : "Lead");
  const rival = clean(settings.rival, "Rival");
  const sentences = story.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [story];
  const safeMoments = sentences.map((sentence) => sentence.replace(/\[[^\]]+\]/g, "").replace(/[“”"]/g, "").trim()).filter(Boolean);
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
    const isLead = lower.includes(lead.toLowerCase());
    const isRival = lower.includes(rival.toLowerCase());
    if (index > 0 && settings.places === 2 && index === Math.floor(sentences.length / 2)) {
      lines.push("[SFX: LOCATION TRANSITION WHOOSH]", `[AMBIENT: ${placeTwo}]`, "");
    }
    if (/(door|gun|phone|step|footstep|rain|hit|crash|knock|ring)/.test(lower)) {
      const cue = lower.includes("phone") || lower.includes("ring")
        ? "PHONE RING OR VIBRATION"
        : lower.includes("rain")
          ? "RAIN ON GLASS"
          : lower.includes("door")
            ? "DOOR HANDLE OR DOOR OPEN"
            : lower.includes("step")
              ? "TENSE FOOTSTEPS"
              : "IMPACT OR MOVEMENT ACCENT";
      lines.push(`[SFX: ${cue}]`);
    }
    if (isLead && /["“]/.test(text)) {
      voiceLine(lines, lead, "dialogue", text.replace(/[“”"]/g, ""), "tension", 2);
    } else if (isRival && /["“]/.test(text)) {
      voiceLine(lines, rival, "dialogue", text.replace(/[“”"]/g, ""), "sarcasm", 2);
    } else {
      const emotion = /(fear|dark|warning|danger|locked|abandoned|missing|rain)/.test(lower) ? "tension" : /(smile|laugh|happy)/.test(lower) ? "joy" : "neutral";
      voiceLine(lines, "Narrator", "narration", text, emotion, emotion === "neutral" ? 1 : 2);
    }
  });

  let beatIndex = 0;
  while (spokenWordCount(lines.join("\n")) < MIN_SPOKEN_WORDS) {
    const beat = expansionBeats[beatIndex % expansionBeats.length];
    const moment = safeMoments[beatIndex % safeMoments.length] || "The situation changed before either person was ready.";
    if (beat.music) lines.push(`[MUSIC: ${beat.music}]`);
    if (settings.places === 2 && beatIndex === 3) lines.push(`[AMBIENT: ${placeTwo}]`);
    lines.push(`[SFX: ${beat.sfx}]`);
    voiceLine(lines, "Narrator", "narration", beat.narratorA(moment, lead, rival));
    voiceLine(lines, lead, "dialogue", beat.lead, "determination", 2);
    voiceLine(lines, "Narrator", "narration", beat.narratorB(moment, lead, rival));
    voiceLine(lines, rival, "dialogue", beat.rival, "tension", 2);
    voiceLine(lines, "Narrator", "narration", beat.close(moment, lead, rival));
    beatIndex += 1;
  }

  if (settings.places === 2) lines.push("[AMBIENT: PLACE 1 RETURNS — MAIN STORY LOCATION, FADE IN]");
  lines.push("[MUSIC: ENDING STING — FADE OUT]");
  return lines.join("\n");
}

function cloneAISettings(settings: AISettings): AISettings {
  return {
    provider: settings.provider,
    openai: { ...settings.openai },
    gemini: { ...settings.gemini },
    compatible: { ...settings.compatible },
  };
}

export default function Home() {
  const [story, setStory] = useState(sample);
  const [settings, setSettings] = useState<Settings>({ title: "The Last Signal", lead: "Maya", rival: "Elias", places: 2, useMe: false });
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("Ready to shape a seven-minute story.");
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [runningReaperAction, setRunningReaperAction] = useState<string | null>(null);
  const [reaperStatus, setReaperStatus] = useState("Open REAPER before using these buttons.");
  const [aiSettings, setAISettings] = useState<AISettings>(cloneAISettings(defaultAISettings));
  const [draftAISettings, setDraftAISettings] = useState<AISettings>(cloneAISettings(defaultAISettings));
  const [aiSettingsOpen, setAISettingsOpen] = useState(false);
  const [showAPIKey, setShowAPIKey] = useState(false);
  const [aiSettingsStatus, setAISettingsStatus] = useState("");
  const characters = useMemo(() => [clean(settings.lead, settings.useMe ? "You" : "Lead"), clean(settings.rival, "Rival")], [settings]);
  const outputWords = useMemo(() => spokenWordCount(output), [output]);
  const outputMinutes = outputWords ? (outputWords / WORDS_PER_MINUTE).toFixed(1) : "0.0";
  const activeProviderConfig = aiSettings[aiSettings.provider];
  const draftProviderConfig = draftAISettings[draftAISettings.provider];

  useEffect(() => {
    try {
      const saved = localStorage.getItem(AI_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<AISettings>;
      const restored: AISettings = {
        provider: parsed.provider === "gemini" || parsed.provider === "compatible" ? parsed.provider : "openai",
        openai: { ...defaultAISettings.openai, ...(parsed.openai || {}) },
        gemini: { ...defaultAISettings.gemini, ...(parsed.gemini || {}) },
        compatible: { ...defaultAISettings.compatible, ...(parsed.compatible || {}) },
      };
      setAISettings(restored);
      setDraftAISettings(cloneAISettings(restored));
    } catch {
      localStorage.removeItem(AI_STORAGE_KEY);
    }
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((previous) => ({ ...previous, [key]: value }));
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
    setStatus(`Building a seven-minute script with ${activeProviderConfig.apiKey ? providerLabels[aiSettings.provider] : "the local generator"}…`);
    const fallback = localStoryboard(story, settings);
    if (!activeProviderConfig.apiKey.trim()) {
      setOutput(fallback);
      const words = spokenWordCount(fallback);
      setStatus(`Local seven-minute script created: ${words.toLocaleString()} spoken words, about ${(words / WORDS_PER_MINUTE).toFixed(1)} minutes. Add an AI key for a richer adaptation.`);
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
      };
      if (!response.ok || !data.script) throw new Error(data.error || "The model did not return a cue script.");
      setOutput(data.script);
      setStatus(`${providerLabels[aiSettings.provider]} created ${Number(data.spokenWords || spokenWordCount(data.script)).toLocaleString()} spoken words, about ${data.estimatedMinutes || (spokenWordCount(data.script) / WORDS_PER_MINUTE).toFixed(1)} minutes.`);
    } catch (error) {
      setOutput(fallback);
      const message = error instanceof Error ? error.message : "AI generation failed.";
      setStatus(`${message} A seven-minute local version was created instead.`);
    } finally {
      setGenerating(false);
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

  async function sendReaperCommand(action: ReaperAction) {
    if (action.id === "story-importer") {
      if (!output.trim()) {
        setReaperStatus("Generate a cue script before importing it.");
        return;
      }
      try {
        await navigator.clipboard.writeText(output);
      } catch {
        setReaperStatus("Clipboard access was blocked. Use Copy, allow clipboard access, then try Import Story again.");
        return;
      }
    }

    setRunningReaperAction(action.id);
    setReaperStatus(action.id === "story-importer" ? "Script copied. Sending Import Story to REAPER…" : `Sending “${action.label}” to REAPER…`);
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
        ? action.id === "story-importer"
          ? "Script copied and Import Story was sent to REAPER."
          : `“${action.label}” was sent to REAPER.`
        : "REAPER could not be reached. Open REAPER and enable Web Control on port 8080 or 8089.",
    );
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
      <h1>Story Cue Studio</h1>
      <p className="subhead">Turn a plain story into a seven-minute, two-character audio drama with narration, acting direction, ambience, music, and clean sound cues.</p>
      <div className="promise"><span>01</span> 7+ minute runtime <span>02</span> Narrator never speaks dialogue <span>03</span> Two character voices <span>04</span> Maximum two SFX per gap</div>
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
        <div className="toggle-row"><div><strong>Make me the lead</strong><small>Use “You” as the main character</small></div><button aria-pressed={settings.useMe} className={`toggle ${settings.useMe ? "on" : ""}`} onClick={() => update("useMe", !settings.useMe)}><span /></button></div>
        <div className="field-grid">
          <label>Main lead<input disabled={settings.useMe} value={settings.useMe ? "You" : settings.lead} onChange={(event) => update("lead", event.target.value)} /></label>
          <label>Second character<input value={settings.rival} onChange={(event) => update("rival", event.target.value)} /></label>
        </div>
        <fieldset><legend>Sound locations</legend><button className={settings.places === 1 ? "choice active" : "choice"} onClick={() => update("places", 1)}>One place</button><button className={settings.places === 2 ? "choice active" : "choice"} onClick={() => update("places", 2)}>Two places</button></fieldset>
        <div className="cast"><span>CAST</span>{characters.map((name) => <b key={name}>{name}</b>)}<i>Narrator</i></div>
        <button className="generate" onClick={generate} disabled={generating}>{generating ? "Generating seven-minute script…" : "Generate 7+ minute cue script"} <span>→</span></button>
        <p className="status" role="status">{status}</p>
      </div>

      <div className="panel output-panel">
        <div className="panel-head">
          <div>
            <h2>3. REAPER-ready output</h2>
            <p>{output ? `${outputWords.toLocaleString()} spoken words · about ${outputMinutes} minutes` : "Minimum target: 1,050 spoken words."}</p>
          </div>
          {output && <div className="actions"><button onClick={copy}>{copied ? "Copied" : "Copy"}</button><button className="download" onClick={download}>Download .txt</button></div>}
        </div>
        {output ? <pre>{output}</pre> : <div className="empty"><div className="terminal-mark">›_</div><h3>Your seven-minute production script appears here.</h3><p>It will include structured voice directions and cue tracks, ready for your REAPER pipeline.</p></div>}
      </div>

      <section className="panel reaper-panel" aria-labelledby="reaper-heading">
        <div className="reaper-heading">
          <div>
            <p className="reaper-kicker">LOCAL REAPER CONTROL</p>
            <h2 id="reaper-heading">4. Send the next step to REAPER</h2>
            <p>Keep REAPER open. Import Story copies this output and sends it straight to the importer—no file picker.</p>
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

    {aiSettingsOpen && <div className="modal-shell">
      <button className="modal-backdrop" aria-label="Close AI settings" onClick={() => setAISettingsOpen(false)} />
      <section className="ai-modal" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <div className="modal-head">
          <div><p>STORY MODEL</p><h2 id="ai-settings-title">AI Settings</h2></div>
          <button className="modal-close" aria-label="Close AI settings" onClick={() => setAISettingsOpen(false)}>×</button>
        </div>

        <div className="provider-tabs" role="tablist" aria-label="AI provider">
          {(["openai", "gemini", "compatible"] as AIProvider[]).map((provider) => (
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
                placeholder={draftAISettings.provider === "gemini" ? "Gemini API key" : "API key"}
              />
              <button type="button" onClick={() => setShowAPIKey((visible) => !visible)}>{showAPIKey ? "Hide" : "Show"}</button>
            </div>
          </label>
          <label>
            Model
            <input
              value={draftProviderConfig.model}
              onChange={(event) => updateDraftProvider("model", event.target.value)}
              placeholder={draftAISettings.provider === "openai" ? "gpt-5.6-terra" : draftAISettings.provider === "gemini" ? "gemini-3.6-flash" : "Provider model ID"}
            />
          </label>
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
            <span>Your key is sent only when you generate a story. The site does not save it on the server.</span>
          </div>
          {draftAISettings.provider === "compatible" && <p className="compatible-note">Supported: OpenRouter, Groq, Together, Mistral, DeepSeek, Cerebras, and Fireworks.</p>}
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
