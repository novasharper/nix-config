import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  consumeEscalationApproval,
  guardedUserBashOperations,
  guardToolCall,
  installSandboxBashOperations,
} from "../security.ts";
import {
  restoreSandboxBashOperationsAfter,
  tempProject,
  uninstallSandboxBashOperations,
} from "./test-support.ts";

test("security extension fails closed until sandbox operations are installed", async (context) => {
  restoreSandboxBashOperationsAfter(context);
  uninstallSandboxBashOperations();

  assert.deepEqual(
    await guardToolCall({ toolName: "bash", input: { command: "pwd" } }, {}),
    {
      block: true,
      reason: "Shell sandbox is unavailable; refusing to run the command.",
    },
  );

  assert.equal(
    await guardToolCall(
      { toolName: "read", input: { path: "README.md" } },
      { cwd: process.cwd(), hasUI: false },
    ),
    undefined,
    "file tools should remain available while shell execution is blocked",
  );

  await assert.rejects(
    guardedUserBashOperations.exec("pwd", "/", { onData() {} }),
    /Shell sandbox is unavailable/,
  );

  installSandboxBashOperations({
    async exec() {
      return { exitCode: 17 };
    },
  });
  assert.deepEqual(
    await guardedUserBashOperations.exec("pwd", "/", { onData() {} }),
    { exitCode: 17 },
  );
  assert.equal(
    await guardToolCall({ toolName: "bash", input: { command: "pwd" } }, {}),
    undefined,
  );
});

test("security guard still blocks credentials and unsafe host file operations", async (testContext) => {
  restoreSandboxBashOperationsAfter(testContext);
  installSandboxBashOperations({
    async exec() {
      return { exitCode: 0 };
    },
  });

  const context = {
    cwd: tempProject(testContext, "pi-security-test-"),
    hasUI: false,
  };
  const guard = (toolName: string, input: Record<string, unknown>) =>
    guardToolCall({ toolName, input }, context);

  for (const command of [
    "cat ~/.ssh/id_ed25519",
    "cat credentials.json",
    "cat .npmrc",
    "ls .ssh",
    "cat auth.json",
  ]) {
    assert.match(
      (await guard("bash", { command })).reason,
      /credentials/,
      `${command} should be blocked`,
    );
  }

  assert.match(
    (await guard("bash", { command: "rm -rf build" })).reason,
    /Destructive commands/,
  );
  assert.match(
    (await guard("read", { path: ".env" })).reason,
    /[Cc]redential and secret paths/,
  );
  assert.match(
    (await guard("write", { path: path.join(os.tmpdir(), "outside-project") }))
      .reason,
    /Writes outside the project/,
  );
  assert.equal(await guard("read", { path: "README.md" }), undefined);
});

test("protected access can proceed with one interactive approval", async (testContext) => {
  restoreSandboxBashOperationsAfter(testContext);
  installSandboxBashOperations({
    async exec() {
      return { exitCode: 0 };
    },
  });

  const confirmations: Array<{ title: string; message: string }> = [];
  const context = {
    cwd: tempProject(testContext, "pi-security-approval-test-"),
    hasUI: true,
    ui: {
      async confirm(title: string, message: string) {
        confirmations.push({ title, message });
        return true;
      },
    },
  };

  const bashInput: Record<PropertyKey, unknown> = {
    command: "cat .env",
  };
  assert.equal(
    await guardToolCall({ toolName: "bash", input: bashInput }, context),
    undefined,
  );
  assert.equal(bashInput.sandbox_permissions, "require_escalated");
  assert.equal(consumeEscalationApproval(bashInput), true);
  assert.equal(consumeEscalationApproval(bashInput), false);

  const rewrittenInput: Record<PropertyKey, unknown> = {
    command: "cat .env",
  };
  await guardToolCall({ toolName: "bash", input: rewrittenInput }, context);
  rewrittenInput.command = "cat ~/.ssh/id_ed25519";
  assert.equal(consumeEscalationApproval(rewrittenInput), false);

  assert.equal(
    await guardToolCall(
      { toolName: "read", input: { path: ".env" } },
      context,
    ),
    undefined,
  );
  assert.equal(confirmations.length, 3);
  assert.match(confirmations[0].message, /outside the shell sandbox/);
  assert.match(confirmations[2].message, /\.env/);
});

test("explicit host execution requires justification and approval", async (testContext) => {
  restoreSandboxBashOperationsAfter(testContext);
  installSandboxBashOperations({
    async exec() {
      return { exitCode: 0 };
    },
  });

  const input: Record<PropertyKey, unknown> = {
    command: "curl https://example.com",
    sandbox_permissions: "require_escalated",
  };
  assert.match(
    (
      await guardToolCall(
        { toolName: "bash", input },
        { cwd: process.cwd(), hasUI: true },
      )
    ).reason,
    /require a justification/,
  );

  input.justification = "The required host is not on the allowlist";
  assert.match(
    (
      await guardToolCall(
        { toolName: "bash", input },
        { cwd: process.cwd(), hasUI: false },
      )
    ).reason,
    /interactive mode/,
  );

  assert.match(
    (
      await guardToolCall(
        { toolName: "bash", input },
        {
          cwd: process.cwd(),
          hasUI: true,
          ui: { async confirm() { return false; } },
        },
      )
    ).reason,
    /rejected by user/,
  );
});
