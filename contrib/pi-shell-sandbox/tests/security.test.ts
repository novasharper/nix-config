import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
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
    /credential and secret paths/,
  );
  assert.match(
    (await guard("write", { path: path.join(os.tmpdir(), "outside-project") }))
      .reason,
    /Writes outside the project/,
  );
  assert.equal(await guard("read", { path: "README.md" }), undefined);
});
