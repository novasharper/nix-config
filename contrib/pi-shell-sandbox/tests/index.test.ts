import assert from "node:assert/strict";
import test from "node:test";

import shellSandboxExtension from "../index.ts";
import {
  captureExtension,
  restoreSandboxBashOperationsAfter,
} from "./test-support.ts";

test("entry point registers fail-closed behavior in order", (context) => {
  restoreSandboxBashOperationsAfter(context);
  const { registrations } = captureExtension(shellSandboxExtension);

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
});

test("sandbox command reports the current immutable policy", async (context) => {
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
  assert.equal(notification?.level, "error");
});
