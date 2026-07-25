import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import {
  APPLESCRIPT_APPROVAL_TIMEOUT_SECONDS,
  createMacPaidBuildApprover,
  FAILED_APPROVAL_COOLDOWN_MS,
  NODE_APPROVAL_TIMEOUT_MS,
  PAID_BUILD_APPROVAL_APPLESCRIPT,
} from "../mac-paid-approval.mjs";

test("uses one direct, deny-by-default osascript dialog with bounded timeouts", async () => {
  let invocation = null;
  const execFileImpl = (file, args, options, callback) => {
    invocation = { file, args, options };
    queueMicrotask(() => callback(null, "APPROVED\n", ""));
  };
  const approve = createMacPaidBuildApprover({
    execFileImpl,
    platform: "darwin",
  });

  const context = {
    title: "  EPISODE — THE LAST\nSIGNAL\u0000  ",
    runtimeMinutes: 7,
    requestId: "approval-request-0001",
    commandSha256: "a".repeat(64),
    scriptSha256: "b".repeat(64),
    expiresAt: 1_900_000_000_000,
    script: "SHOULD NEVER REACH OSASCRIPT",
    apiKey: "SHOULD NEVER REACH OSASCRIPT",
  };
  const decision = await approve(context);

  assert.deepEqual(decision, {
    approved: true,
    reason: "approved",
    binding: {
      requestId: context.requestId,
      commandSha256: context.commandSha256,
      scriptSha256: context.scriptSha256,
      expiresAt: context.expiresAt,
    },
  });
  assert.equal(invocation.file, "/usr/bin/osascript");
  assert.equal(invocation.options.timeout, NODE_APPROVAL_TIMEOUT_MS);
  assert.equal(invocation.options.shell, undefined);
  assert.equal(invocation.args[0], "-l");
  assert.equal(invocation.args[1], "AppleScript");
  assert.equal(invocation.args[2], "-e");
  assert.equal(invocation.args[3], PAID_BUILD_APPROVAL_APPLESCRIPT);
  assert.equal(invocation.args[4], "EPISODE — THE LAST SIGNAL");
  assert.equal(invocation.args[5], "7 minutes");
  assert.ok("approval-request-0001".endsWith(invocation.args[6]));
  assert.doesNotMatch(JSON.stringify(invocation.args), /SHOULD NEVER REACH OSASCRIPT/);

  assert.equal(APPLESCRIPT_APPROVAL_TIMEOUT_SECONDS, 45);
  assert.match(
    PAID_BUILD_APPROVAL_APPLESCRIPT,
    /«class btns»:\{"Deny", "Approve This Build"\}/,
  );
  assert.match(PAID_BUILD_APPROVAL_APPLESCRIPT, /«class dflt»:"Deny"/);
  assert.match(PAID_BUILD_APPROVAL_APPLESCRIPT, /«class cbtn»:"Deny"/);
  assert.match(PAID_BUILD_APPROVAL_APPLESCRIPT, /«class givu»:45/);
});

test("fails closed for denial, dialog timeout, malformed output, and process errors", async (context) => {
  const cases = [
    { name: "denial", error: null, stdout: "DENIED\n", reason: "denied" },
    { name: "dialog timeout", error: null, stdout: "TIMED_OUT\n", reason: "timeout" },
    { name: "malformed output", error: null, stdout: "yes", reason: "unavailable" },
    {
      name: "node timeout",
      error: Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" }),
      stdout: "",
      reason: "timeout",
    },
    {
      name: "process error",
      error: Object.assign(new Error("unavailable"), { code: "ENOENT" }),
      stdout: "",
      reason: "unavailable",
    },
  ];

  for (const entry of cases) {
    await context.test(entry.name, async () => {
      const approve = createMacPaidBuildApprover({
        platform: "darwin",
        execFileImpl(_file, _args, _options, callback) {
          queueMicrotask(() => callback(entry.error, entry.stdout, ""));
        },
      });
      assert.deepEqual(
        await approve({
          title: "Safe title",
          runtimeMinutes: 3,
          requestId: "approval-request-0002",
        }),
        { approved: false, reason: entry.reason },
      );
    });
  }
});

test("fails closed without launching a process off macOS", async () => {
  let calls = 0;
  const approve = createMacPaidBuildApprover({
    platform: "linux",
    execFileImpl() {
      calls += 1;
    },
  });
  assert.deepEqual(await approve({}), {
    approved: false,
    reason: "unavailable",
  });
  assert.equal(calls, 0);
});

test("fails closed when starting osascript throws synchronously", async () => {
  const approve = createMacPaidBuildApprover({
    platform: "darwin",
    execFileImpl() {
      throw new Error("spawn failed");
    },
  });
  assert.deepEqual(await approve({}), {
    approved: false,
    reason: "unavailable",
  });
});

test("the inert approval source parses as AppleScript on macOS", {
  skip: process.platform !== "darwin",
}, async () => {
  const inertSource = PAID_BUILD_APPROVAL_APPLESCRIPT.replace(
    "on run argv",
    'on run argv\n  return "COMPILED"',
  );
  const stdout = await new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      [
        "-l",
        "AppleScript",
        "-e",
        inertSource,
        "Test Episode",
        "3 minutes",
        "request-0001",
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 16 * 1024,
      },
      (error, value) => {
        if (error) reject(error);
        else resolve(String(value || ""));
      },
    );
  });
  assert.equal(stdout.trim(), "COMPILED");
});

test("applies a 25-second prompt cooldown after denial, timeout, or unavailability", async (context) => {
  assert.equal(FAILED_APPROVAL_COOLDOWN_MS, 25_000);
  assert.ok(FAILED_APPROVAL_COOLDOWN_MS >= 20_000);
  assert.ok(FAILED_APPROVAL_COOLDOWN_MS <= 30_000);

  const cases = [
    { name: "denial", error: null, stdout: "DENIED", reason: "denied" },
    { name: "timeout", error: null, stdout: "TIMED_OUT", reason: "timeout" },
    {
      name: "unavailable",
      error: Object.assign(new Error("unavailable"), { code: "ENOENT" }),
      stdout: "",
      reason: "unavailable",
    },
  ];

  for (const entry of cases) {
    await context.test(entry.name, async () => {
      let clock = 100_000;
      let launches = 0;
      const approve = createMacPaidBuildApprover({
        platform: "darwin",
        now: () => clock,
        execFileImpl(_file, _args, _options, callback) {
          launches += 1;
          queueMicrotask(() => callback(entry.error, entry.stdout, ""));
        },
      });
      const approvalContext = {
        title: "Safe title",
        runtimeMinutes: 3,
        requestId: `cooldown-${entry.name}-0001`,
        commandSha256: "c".repeat(64),
        scriptSha256: "d".repeat(64),
        expiresAt: 1_900_000_000_000,
      };

      assert.deepEqual(await approve(approvalContext), {
        approved: false,
        reason: entry.reason,
      });
      assert.equal(launches, 1);
      assert.deepEqual(await approve({
        ...approvalContext,
        requestId: `cooldown-${entry.name}-0002`,
      }), {
        approved: false,
        reason: "cooldown",
      });
      assert.equal(launches, 1);

      clock += FAILED_APPROVAL_COOLDOWN_MS;
      assert.deepEqual(await approve({
        ...approvalContext,
        requestId: `cooldown-${entry.name}-0003`,
      }), {
        approved: false,
        reason: entry.reason,
      });
      assert.equal(launches, 2);
    });
  }
});
