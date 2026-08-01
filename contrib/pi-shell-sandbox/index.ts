// Pi extension entry point. Runtime behavior lives in sibling modules.
import {
  createBashToolDefinition,
  createLocalBashOperations,
  type BashOperations,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

import {
  createSandboxBashOperations,
  sandboxDiagnosticText,
} from "./sandbox.ts";
import {
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

const sandboxBashOperations: BashOperations = createSandboxBashOperations(
  createLocalBashOperations(),
);

function registerSecurityHandlers(pi: ExtensionAPI): void {
  pi.on("user_bash", () => ({ operations: guardedUserBashOperations }));
  pi.on("tool_call", guardToolCall);
}

function registerBashTool(pi: ExtensionAPI): void {
  pi.registerTool(
    createBashToolDefinition(sessionCwd, {
      operations: sandboxBashOperations,
      exposeSessionEnvironment: false,
      // The tool definition captures cwd, so rebind it for every call.
      spawnHook: (context) => ({ ...context, cwd: sessionCwd }),
    }),
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
    description: "Show the immutable shell sandbox status",
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
