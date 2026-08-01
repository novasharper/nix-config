// Host-side guard, evaluated before a tool runs and independently of the
// sandbox policy. It gates credential access, confirms destructive commands,
// and holds the fail-closed bash delegate.
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

const escalationApproval = Symbol("pi-shell-sandbox.escalation-approval");

type EscalationInput = Record<PropertyKey, unknown>;

// Approval is attached as a module-private symbol after Pi validates the model
// input. The bash tool consumes it immediately before selecting host execution,
// so a model cannot forge approval with ordinary JSON tool arguments.
export function consumeEscalationApproval(input: EscalationInput): boolean {
  const approvedCommand = input[escalationApproval];
  delete input[escalationApproval];
  return (
    typeof approvedCommand === "string" &&
    approvedCommand === input.command
  );
}

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

async function approveBashEscalation(
  input: EscalationInput,
  command: string,
  title: string,
  explanation: string,
  ctx: any,
): Promise<GuardResult> {
  if (!ctx.hasUI) {
    return blocked(`${explanation} Approval requires interactive mode.`);
  }

  const approved = await ctx.ui.confirm(
    title,
    `${explanation}\n\nAllow this command to run outside the shell sandbox?\n\n${command}`,
  );
  if (!approved) {
    return blocked("Unsandboxed command rejected by user.");
  }

  input.sandbox_permissions = "require_escalated";
  input[escalationApproval] = command;
}

async function guardBashCall(input: any, ctx: any): Promise<GuardResult> {
  if (!getSandboxBashOperations()) {
    return blocked("Shell sandbox is unavailable; refusing to run the command.");
  }

  const command = input?.command;
  if (typeof command !== "string" || command.trim() === "") {
    return blocked("bash call without a command string is blocked.");
  }

  const requestedPermissions = input?.sandbox_permissions;
  if (
    requestedPermissions !== undefined &&
    requestedPermissions !== "require_escalated"
  ) {
    return blocked("Unknown bash sandbox permission request.");
  }

  if (requestedPermissions === "require_escalated") {
    const justification = input?.justification;
    if (typeof justification !== "string" || justification.trim() === "") {
      return blocked("Unsandboxed bash calls require a justification.");
    }
    return approveBashEscalation(
      input,
      command,
      "Run outside shell sandbox",
      `Reason: ${justification.trim()}`,
      ctx,
    );
  }

  if (accessesSecret(command) || exposesSecretValue(command)) {
    return approveBashEscalation(
      input,
      command,
      "Access protected data",
      "This command may read credentials, secrets, or credential stores.",
      ctx,
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
    if (!ctx.hasUI) {
      return blocked(
        "Credential and secret paths are blocked in non-interactive mode.",
      );
    }

    const approved = await ctx.ui.confirm(
      "Access protected path",
      `Allow ${toolName} to access ${resolvedPath}?`,
    );
    if (!approved) {
      return blocked("Protected path access rejected by user.");
    }
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
    return guardBashCall(event.input, ctx);
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
