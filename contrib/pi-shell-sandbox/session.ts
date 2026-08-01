// Serialized Sandbox Runtime lifecycle and session status.
import fs from "node:fs";
import path from "node:path";

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

import { errorMessage } from "./errors.ts";
import { backendName, sandboxConfig, validatePlatformAssets } from "./policy.ts";
import {
  createSessionResources,
  redirectTempEnvironment,
  releaseSessionResources,
  type SessionResources,
} from "./session-resources.ts";

const STATUS_KEY = "pi-shell-sandbox";

type SandboxPhase =
  | "idle"
  | "initializing"
  | "active"
  | "failed"
  | "shutting-down";

type SandboxState = {
  phase: SandboxPhase;
  cwd?: string;
  backend?: string;
  error?: string;
  resources?: SessionResources;
};

export type SandboxStatus = {
  phase: SandboxPhase;
  backend: string;
  project: string | undefined;
  error: string | undefined;
};

export type ActiveSandbox = {
  project: string;
  runtimeTemp: string;
  cacheRoot: string;
};

let state: SandboxState = { phase: "idle" };
let initialization: Promise<void> | undefined;
let statusUi: any;

function setStatus(text: string | undefined): void {
  statusUi?.setStatus(STATUS_KEY, text);
}

function resolveProject(cwd: string): string {
  try {
    return fs.realpathSync.native(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

// Tear down without touching statusUi, so a re-initialization keeps reporting
// through the same UI handle.
async function releaseSandboxResources(snapshot: SandboxState): Promise<void> {
  try {
    await SandboxManager.reset();
  } catch {
    // Continue teardown; the caller reports whatever prompted it.
  }
  releaseSessionResources(snapshot.resources);
}

async function discardStaleSandbox(): Promise<void> {
  if (state.phase === "idle") {
    return;
  }
  const stale = state;
  state = { phase: "idle" };
  await releaseSandboxResources(stale);
}

async function activateRuntime(
  config: ReturnType<typeof sandboxConfig>,
): Promise<void> {
  validatePlatformAssets();
  await SandboxManager.reset();
  await SandboxManager.initialize(config);

  if (
    !SandboxManager.isSandboxingEnabled() ||
    !(await SandboxManager.waitForNetworkInitialization())
  ) {
    throw new Error("Sandbox Runtime did not become ready");
  }
}

async function initializeNow(cwd: string): Promise<void> {
  const project = resolveProject(cwd);

  // session_start's cwd can name a different project than the one the sandbox
  // was built for. Only a live sandbox already rooted at this project is
  // reusable: a different root needs a policy built from that tree, and a
  // previous failure may have been transient (a busy proxy port), so it is
  // retried rather than latched.
  if (state.phase === "active" && state.cwd === project) {
    return;
  }
  await discardStaleSandbox();

  state = { phase: "initializing", cwd: project };
  setStatus("sandbox: initializing");

  try {
    const resources = createSessionResources();
    state = { ...state, resources };
    // Built while TMPDIR still names macOS's real per-user T directory; the
    // redirect below has to happen after the policy captures it.
    const config = sandboxConfig(
      project,
      resources.runtimeTemp,
      resources.cacheRoot,
      resources.hostTmpdir,
    );
    redirectTempEnvironment(resources);

    await activateRuntime(config);

    state = {
      ...state,
      phase: "active",
      backend: backendName(),
      error: undefined,
    };
    setStatus(`sandbox: active (${state.backend})`);
  } catch (error) {
    const message = errorMessage(error);
    await releaseSandboxResources(state);
    state = {
      phase: "failed",
      cwd: project,
      error: message,
    };
    setStatus("sandbox: blocked (initialization failed)");
  }
}

// session_start also fires for resume, fork, and reload, so this can be
// re-entered while an earlier initialization is still running. Chaining every
// call onto the same promise — before any await — is what keeps two sandboxes
// from being built for one session and leaking a runtime temp directory.
function initializeForSession(cwd: string): Promise<void> {
  const pending = initialization ?? Promise.resolve();
  const next = pending.catch(() => {}).then(() => initializeNow(cwd));
  initialization = next.finally(() => {
    if (initialization === next) {
      initialization = undefined;
    }
  });
  return initialization;
}

export async function beginSession(cwd: string, ui: any): Promise<void> {
  statusUi = ui;
  await initializeForSession(cwd);
}

export async function awaitInitialization(): Promise<void> {
  if (initialization) {
    await initialization;
  }
}

export async function shutdownSandbox(): Promise<void> {
  await awaitInitialization();

  const snapshot = state;
  state = { ...state, phase: "shutting-down" };
  setStatus("sandbox: shutting down");

  try {
    await releaseSandboxResources(snapshot);
  } finally {
    state = { phase: "idle" };
    setStatus(undefined);
    statusUi = undefined;
  }
}

export function sandboxStatus(): SandboxStatus {
  return {
    phase: state.phase,
    backend: state.backend ?? backendName(),
    project: state.cwd,
    error: state.error,
  };
}

// Throws unless a live sandbox covers cwd; every command path goes through it.
export function requireActiveSandbox(cwd: string): ActiveSandbox {
  if (
    state.phase !== "active" ||
    !state.cwd ||
    !state.resources ||
    !SandboxManager.isSandboxingEnabled()
  ) {
    const detail = state.error ? `: ${state.error}` : "";
    throw new Error(`Shell sandbox is not active${detail}; command refused.`);
  }

  const requestedCwd = resolveProject(cwd);
  if (
    requestedCwd !== state.cwd &&
    !requestedCwd.startsWith(`${state.cwd}${path.sep}`)
  ) {
    throw new Error("Shell working directory is outside the sandboxed project.");
  }

  return {
    project: state.cwd,
    runtimeTemp: state.resources.runtimeTemp,
    cacheRoot: state.resources.cacheRoot,
  };
}
