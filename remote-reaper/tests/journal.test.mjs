import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DuplicatePaidBuildError,
  FileJobJournal,
  SafetyLockError,
} from "../journal.mjs";
import { scriptHash } from "../protocol.mjs";

function command({
  requestId = "journal-job-0001",
  action = "build-play",
  script = "[VOICE: speaker=Narrator]\nStory text.\n[SFX: PHONE RING]",
  runtimeMinutes = 3,
} = {}) {
  return {
    requestId,
    action,
    scriptSha256: scriptHash(script),
    runtimeMinutes,
  };
}

async function temporaryJournal(context, start = 1_000_000) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "story-cue-journal-"));
  let now = start;
  const filePath = path.join(directory, "journal.json");
  const journal = new FileJobJournal({
    filePath,
    now: () => now++,
  });
  context.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, filePath, journal };
}

test("atomically records only sanitized job identity before completion", async (context) => {
  const { directory, filePath, journal } = await temporaryJournal(context);
  const job = command();
  await journal.initialize();
  await journal.begin(job);

  const raw = await readFile(filePath, "utf8");
  const stored = JSON.parse(raw);
  assert.equal(stored.safety.state, "running");
  assert.equal(stored.safety.requestId, job.requestId);
  assert.equal(stored.safety.scriptDigest, job.scriptSha256);
  assert.doesNotMatch(raw, /Story text|PHONE RING|pairing|api[_ -]?key/i);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  assert.deepEqual(
    (await readdir(directory)).filter((entry) => entry.endsWith(".tmp")),
    [],
  );

  await journal.complete(job);
  const completed = await journal.status();
  assert.equal(completed.safety.state, "idle");
  assert.equal(completed.lastCompleted.requestId, job.requestId);
  assert.equal(completed.completedBuilds[0].scriptDigest, job.scriptSha256);
});

test("turns an interrupted running checkpoint into a persistent attention lock", async (context) => {
  const { filePath, journal } = await temporaryJournal(context);
  const job = command();
  await journal.initialize();
  await journal.begin(job);

  const restarted = new FileJobJournal({ filePath, now: () => 2_000_000 });
  await restarted.initialize({ recoverInterrupted: true });
  const readiness = await restarted.readiness();
  assert.equal(readiness.ready, false);
  assert.equal(readiness.state, "needs_attention");
  assert.match(readiness.message, /inspect REAPER/i);
  await assert.rejects(
    restarted.begin(command({ requestId: "journal-job-0002" })),
    SafetyLockError,
  );

  await restarted.clearSafetyLock();
  assert.equal((await restarted.readiness()).ready, true);
});

test("preserves a failure lock until an explicit local clear", async (context) => {
  const { journal } = await temporaryJournal(context);
  const job = command({ requestId: "journal-job-0003", action: "story-importer" });
  await journal.initialize();
  await journal.begin(job);
  await journal.needsAttention(job);

  assert.equal((await journal.status()).safety.state, "needs_attention");
  await assert.rejects(
    journal.begin(command({ requestId: "journal-job-0004", action: "cue-recall" })),
    SafetyLockError,
  );
  await journal.clearSafetyLock();
  await journal.begin(command({ requestId: "journal-job-0004", action: "cue-recall" }));
});

test("blocks a duplicate completed paid build unless a one-shot override is armed", async (context) => {
  const { journal } = await temporaryJournal(context);
  const first = command({ requestId: "journal-build-0001" });
  await journal.initialize();
  await journal.begin(first);
  await journal.complete(first);

  const duplicate = command({ requestId: "journal-build-0002" });
  await assert.rejects(journal.begin(duplicate), DuplicatePaidBuildError);
  assert.equal((await journal.readiness()).ready, true);

  await journal.armRepeatBuildOverride();
  await journal.begin(duplicate);
  assert.equal((await journal.status()).repeatBuildOverride, null);
  await journal.complete(duplicate);

  const third = command({ requestId: "journal-build-0003" });
  await assert.rejects(journal.begin(third), DuplicatePaidBuildError);
});

test("does not apply paid-build duplicate history to non-paid actions", async (context) => {
  const { journal } = await temporaryJournal(context);
  const paid = command({ requestId: "journal-build-0004" });
  await journal.initialize();
  await journal.begin(paid);
  await journal.complete(paid);

  const importer = command({
    requestId: "journal-import-0001",
    action: "story-importer",
  });
  await journal.begin(importer);
  await journal.complete(importer);
  assert.equal((await journal.status()).lastCompleted.action, "story-importer");
});
