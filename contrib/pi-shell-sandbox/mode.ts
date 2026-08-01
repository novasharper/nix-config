// Where the sandbox mode comes from when a session starts: the configured
// setting, and the per-project decisions the user asked to be remembered.
//
// Nothing here runs at import time. The installed tree is imported by the
// build's jiti smoke test, so reading the environment or touching the trust
// store during module evaluation would run inside the Nix build sandbox.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveReal } from "./fs-paths.ts";

export type SandboxMode = "enforced" | "disabled";

// "invalid" is distinct from "enforced" so the caller can say so rather than
// silently treating a typo as the fail-closed default it happens to share.
export type SandboxSetting = SandboxMode | "invalid";

export const SANDBOX_SETTING_ENV = "PI_SHELL_SANDBOX";

const enforcedValues = new Set(["1", "on", "true", "yes", "enforced"]);
const disabledValues = new Set(["0", "off", "false", "no", "disabled"]);

// Unset means enforced: the sandbox is on unless something turns it off.
export function parseSandboxSetting(value: string | undefined): SandboxSetting {
  if (value === undefined || value.trim() === "") {
    return "enforced";
  }
  const normalized = value.trim().toLowerCase();
  if (enforcedValues.has(normalized)) {
    return "enforced";
  }
  if (disabledValues.has(normalized)) {
    return "disabled";
  }
  return "invalid";
}

export function configuredSetting(): SandboxSetting {
  return parseSandboxSetting(process.env[SANDBOX_SETTING_ENV]);
}

// The store normally sits outside the sandbox's allowWrite set — allowWrite is
// the project, the session temp directory, and the package cache root, and
// getDefaultWritePaths() adds only /dev entries, /tmp/claude, ~/.npm/_logs,
// and ~/.claude/debug — so a sandboxed command cannot grant itself trust. A
// command run with the sandbox off can, which is why SECURITY-REVIEW.md
// records that as accepted residual risk.
//
// "Normally" is not good enough to rely on: a project rooted at $HOME (or at
// ~/.local) puts the store inside allowWrite, and nothing in denyWrite covers
// it. trustedStoreIsWritableFromProject() below is what makes the invariant
// hold for those roots too, rather than leaving it as a precondition nobody
// checks.
export function trustStorePath(): string {
  const base =
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "pi-shell-sandbox", "trusted-projects.json");
}

// Resolve both paths through symlinks and their deepest existing ancestors.
// XDG_STATE_HOME itself may be a symlink into the project even when its lexical
// spelling is outside it.
export function trustStoreIsWritableFromProject(project: string): boolean {
  const store = resolveReal(trustStorePath(), process.cwd());
  const realProject = resolveReal(project, process.cwd());
  return (
    store === realProject || store.startsWith(`${realProject}${path.sep}`)
  );
}

const STORE_VERSION = 1;

type TrustEntry = { trustedAt: string };
type TrustStore = { version: number; projects: Record<string, TrustEntry> };

function emptyStore(): TrustStore {
  return { version: STORE_VERSION, projects: {} };
}

// A store that cannot be read or understood grants no trust; the sandbox then
// stays on, which is the safe direction to fail in.
function readStore(): TrustStore {
  let raw: string;
  try {
    raw = fs.readFileSync(trustStorePath(), "utf8");
  } catch {
    return emptyStore();
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.version !== STORE_VERSION ||
      typeof parsed.projects !== "object" ||
      parsed.projects === null
    ) {
      return emptyStore();
    }
    return parsed as TrustStore;
  } catch {
    return emptyStore();
  }
}

function writeStore(store: TrustStore): void {
  const target = trustStorePath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });

  // Written beside the target and renamed, so a crash mid-write leaves the
  // previous decisions intact rather than an unparseable file that would
  // silently drop them all.
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
}

// Exact match only. A remembered decision for a parent directory must not
// trust every project nested under it, and the caller has already resolved
// symlinks — session.ts owns that, so the two cannot disagree about spelling.
export function isRememberedTrusted(project: string): boolean {
  if (trustStoreIsWritableFromProject(project)) {
    return false;
  }
  return Object.hasOwn(readStore().projects, project);
}

// Refuses rather than writing an entry that would never be honored, so the
// command can tell the user why instead of appearing to succeed.
export function rememberTrust(project: string): boolean {
  if (trustStoreIsWritableFromProject(project)) {
    return false;
  }
  const store = readStore();
  store.projects[project] = { trustedAt: new Date().toISOString() };
  writeStore(store);
  return true;
}

// Returns whether anything was removed, so the command can tell the user that
// a project it was asked to untrust was never trusted.
export function forgetTrust(project: string): boolean {
  const store = readStore();
  if (!Object.hasOwn(store.projects, project)) {
    return false;
  }
  delete store.projects[project];
  writeStore(store);
  return true;
}
