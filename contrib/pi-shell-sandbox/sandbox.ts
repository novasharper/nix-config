// Sandboxed command wrapping, execution, and diagnostics.
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

import { errorMessage } from "./errors.ts";
import { sanitizedEnvironment } from "./environment.ts";
import { allowedDomainSummary, commandSandboxConfig } from "./policy.ts";
import {
  awaitInitialization,
  requireActiveSandbox,
  sandboxStatus,
} from "./session.ts";

export type BashExecOptions = {
  onData: (data: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
};

export type SandboxBashOperations = {
  exec: (
    command: string,
    cwd: string,
    options: BashExecOptions,
  ) => Promise<{ exitCode: number | null }>;
};

// Wrapping failures refuse one command without latching the session.
export async function wrapForSandbox(
  command: string,
  project: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  try {
    const customConfig = commandSandboxConfig(
      project,
      SandboxManager.getConfig(),
    );

    // Always bash: $SHELL may change syntax and restore sanitized variables.
    const wrapped = await SandboxManager.wrapWithSandbox(
      command,
      "bash",
      customConfig,
      signal,
    );
    if (!wrapped.trim() || wrapped.trim() === command.trim()) {
      throw new Error("Sandbox Runtime returned an unwrapped command");
    }
    return wrapped;
  } catch (error) {
    throw new Error(
      `command wrapping failed: ${errorMessage(error)}; command refused.`,
    );
  }
}

export function createSandboxBashOperations(
  localOperations: SandboxBashOperations,
): SandboxBashOperations {
  return {
    async exec(command, cwd, options) {
      await awaitInitialization();
      const { project, runtimeTemp, cacheRoot } = requireActiveSandbox(cwd);
      const wrappedCommand = await wrapForSandbox(
        command,
        project,
        options.signal,
      );

      return localOperations.exec(wrappedCommand, cwd, {
        ...options,
        env: sanitizedEnvironment(options.env, runtimeTemp, cacheRoot),
      });
    },
  };
}

export function sandboxDiagnosticText(): string {
  const status = sandboxStatus();
  const lines = [
    `Shell sandbox: ${status.phase}`,
    `Backend: ${status.backend}`,
    `Project: ${status.project ?? "not initialized"}`,
    `Network: ${allowedDomainSummary()}`,
    "Unix sockets: blocked",
    "Local port binding: blocked",
    "Manual per-command host execution: enabled",
  ];
  if (status.error) {
    lines.push(`Failure: ${status.error}`);
  }
  return lines.join("\n");
}
