// Sandboxed command wrapping, execution, and diagnostics.
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

import { errorMessage } from "./errors.ts";
import { sanitizedEnvironment } from "./environment.ts";
import { allowedDomainSummary, commandSandboxConfig } from "./policy.ts";
import {
  awaitInitialization,
  requireActiveSandbox,
  requireTrustedSandbox,
  sandboxEnabled,
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

export async function wrapForTrustedProject(
  command: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  try {
    const wrapped = await SandboxManager.wrapWithSandbox(
      command,
      "bash",
      undefined,
      signal,
    );
    if (!wrapped.trim() || wrapped.trim() === command.trim()) {
      throw new Error("Sandbox Runtime returned an unwrapped command");
    }
    return wrapped;
  } catch (error) {
    throw new Error(
      `trusted write confinement failed: ${errorMessage(error)}; command refused.`,
    );
  }
}

export function createSandboxBashOperations(
  localOperations: SandboxBashOperations,
): SandboxBashOperations {
  return {
    async exec(command, cwd, options) {
      await awaitInitialization();

      // Both the model's bash tool and the user's `!` commands reach the host
      // through this delegate, so one check here covers every command path.
      // Trust removes read, network, and environment restrictions, but the
      // command stays wrapped by a project-only write policy. This covers both
      // model bash and user bash without trying to parse every program's write
      // behavior from a shell string.
      if (!sandboxEnabled()) {
        const { runtimeTemp } = requireTrustedSandbox();
        const wrappedCommand = await wrapForTrustedProject(
          command,
          options.signal,
        );
        return localOperations.exec(wrappedCommand, cwd, {
          ...options,
          // Trusted mode preserves the real provider environment, but Linux
          // children otherwise fall back to /tmp, which the write-only policy
          // deliberately does not allow. Point only their scratch directory
          // at the session temp already present in allowWrite.
          env: { ...(options.env ?? process.env), TMPDIR: runtimeTemp },
        });
      }

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
  const project = status.project ?? "not initialized";

  if (status.mode === "disabled") {
    if (status.phase !== "disabled") {
      return [
        "Shell sandbox: blocked — trusted write boundary unavailable",
        `Project: ${project}`,
        `Failure: ${status.error ?? "initialization incomplete"}`,
        "Commands are refused; /sandbox on restores full confinement.",
      ].join("\n");
    }
    return [
      `Shell sandbox: off — project trusted (${status.trustScope ?? "session"})`,
      `Project: ${project}`,
      "Inside the project: unrestricted",
      "Outside the project: writes are OS-blocked; approved escalation bypasses the boundary",
      "Destructive commands and credential dumps: confirmed",
      "Commands run on the host; /sandbox on re-enables the sandbox.",
    ].join("\n");
  }

  const lines = [
    `Shell sandbox: ${status.phase}`,
    `Backend: ${status.backend}`,
    `Project: ${project}`,
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
