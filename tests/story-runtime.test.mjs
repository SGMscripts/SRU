import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRuntimeMinutes,
  runtimeProfile,
  runtimeWordIssue,
} from "../app/story-runtime.ts";

test("offers the three-minute demo without replacing the seven-minute storyboard", () => {
  const demo = runtimeProfile(3);
  const storyboard = runtimeProfile(7);

  assert.deepEqual(
    {
      minutes: demo.minutes,
      minWords: demo.minWords,
      maxWords: demo.maxWords,
      music: demo.defaultMusicCues,
    },
    { minutes: 3, minWords: 420, maxWords: 470, music: 4 },
  );
  assert.deepEqual(
    {
      minutes: storyboard.minutes,
      minWords: storyboard.minWords,
      maxWords: storyboard.maxWords,
      music: storyboard.defaultMusicCues,
    },
    { minutes: 7, minWords: 1050, maxWords: null, music: 7 },
  );
});

test("normalizes new and restored runtime preferences safely", () => {
  assert.equal(normalizeRuntimeMinutes(3), 3);
  assert.equal(normalizeRuntimeMinutes("7"), 7);
  assert.equal(normalizeRuntimeMinutes(undefined), 3);
  assert.equal(normalizeRuntimeMinutes(99), 3);
});

test("validates the short upper bound while retaining the original long minimum", () => {
  assert.match(runtimeWordIssue(419, 3), /requires at least 420/);
  assert.equal(runtimeWordIssue(435, 3), "");
  assert.match(runtimeWordIssue(471, 3), /at or below 470/);
  assert.match(runtimeWordIssue(1049, 7), /requires at least 1050/);
  assert.equal(runtimeWordIssue(1050, 7), "");
  assert.equal(runtimeWordIssue(1400, 7), "");
});
