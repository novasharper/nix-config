import assert from "node:assert/strict";
import test from "node:test";

import shellSandboxExtension, {
  createApprovalBashToolDefinition,
} from "../index.ts";
import { guardToolCall, installSandboxBashOperations } from "../security.ts";
import {
  captureExtension,
  restoreSandboxBashOperationsAfter,
} from "./test-support.ts";

test("entry point registers fail-closed behavior in order", (context) => {
  restoreSandboxBashOperationsAfter(context);
  const { registrations, tools } = captureExtension(shellSandboxExtension);

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
