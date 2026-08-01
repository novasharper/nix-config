// Host-side guard, evaluated before a tool runs and independently of the
// sandbox policy. It blocks credential access lexically, confirms destructive
// commands, and holds the fail-closed bash delegate.
import path from "node:path";

import { errorMessage } from "./errors.ts";
import { resolveReal, resolveThroughBrokenLinks } from "./fs-paths.ts";
import type { SandboxBashOperations } from "./sandbox.ts";
import {
  accessesSecret,
  exposesSecretValue,
  isDestructiveCommand,
} from "./secrets.ts";

type GuardResult = { block: true; reason: string } | undefined;

const sandboxBashOperationsKey = Symbol.for(
  "nix-config.pi.shell-sandbox.operations",
);

function getSandboxBashOperations(): SandboxBashOperations | undefined {
  return (globalThis as Record<symbol, SandboxBashOperations | undefined>)[
    sandboxBashOperationsKey
  ];
}

// The absent delegate keeps model and user bash blocked during registration.
export function installSandboxBashOperations(
  operations: SandboxBashOperations,
): void {
  (globalThis as Record<symbol, SandboxBashOperations | undefined>)[
    sandboxBashOperationsKey
  ] = operations;
}

export const guardedUserBashOperations: SandboxBashOperations = {
  async exec(command, cwd, options) {
    const sandboxBashOperations = getSandboxBashOperations();
    if (!sandboxBashOperations) {
      throw new Error(
        "Shell sandbox is unavailable; refusing to run the command.",
      );
    }
    return sandboxBashOperations.exec(command, cwd, options);
  },
};

function blocked(reason: string): GuardResult {
  return { block: true, reason };
}

const fileTools = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const pathRequiredTools = new Set(["read", "write", "edit"]);
const writeTools = new Set(["write", "edit"]);

async function guardBashCall(command: unknown, ctx: any): Promise<GuardResult> {
  if (!getSandboxBashOperations()) {
    return blocked("Shell sandbox is unavailable; refusing to run the command.");
  }

  if (typeof command !== "string" || command.trim() === "") {
    return blocked("bash call without a command string is blocked.");
  }

  if (accessesSecret(command) || exposesSecretValue(command)) {
    return blocked(
      "Access to Pi credentials, provider secrets, and credential stores is blocked.",
    );
  }

  if (isDestructiveCommand(command)) {
    if (!ctx.hasUI) {
      return blocked("Destructive commands are blocked in non-interactive mode.");
    }

    const approved = await ctx.ui.confirm(
      "Potentially destructive command",
      `Allow this command?\n\n${command}`,
    );
    if (!approved) {
      return blocked("Command rejected by user.");
    }
  }
}

async function guardFileToolCall(
  toolName: string,
  requestedPath: unknown,
  ctx: any,
): Promise<GuardResult> {
  if (
    requestedPath === undefined ||
    requestedPath === null ||
    requestedPath === ""
  ) {
    if (pathRequiredTools.has(toolName)) {
      return blocked(`${toolName} call without a path is blocked.`);
    }
    // grep/find/ls default to the project directory.
    return;
  }

  if (typeof requestedPath !== "string") {
    return blocked(`${toolName} call with a non-string path is blocked.`);
  }

  const realCwd = resolveThroughBrokenLinks(String(ctx.cwd));
  const resolvedPath = resolveReal(requestedPath, realCwd);

  if (accessesSecret(requestedPath) || accessesSecret(resolvedPath)) {
    return blocked("Access to credential and secret paths is blocked.");
  }

  const escapesProject =
    resolvedPath !== realCwd &&
    !resolvedPath.startsWith(`${realCwd}${path.sep}`);
  if (writeTools.has(toolName) && escapesProject) {
    if (!ctx.hasUI) {
      return blocked(
        "Writes outside the project are blocked in non-interactive mode.",
      );
    }

    const approved = await ctx.ui.confirm(
      "Write outside project",
      `Allow ${toolName} to modify ${resolvedPath}?`,
    );
    if (!approved) {
      return blocked("Write rejected by user.");
    }
  }
}

async function evaluateToolCall(event: any, ctx: any): Promise<GuardResult> {
  if (event.toolName === "bash") {
    return guardBashCall(event.input?.command, ctx);
  }
  if (fileTools.has(event.toolName)) {
    return guardFileToolCall(event.toolName, event.input?.path, ctx);
  }
}

export async function guardToolCall(
  event: any,
  ctx: any,
): Promise<GuardResult> {
  try {
    return await evaluateToolCall(event, ctx);
  } catch (error) {
    return blocked(
      `Security extension failed (${errorMessage(error)}); blocking.`,
    );
  }
}
