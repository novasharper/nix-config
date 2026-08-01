// Pi extension entry point. Runtime behavior lives in sibling modules.
import {
  createBashToolDefinition,
  createLocalBashOperations,
  type BashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  createSandboxBashOperations,
  sandboxDiagnosticText,
} from "./sandbox.ts";
import {
  consumeEscalationApproval,
  guardedUserBashOperations,
  guardToolCall,
  installSandboxBashOperations,
} from "./security.ts";
import {
  beginSession,
  sandboxStatus,
  shutdownSandbox,
} from "./session.ts";

let sessionCwd = process.cwd();

const localBashOperations = createLocalBashOperations();
const sandboxBashOperations: BashOperations =
  createSandboxBashOperations(localBashOperations);

const approvedBashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
  ),
  sandbox_permissions: Type.Optional(
    Type.Literal("require_escalated", {
      description: "Request manual approval for host execution",
    }),
  ),
  justification: Type.Optional(
    Type.String({
      description: "Why running outside the shell sandbox is necessary",
    }),
  ),
});

type BaseBashInput = { command: string; timeout?: number };

export function createApprovalBashToolDefinition(
  cwd: string,
  sandboxOperations: BashOperations,
  localOperations: BashOperations,
  currentCwd: () => string = () => cwd,
): any {
  const options = (operations: BashOperations) => ({
    operations,
    exposeSessionEnvironment: false,
    spawnHook: (context: any) => ({ ...context, cwd: currentCwd() }),
  });
  const sandboxTool = createBashToolDefinition(cwd, options(sandboxOperations));
  const localTool = createBashToolDefinition(cwd, options(localOperations));

  return {
    ...sandboxTool,
    description: `${sandboxTool.description} Commands run in the shell sandbox by default. Set sandbox_permissions to require_escalated and provide a justification to request manual approval for host execution.`,
    promptGuidelines: [
      ...(sandboxTool.promptGuidelines ?? []),
      "If a necessary command is blocked by the shell sandbox, retry it with sandbox_permissions=require_escalated and a concise justification. The user must approve host execution.",
    ],
    parameters: approvedBashSchema,
    async execute(
      toolCallId: string,
      input: Record<PropertyKey, unknown>,
      signal?: AbortSignal,
      onUpdate?: any,
      ctx?: any,
    ) {
      const bashInput = input as unknown as BaseBashInput;
      if (input.sandbox_permissions !== "require_escalated") {
        return sandboxTool.execute(
          toolCallId, bashInput, signal, onUpdate, ctx,
        );
      }
      if (!consumeEscalationApproval(input)) {
        throw new Error(
          "Unsandboxed command lacks manual approval; command refused.",
        );
      }
      return localTool.execute(toolCallId, bashInput, signal, onUpdate, ctx);
    },
  };
}

function registerSecurityHandlers(pi: ExtensionAPI): void {
  pi.on("user_bash", () => ({ operations: guardedUserBashOperations }));
  pi.on("tool_call", guardToolCall);
}

function registerBashTool(pi: ExtensionAPI): void {
  pi.registerTool(
    createApprovalBashToolDefinition(
      sessionCwd,
      sandboxBashOperations,
      localBashOperations,
      () => sessionCwd,
    ),
  );
}

function registerSessionLifecycle(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    sessionCwd = String(ctx.cwd);
    await beginSession(sessionCwd, ctx.ui);
  });

  pi.on("session_shutdown", async () => {
    await shutdownSandbox();
  });
}

function registerSandboxCommand(pi: ExtensionAPI): void {
  pi.registerCommand("sandbox", {
    description: "Show shell sandbox status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        sandboxDiagnosticText(),
        sandboxStatus().phase === "active" ? "info" : "error",
      );
    },
  });
}

export default function shellSandboxExtension(pi: ExtensionAPI): void {
  // Registration order is fail-closed and first-handler-wins.
  registerSecurityHandlers(pi);
  registerBashTool(pi);
  registerSessionLifecycle(pi);
  registerSandboxCommand(pi);

  // Keep the guard blocked if any registration above throws.
  installSandboxBashOperations(sandboxBashOperations);
}
