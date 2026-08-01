// Serialized Sandbox Runtime lifecycle and session status.
import fs from "node:fs";
import path from "node:path";

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

import { errorMessage } from "./errors.ts";
import {
  configuredSetting,
  isRememberedTrusted,
  SANDBOX_SETTING_ENV,
  type SandboxMode,
} from "./mode.ts";
import {
  backendName,
  sandboxConfig,
  trustedRuntimeConfig,
  trustedSandboxConfig,
  validatePlatformAssets,
} from "./policy.ts";
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
  | "shutting-down"
  | "disabled";

// Where the current "off" came from, for the status line and diagnostics.
export type TrustScope = "session" | "remembered" | "configured";

type SandboxState = {
  phase: SandboxPhase;
  cwd?: string;
  backend?: string;
  error?: string;
  resources?: SessionResources;
};

export type SandboxStatus = {
  phase: SandboxPhase;
  mode: SandboxMode;
  trustScope: TrustScope | undefined;
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

let mode: SandboxMode = "enforced";
let trustScope: TrustScope | undefined;
// The project a `/sandbox on|off` was issued for. session_start also fires for
// resume and fork, and can report a different cwd; trusting one project must
// not carry into the next project the session moves into.
let sessionToggleProject: string | undefined;

function setStatus(text: string | undefined): void {
  statusUi?.setStatus(STATUS_KEY, text);
}

function disabledStatusText(): string {
  return `sandbox: off — project trusted (${trustScope ?? "session"})`;
}

// Exported so the trust store is keyed by the same spelling the session
// records; a store keyed by an unresolved path would never match.
export function resolveProject(cwd: string): string {
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

type ModeDecision = { mode: SandboxMode; scope: TrustScope | undefined };

// A toggle covers exactly the project it was issued for; every other project
// re-reads the remembered and configured sources.
function decideMode(project: string): ModeDecision {
  if (sessionToggleProject === project) {
    return { mode, scope: trustScope };
  }
  sessionToggleProject = undefined;

  if (isRememberedTrusted(project)) {
    return { mode: "disabled", scope: "remembered" };
  }
  if (configuredSetting() === "disabled") {
    return { mode: "disabled", scope: "configured" };
  }
  return { mode: "enforced", scope: undefined };
}

// Trust keeps only the OS-enforced project write boundary. Reads, network, and
// the provider environment are unrestricted, while an explicitly approved
// escalation can still select completely local execution.
async function enterDisabled(project: string): Promise<void> {
  await discardStaleSandbox();
  state = { phase: "initializing", cwd: project };
  setStatus("sandbox: initializing trusted write boundary");

  try {
    const resources = createSessionResources();
    state = { ...state, resources };
    redirectTempEnvironment(resources);
    const initialConfig = trustedSandboxConfig(project, resources.runtimeTemp);
    await activateRuntime(initialConfig);
    SandboxManager.updateConfig(trustedRuntimeConfig(initialConfig));
    state = {
      ...state,
      phase: "disabled",
      backend: backendName(),
      error: undefined,
    };
    setStatus(disabledStatusText());
  } catch (error) {
    const message = errorMessage(error);
    await releaseSandboxResources(state);
    state = { phase: "failed", cwd: project, error: message };
    setStatus("sandbox: blocked (trusted write boundary failed)");
  }
}

async function initializeNow(cwd: string): Promise<void> {
  const project = resolveProject(cwd);

  const decision = decideMode(project);
  mode = decision.mode;
  trustScope = decision.scope;
  if (mode === "disabled") {
    await enterDisabled(project);
    return;
  }

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

function reportStartupMode(ui: any): void {
  if (configuredSetting() === "invalid") {
    ui?.notify?.(
      `${SANDBOX_SETTING_ENV} is not a recognized on/off value; the shell sandbox stays on.`,
      "warning",
    );
  }
  if (mode !== "disabled" || state.phase !== "disabled") {
    return;
  }
  ui?.notify?.(
    `Shell sandbox off: ${state.cwd} is trusted (${trustScope ?? "session"}). ` +
      "Commands run on the host; /sandbox on re-enables it.",
    "warning",
  );
}

export async function beginSession(cwd: string, ui: any): Promise<void> {
  statusUi = ui;
  await initializeForSession(cwd);
  reportStartupMode(ui);
}

// Applies a user decision to the current project and routes it through the
// same serialized chain as session_start, so a toggle cannot race an
// initialization that is still running.
export async function setSandboxMode(
  next: SandboxMode,
  cwd: string,
  ui: any,
  scope: TrustScope = "session",
): Promise<void> {
  statusUi = ui;
  sessionToggleProject = resolveProject(cwd);
  mode = next;
  trustScope = next === "disabled" ? scope : undefined;
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
    // The session is over, so its trust decision ends with it; the next one
    // resolves the mode from the remembered and configured sources again.
    mode = "enforced";
    trustScope = undefined;
    sessionToggleProject = undefined;
    setStatus(undefined);
    statusUi = undefined;
  }
}

export function sandboxStatus(): SandboxStatus {
  return {
    phase: state.phase,
    mode,
    trustScope,
    backend: state.backend ?? backendName(),
    project: state.cwd,
    error: state.error,
  };
}

// False while the project is trusted: commands then run unwrapped on the host.
export function sandboxEnabled(): boolean {
  return mode === "enforced";
}

// The root the guard measures "inside the project" against while trusted. It
// is the project trust was granted for, not ctx.cwd, which can move outside
// that tree once commands run unwrapped.
export function trustedProject(): string | undefined {
  return mode === "disabled" && state.phase === "disabled"
    ? state.cwd
    : undefined;
}

export function requireTrustedSandbox(): ActiveSandbox {
  if (
    mode !== "disabled" ||
    state.phase !== "disabled" ||
    !state.cwd ||
    !state.resources ||
    !SandboxManager.isSandboxingEnabled()
  ) {
    const detail = state.error ? `: ${state.error}` : "";
    throw new Error(
      `Trusted project write boundary is not active${detail}; command refused.`,
    );
  }

  return {
    project: state.cwd,
    runtimeTemp: state.resources.runtimeTemp,
    cacheRoot: state.resources.cacheRoot,
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
