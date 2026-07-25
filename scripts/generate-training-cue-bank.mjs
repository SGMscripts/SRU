import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sourcePath = process.argv[2];
const outputPath = process.argv[3] || path.resolve("app/training-cue-bank-data.ts");

if (!sourcePath) {
  throw new Error(
    "Usage: node scripts/generate-training-cue-bank.mjs <cue_recall_bank.json> [output.ts]",
  );
}

const bank = JSON.parse(await readFile(sourcePath, "utf8"));

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function representativeScore(value, count) {
  const uppercaseLetters = (value.match(/[A-Z]/g) || []).length;
  const lowercaseLetters = (value.match(/[a-z]/g) || []).length;
  const sourceCaseBonus = uppercaseLetters > lowercaseLetters ? 2 : 0;
  return count * 10_000 + sourceCaseBonus * 100 - value.length;
}

function collect(family) {
  const byNormalized = new Map();
  for (const entry of Object.values(bank)) {
    if (entry.family !== family) continue;
    const query = clean(entry.query);
    const key = normalize(query);
    if (
      !key ||
      query.length > 100 ||
      query.includes("[") ||
      query.includes("]") ||
      (family === "ambient" && /^ambient\s*:/i.test(query)) ||
      !Array.isArray(entry.layers) ||
      entry.layers.length === 0
    ) {
      continue;
    }
    const group = byNormalized.get(key) || { total: 0, variants: new Map() };
    group.total += 1;
    group.variants.set(query, (group.variants.get(query) || 0) + 1);
    byNormalized.set(key, group);
  }

  return [...byNormalized.entries()]
    .map(([key, group]) => {
      const query = [...group.variants.entries()]
        .sort((a, b) => {
          const scoreDifference =
            representativeScore(b[0], b[1]) - representativeScore(a[0], a[1]);
          return scoreDifference || a[0].localeCompare(b[0]);
        })[0][0];
      return { key, query, occurrences: group.total };
    })
    .sort(
      (a, b) =>
        b.occurrences - a.occurrences ||
        a.query.localeCompare(b.query, "en", { sensitivity: "base" }),
    );
}

const sfx = collect("sfx");
const ambient = collect("ambient");

const source = `// Generated from the exact reusable stacks in:
// ai mastering training.RPP
// Regenerate with scripts/generate-training-cue-bank.mjs.

export const TRAINING_SFX_CUES = ${JSON.stringify(
  sfx.map((entry) => entry.query),
  null,
  2,
)} as const;

export const TRAINING_AMBIENT_CUES = ${JSON.stringify(
  ambient.map((entry) => entry.query),
  null,
  2,
)} as const;

export const TRAINING_CUE_BANK_META = {
  source: "ai mastering training.RPP",
  reusableStacks: ${Object.values(bank).filter((entry) => entry.family === "sfx" || entry.family === "ambient").length},
  sfxStacks: ${Object.values(bank).filter((entry) => entry.family === "sfx").length},
  ambientStacks: ${Object.values(bank).filter((entry) => entry.family === "ambient").length},
  distinctSfx: ${sfx.length},
  distinctAmbient: ${ambient.length},
  musicStacks: 0,
} as const;
`;

await writeFile(outputPath, source, "utf8");
console.log(
  `Wrote ${sfx.length} exact SFX cues and ${ambient.length} exact Ambient cues to ${outputPath}`,
);
