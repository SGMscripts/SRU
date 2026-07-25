import {
  TRAINING_AMBIENT_CUES,
  TRAINING_CUE_BANK_META,
  TRAINING_SFX_CUES,
} from "./training-cue-bank-data.ts";

export { TRAINING_CUE_BANK_META };

export type TrainingCueBankReport = {
  enabled: true;
  total: number;
  exact: number;
  remapped: number;
  novel: number;
  novelCues: string[];
  source: string;
};

type Family = "SFX" | "AMBIENT";

const CUE_PATTERN = /^\s*\[(SFX|AMBIENT):\s*(.*?)\]\s*$/i;
const GENERIC = new Set([
  "a",
  "an",
  "and",
  "at",
  "background",
  "big",
  "close",
  "distant",
  "effect",
  "from",
  "heavy",
  "in",
  "large",
  "light",
  "medium",
  "more",
  "noise",
  "of",
  "on",
  "or",
  "slow",
  "sound",
  "sounds",
  "the",
  "to",
  "very",
  "with",
]);

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(value: string) {
  let token = value;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      token = token.slice(0, -suffix.length);
      break;
    }
  }
  if (token.length >= 4 && token.at(-1) === token.at(-2)) token = token.slice(0, -1);
  return token;
}

function tokens(value: string) {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length > 1 && !GENERIC.has(token))
      .map(stem),
  );
}

function similarity(query: string, candidate: string) {
  const queryNormalized = normalize(query);
  const candidateNormalized = normalize(candidate);
  if (!queryNormalized || !candidateNormalized) return 0;
  if (queryNormalized === candidateNormalized) return 10;
  const queryTokens = tokens(query);
  const candidateTokens = tokens(candidate);
  const shared = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
  if (!shared) return 0;
  const union = new Set([...queryTokens, ...candidateTokens]).size || 1;
  const containment =
    queryNormalized.includes(candidateNormalized) || candidateNormalized.includes(queryNormalized)
      ? 0.35
      : 0;
  return shared / union + shared * 0.1 + containment;
}

const bankByFamily: Record<Family, readonly string[]> = {
  SFX: TRAINING_SFX_CUES,
  AMBIENT: TRAINING_AMBIENT_CUES,
};

const exactByFamily: Record<Family, Map<string, string>> = {
  SFX: new Map(TRAINING_SFX_CUES.map((cue) => [normalize(cue), cue])),
  AMBIENT: new Map(TRAINING_AMBIENT_CUES.map((cue) => [normalize(cue), cue])),
};

function splitAmbientState(value: string) {
  const state = value.match(/\|\s*(START|END)\s*$/i)?.[1]?.toUpperCase() || "";
  return {
    base: value.replace(/\|\s*(?:START|END)\s*$/i, "").trim(),
    state,
  };
}

function closestBankCue(family: Family, query: string) {
  let best = bankByFamily[family][0] || (family === "SFX" ? "impact" : "office");
  let bestScore = -1;
  for (const candidate of bankByFamily[family]) {
    const score = similarity(query, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return { cue: best, score: bestScore };
}

export function enforceTrainingCueBank(script: string, novelLimit = 1) {
  const novelKeys = new Set<string>();
  const novelCues: string[] = [];
  let total = 0;
  let exact = 0;
  let remapped = 0;

  const output = script.split(/\r?\n/).map((line) => {
    const match = line.match(CUE_PATTERN);
    if (!match) return line;
    const family = match[1].toUpperCase() as Family;
    const originalBody = match[2].trim();
    const { base, state } =
      family === "AMBIENT" ? splitAmbientState(originalBody) : { base: originalBody, state: "" };
    const normalized = normalize(base);
    const exactCue = exactByFamily[family].get(normalized);
    total += 1;
    if (exactCue) {
      exact += 1;
      return `[${family}: ${exactCue}${state ? ` | ${state}` : ""}]`;
    }

    const closest = closestBankCue(family, base);
    if (closest.score >= 0.43) {
      remapped += 1;
      return `[${family}: ${closest.cue}${state ? ` | ${state}` : ""}]`;
    }

    const novelKey = `${family}:${normalized}`;
    if (novelKeys.has(novelKey) || novelKeys.size < Math.max(0, novelLimit)) {
      if (!novelKeys.has(novelKey)) {
        novelKeys.add(novelKey);
        novelCues.push(`[${family}: ${base}]`);
      }
      return `[${family}: ${base}${state ? ` | ${state}` : ""}]`;
    }

    remapped += 1;
    return `[${family}: ${closest.cue}${state ? ` | ${state}` : ""}]`;
  }).join("\n");

  const report: TrainingCueBankReport = {
    enabled: true,
    total,
    exact,
    remapped,
    novel: novelKeys.size,
    novelCues,
    source: TRAINING_CUE_BANK_META.source,
  };
  return { script: output, report };
}

export function trainingCueBankInstructions() {
  return `Demo cue-bank lock:
- For SFX and Ambient, use literal cue names from the approved training bank below.
- Copy one complete approved value exactly. Never merge, abbreviate, translate, or rewrite approved values.
- You may introduce at most ONE new SFX or Ambient value in the complete episode, and only when none of the approved values can describe the story event.
- Repeated uses of that same one new value are allowed.
- Ambient START and END markers do not create two values; preserve the exact same base value in both markers.
- Music is not part of this RPP bank. Cue Recall handles Music separately through the MUSIC POD search database.

APPROVED SFX VALUES (${TRAINING_SFX_CUES.length}):
${JSON.stringify(TRAINING_SFX_CUES)}

APPROVED AMBIENT VALUES (${TRAINING_AMBIENT_CUES.length}):
${JSON.stringify(TRAINING_AMBIENT_CUES)}`;
}
