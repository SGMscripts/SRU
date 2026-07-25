import assert from "node:assert/strict";
import test from "node:test";

import {
  TRAINING_AMBIENT_CUES,
  TRAINING_SFX_CUES,
} from "../app/training-cue-bank-data.ts";
import {
  enforceTrainingCueBank,
  TRAINING_CUE_BANK_META,
  trainingCueBankInstructions,
} from "../app/training-cue-bank.ts";

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

test("ships the exact reusable training catalog without malformed entries", () => {
  assert.equal(TRAINING_SFX_CUES.length, 388);
  assert.equal(TRAINING_AMBIENT_CUES.length, 78);
  assert.equal(TRAINING_CUE_BANK_META.reusableStacks, 557);

  for (const [family, cues] of [
    ["SFX", TRAINING_SFX_CUES],
    ["Ambient", TRAINING_AMBIENT_CUES],
  ]) {
    assert.equal(new Set(cues.map(normalize)).size, cues.length, `${family} normalized names must be unique`);
    for (const cue of cues) {
      assert.ok(cue.trim(), `${family} cue must not be blank`);
      assert.doesNotMatch(cue, /[\[\]\r\n]/, `${family} cue must contain only its tag body`);
      assert.ok(cue.length <= 100, `${family} cue must not contain pasted story text`);
    }
  }
  assert.ok(!TRAINING_AMBIENT_CUES.some((cue) => /^ambient\s*:/i.test(cue)));
});

test("enforces at most one unsupported SFX or Ambient cue", () => {
  const source = [
    "EPISODE — DEMO",
    "",
    "[AMBIENT: abandoned station interior | START]",
    "[VOICE: speaker=Narrator | type=narration]",
    "The narrator line must remain exactly unchanged.",
    "[SFX: DOOR OPEN]",
    "[SFX: impossible laser flower]",
    "[SFX: completely unknown clockwork dragon]",
    "[AMBIENT: abandoned station interior | END]",
    "[MUSIC: Scene: Demo | Summary: Tension rises | Mood: tense | Search: low strings]",
  ].join("\n");

  const constrained = enforceTrainingCueBank(source);
  assert.ok(constrained.report.novel <= 1);
  assert.equal(constrained.report.total, 5);
  assert.match(constrained.script, /\[AMBIENT: abandoned station interior \| START\]/);
  assert.match(constrained.script, /\[AMBIENT: abandoned station interior \| END\]/);
  assert.match(constrained.script, /The narrator line must remain exactly unchanged\./);
  assert.match(constrained.script, /\[VOICE: speaker=Narrator \| type=narration\]/);
  assert.match(constrained.script, /\[MUSIC: Scene: Demo \| Summary: Tension rises \| Mood: tense \| Search: low strings\]/);

  const allowed = {
    SFX: new Set(TRAINING_SFX_CUES.map(normalize)),
    AMBIENT: new Set(TRAINING_AMBIENT_CUES.map(normalize)),
  };
  const unsupported = new Set();
  for (const line of constrained.script.split(/\r?\n/)) {
    const match = line.match(/^\[(SFX|AMBIENT):\s*(.*?)\]$/i);
    if (!match) continue;
    const family = match[1].toUpperCase();
    const base = match[2].replace(/\|\s*(START|END)\s*$/i, "").trim();
    if (!allowed[family].has(normalize(base))) unsupported.add(`${family}:${normalize(base)}`);
  }
  assert.ok(unsupported.size <= 1);
  assert.equal(enforceTrainingCueBank(constrained.script).script, constrained.script);
});

test("gives AI providers the same literal cue-bank policy", () => {
  const instructions = trainingCueBankInstructions();
  assert.match(instructions, /at most ONE new SFX or Ambient value/i);
  assert.match(instructions, /Music is not part of this RPP bank/i);
  assert.match(instructions, new RegExp(`APPROVED SFX VALUES \\(${TRAINING_SFX_CUES.length}\\)`));
  assert.match(instructions, new RegExp(`APPROVED AMBIENT VALUES \\(${TRAINING_AMBIENT_CUES.length}\\)`));
});
