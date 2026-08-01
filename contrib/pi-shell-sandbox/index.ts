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
import { forgetTrust, rememberTrust } from "./mode.ts";
import {
  beginSession,
  resolveProject,
  sandboxStatus,
  setSandboxMode,
  shutdownSandbox,
  type TrustScope,
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
    description: `${sandboxTool.description} Commands run in the shell sandbox unless the current project is trusted, in which case they run directly on the host; the /sandbox command reports which. While the sandbox is on, set sandbox_permissions to require_escalated and provide a justification to request manual approval for host execution.`,
    promptGuidelines: [
      ...(sandboxTool.promptGuidelines ?? []),
      "Use the bash tool with sandbox_permissions=require_escalated and a concise justification only when a necessary command is blocked by the shell sandbox; the user must approve host execution.",
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

const SANDBOX_USAGE = "Usage: /sandbox [status|on|off|trust|untrust]";

function reportSandbox(ctx: any): void {
  const status = sandboxStatus();
  // A trusted project is a warning rather than an error: it is a state the
  // user chose, unlike a sandbox that failed to start.
  const level =
    status.phase === "active"
      ? "info"
      : status.mode === "disabled" && status.phase === "disabled"
        ? "warning"
        : "error";
  ctx.ui.notify(sandboxDiagnosticText(), level);
}

// Switching tears down the session's runtime temp directory, so let a command
// that is already running finish inside the sandbox it was wrapped for.
async function switchSandbox(
  ctx: any,
  next: "enforced" | "disabled",
  scope: TrustScope,
): Promise<void> {
  await ctx.waitForIdle?.();
  await setSandboxMode(next, String(ctx.cwd), ctx.ui, scope);
  reportSandbox(ctx);
}

async function trustProject(ctx: any): Promise<void> {
  const project = resolveProject(String(ctx.cwd));
  if (!ctx.hasUI) {
    ctx.ui.notify(
      "Remembering a trusted project requires interactive mode.",
      "error",
    );
    return;
  }

  const approved = await ctx.ui.confirm(
    "Trust this project",
    `Turn the shell sandbox off for ${project}, now and in future sessions?\n\n` +
      "Commands will run on the host, and anything inside the project will be " +
      "read and written without confirmation. /sandbox untrust undoes this.",
  );
  if (!approved) {
    return;
  }

  if (!rememberTrust(project)) {
    ctx.ui.notify(
      `${project} contains the trust store, so a remembered decision for it ` +
        "could be written by a sandboxed command. Use /sandbox off for this " +
        "session instead.",
      "error",
    );
    return;
  }
  await switchSandbox(ctx, "disabled", "remembered");
}

async function untrustProject(ctx: any): Promise<void> {
  const project = resolveProject(String(ctx.cwd));
  if (!forgetTrust(project)) {
    ctx.ui.notify(`${project} was not a remembered trusted project.`, "info");
  }
  await switchSandbox(ctx, "enforced", "session");
}

export async function runSandboxCommand(args: string, ctx: any): Promise<void> {
  switch (args.trim().toLowerCase()) {
    case "":
    case "status":
      reportSandbox(ctx);
      return;
    case "on":
      await switchSandbox(ctx, "enforced", "session");
      return;
    case "off":
      await switchSandbox(ctx, "disabled", "session");
      return;
    case "trust":
      await trustProject(ctx);
      return;
    case "untrust":
      await untrustProject(ctx);
      return;
    default:
      ctx.ui.notify(`Unknown /sandbox argument. ${SANDBOX_USAGE}`, "error");
  }
}

function registerSandboxCommand(pi: ExtensionAPI): void {
  pi.registerCommand("sandbox", {
    description:
      "Show or change shell sandbox state: status, on, off, trust, untrust",
    handler: runSandboxCommand,
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
