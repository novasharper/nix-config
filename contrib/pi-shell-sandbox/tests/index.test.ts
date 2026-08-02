import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import shellSandboxExtension, {
  createApprovalBashToolDefinition,
  getSandboxArgumentCompletions,
  runSandboxCommand,
} from "../index.ts";
import { guardToolCall, installSandboxBashOperations } from "../security.ts";
import { beginSession, shutdownSandbox } from "../session.ts";
import {
  captureExtension,
  restoreSandboxBashOperationsAfter,
  tempProject,
  withEnvironmentOverrides,
  withStubbedSandboxManager,
} from "./test-support.ts";

test("entry point registers fail-closed behavior in order", (context) => {
  restoreSandboxBashOperationsAfter(context);
  const { registrations, tools, commands } = captureExtension(shellSandboxExtension);

  assert.deepEqual(registrations.slice(0, 3), [
    "event:user_bash",
    "event:tool_call",
    "tool:bash",
  ]);
  assert.equal(
    registrations.filter((entry) => entry === "event:user_bash").length,
    1,
  );
  assert.ok(registrations.includes("event:session_start"));
  assert.ok(registrations.includes("event:session_shutdown"));
  assert.ok(registrations.includes("command:sandbox"));
  const sandboxCommand = commands.get("sandbox");
  assert.ok(sandboxCommand);
  assert.equal(typeof sandboxCommand.getArgumentCompletions, "function");
  const bashTool = tools.get("bash");
  assert.ok(bashTool.parameters.properties.sandbox_permissions);
  assert.ok(bashTool.parameters.properties.justification);
  assert.ok(
    bashTool.promptGuidelines.some((guideline: string) =>
      guideline.startsWith("Use the bash tool ")
    ),
  );
});

test("sandbox command reports manual host execution", async (context) => {
  restoreSandboxBashOperationsAfter(context);
  const { commands } = captureExtension(shellSandboxExtension);
  const sandboxCommand = commands.get("sandbox");
  assert.ok(sandboxCommand);

  let notification: { message: string; level: string } | undefined;
  await sandboxCommand.handler("", {
    ui: {
      notify(message: string, level: string) {
        notification = { message, level };
      },
    },
  });

  assert.match(notification?.message ?? "", /^Shell sandbox: idle/m);
  assert.match(notification?.message ?? "", /Unix sockets: blocked/);
  assert.match(notification?.message ?? "", /Manual per-command host execution: enabled/);
  assert.equal(notification?.level, "error");
});

test("the sandbox command exposes argument completions for every subcommand", (context) => {
  restoreSandboxBashOperationsAfter(context);
  const { commands } = captureExtension(shellSandboxExtension);
  const sandboxCommand = commands.get("sandbox");
  assert.ok(sandboxCommand);
  assert.equal(
    sandboxCommand.getArgumentCompletions,
    getSandboxArgumentCompletions,
    "the registered completion must be the exported function",
  );

  const all = getSandboxArgumentCompletions("");
  assert.deepEqual(
    all.map((item) => item.value),
    ["status", "on", "off", "trust", "untrust"],
  );
  for (const item of all) {
    assert.equal(item.value, item.label);
    assert.ok(
      typeof item.description === "string" && item.description.length > 0,
      `${item.value} should carry a description`,
    );
  }

  assert.deepEqual(
    getSandboxArgumentCompletions("o").map((item) => item.value),
    ["on", "off"],
  );
  assert.deepEqual(
    getSandboxArgumentCompletions("un").map((item) => item.value),
    ["untrust"],
  );
  // Case-insensitive prefix matching.
  assert.deepEqual(
    getSandboxArgumentCompletions("ON").map((item) => item.value),
    ["on"],
  );
  assert.deepEqual(
    getSandboxArgumentCompletions("s").map((item) => item.value),
    ["status"],
  );
  assert.deepEqual(
    getSandboxArgumentCompletions("nope").map((item) => item.value),
    [],
  );
});

// Picking a completion inserts its value as the whole argument, so a value the
// switch in runSandboxCommand does not handle would autocomplete into an
// "Unknown /sandbox argument" error. Asserting the list against itself proves
// nothing, so this drives each offered value through the real handler.
test("every completion value is a subcommand the handler accepts", async (context) => {
  restoreSandboxBashOperationsAfter(context);
  const testRoot = tempProject(context, "pi-completion-handler-test-");
  const project = path.join(testRoot, "project");
  fs.mkdirSync(project);

  const notices: Array<[string, string]> = [];
  const ctx = {
    cwd: project,
    hasUI: true,
    ui: {
      notify(message: string, level: string) {
        notices.push([message, level]);
      },
      setStatus() {},
      async confirm() {
        return true;
      },
    },
  };
  const unknownArgument = /Unknown \/sandbox argument/;

  await withEnvironmentOverrides(
    {
      // Pin the mode and the trust store away from the developer's own.
      PI_SHELL_SANDBOX: undefined,
      XDG_STATE_HOME: path.join(testRoot, "state"),
      XDG_CACHE_HOME: path.join(testRoot, "cache"),
    },
    () =>
      withStubbedSandboxManager(async () => {
        await beginSession(project, ctx.ui);
        try {
          // trust and untrust run last and in that order, so the temp trust
          // store is left as it was found.
          for (const { value } of getSandboxArgumentCompletions("")) {
            notices.length = 0;
            await runSandboxCommand(value, ctx);
            assert.ok(
              !notices.some(([message]) => unknownArgument.test(message)),
              `/sandbox ${value} is offered as a completion but the handler rejects it`,
            );
          }
        } finally {
          await shutdownSandbox();
        }
      }),
  );

  // The loop above only means something if that message is still what an
  // unhandled argument produces.
  notices.length = 0;
  await runSandboxCommand("bogus", ctx);
  assert.match(notices.at(-1)?.[0] ?? "", unknownArgument);
});

test("the sandbox command rejects unknown and non-interactive requests", async (context) => {
  restoreSandboxBashOperationsAfter(context);
  const notices: Array<[string, string]> = [];
  const ctx = {
    cwd: process.cwd(),
    hasUI: false,
    ui: {
      notify(message: string, level: string) {
        notices.push([message, level]);
      },
      async confirm() {
        return true;
      },
    },
  };

  await runSandboxCommand("bogus", ctx);
  assert.match(notices.at(-1)?.[0] ?? "", /Unknown \/sandbox argument/);
  assert.equal(notices.at(-1)?.[1], "error");

  // Remembering a decision that outlives the session needs a user to confirm.
  await runSandboxCommand("trust", ctx);
  assert.match(notices.at(-1)?.[0] ?? "", /requires interactive mode/);
  assert.equal(notices.at(-1)?.[1], "error");

  await runSandboxCommand("status", ctx);
  assert.match(notices.at(-1)?.[0] ?? "", /^Shell sandbox: /m);
});

test("bash tool uses local operations only with consumed approval", async (context) => {
  restoreSandboxBashOperationsAfter(context);
  let sandboxCalls = 0;
  let localCalls = 0;
  const sandboxOperations = {
    async exec() {
      sandboxCalls += 1;
      return { exitCode: 0 };
    },
  };
  const localOperations = {
    async exec() {
      localCalls += 1;
      return { exitCode: 0 };
    },
  };
  installSandboxBashOperations(sandboxOperations);
  const tool = createApprovalBashToolDefinition(
    process.cwd(),
    sandboxOperations,
    localOperations,
  );

  await tool.execute("ordinary", { command: "pwd" });
  assert.equal(sandboxCalls, 1);
  assert.equal(localCalls, 0);

  const elevated: Record<PropertyKey, unknown> = {
    command: "cat .env",
    sandbox_permissions: "require_escalated",
    justification: "inspect the requested test fixture",
  };
  assert.equal(
    await guardToolCall(
      { toolName: "bash", input: elevated },
      {
        cwd: process.cwd(),
        hasUI: true,
        ui: { async confirm() { return true; } },
      },
    ),
    undefined,
  );
  await tool.execute("elevated", elevated);
  assert.equal(localCalls, 1);

  await assert.rejects(
    tool.execute("forged", {
      command: "pwd",
      sandbox_permissions: "require_escalated",
      justification: "forged without the guard",
    }),
    /lacks manual approval/,
  );
});
