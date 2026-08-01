// The Sandbox Runtime policy: what the sandboxed shell may reach on the
// network and the filesystem, plus the platform assets the backend needs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

import { sandboxCacheRoot } from "./environment.ts";
import { existingProjectSecretPaths } from "./project-scan.ts";

// Substituted by default.nix at build time; empty on macOS, which uses Seatbelt.
const SECCOMP_BPF_PATH = "@seccompBpfPath@";
const SECCOMP_APPLY_PATH = "@seccompApplyPath@";

export const allowedDomains = [
  // GitHub and its content/CDN endpoints.
  "github.com",
  "*.github.com",
  "githubusercontent.com",
  "*.githubusercontent.com",
  "githubassets.com",
  "*.githubassets.com",

  // npm and Yarn registries.
  "npmjs.org",
  "*.npmjs.org",
  "npmjs.com",
  "*.npmjs.com",
  "yarnpkg.com",
  "*.yarnpkg.com",

  // Python package indexes.
  "pypi.org",
  "*.pypi.org",
  "pythonhosted.org",
  "*.pythonhosted.org",

  // Rust crates and toolchain distribution.
  "crates.io",
  "*.crates.io",
  "rust-lang.org",
  "*.rust-lang.org",
  "rustup.rs",
  "*.rustup.rs",

  // Go module proxy and checksum database.
  "proxy.golang.org",
  "sum.golang.org",

  // Nix and Cachix downloads.
  "cache.nixos.org",
  "channels.nixos.org",
  "releases.nixos.org",
  "tarballs.nixos.org",
  "cachix.org",
  "*.cachix.org",
] as const;

// Derived from the policy rather than described alongside it, so the status
// the user reads cannot drift from the list actually in force.
export function allowedDomainSummary(): string {
  const roots = new Set(
    allowedDomains.map((domain) => domain.replace(/^\*\./, "")),
  );
  return [...roots].sort().join(", ");
}

export function backendName(): string {
  return process.platform === "darwin" ? "Seatbelt" : "Bubblewrap + seccomp";
}

export function sensitiveHomePaths(): string[] {
  const home = os.homedir();
  return [
    ".ssh",
    ".aws",
    ".docker",
    ".gnupg",
    ".kube",
    ".npm",
    ".config/gh",
    ".config/gcloud",
    ".config/goose",
    ".config/pi",
    ".codex",
    ".pi",
    // ~/.claude holds an OAuth token; its settings.json is ordinary config, so
    // only the credential-bearing entries are denied.
    ".claude.json",
    ".claude/.credentials.json",
    ".claude/.env",
    ".claude/secrets",
    ".git-credentials",
    ".llm-auth-key",
    ".netrc",
    ".npmrc",
    ".openrouter-api-key",
    "Library/Keychains",
  ].map((entry) => path.join(home, entry));
}

// The per-user $TMPDIR under /var/folders that many macOS tools use
// unconditionally. The pattern check keeps an overridden TMPDIR from widening
// this to an arbitrary path.
function macosTmpWritePaths(hostTmpdir: string): string[] {
  if (process.platform !== "darwin") {
    return [];
  }

  let currentTmp = hostTmpdir;
  try {
    currentTmp = fs.realpathSync.native(currentTmp);
  } catch {
    // Keep the lexical path; the sandbox runtime will normalize it too.
  }

  if (!/^\/(?:private\/)?var\/folders\/[^/]{2}\/[^/]+\/T\/?$/.test(currentTmp)) {
    return [];
  }
  return [currentTmp];
}

// Paths tools write to unconditionally and fail without. Sandbox Runtime seeds
// its own allow list with getDefaultWritePaths(), which covers all but the
// macOS $TMPDIR; naming them here keeps the policy self-describing and guards
// against an upstream change to those defaults.
function compatibilityWritePaths(hostTmpdir: string): string[] {
  return [
    path.join(os.homedir(), ".npm/_logs"),
    path.join(os.homedir(), ".claude/debug"),
    "/tmp/claude",
    "/private/tmp/claude",
    ...macosTmpWritePaths(hostTmpdir),
  ];
}

export function validatePlatformAssets(): void {
  if (!["darwin", "linux"].includes(process.platform)) {
    throw new Error(`unsupported platform: ${process.platform}`);
  }

  if (process.platform !== "linux") {
    return;
  }

  if (!SECCOMP_BPF_PATH || !SECCOMP_APPLY_PATH) {
    throw new Error("Linux seccomp asset paths were not configured by Nix");
  }
  fs.accessSync(SECCOMP_BPF_PATH, fs.constants.R_OK);
  fs.accessSync(SECCOMP_APPLY_PATH, fs.constants.R_OK | fs.constants.X_OK);
}

function networkPolicy(): SandboxRuntimeConfig["network"] {
  return {
    allowedDomains: [...allowedDomains],
    deniedDomains: [],
    allowUnixSockets: [],
    allowAllUnixSockets: false,
    allowLocalBinding: false,
  };
}

function trustedNetworkPolicy(): SandboxRuntimeConfig["network"] {
  return {
    // Sandbox Runtime rejects an all-domain wildcard. Initialization uses an
    // empty list so no proxy is started; trustedRuntimeConfig() removes the
    // field afterward, which is the runtime's filesystem-only sentinel.
    allowedDomains: [],
    deniedDomains: [],
    allowUnixSockets: [],
    allowAllUnixSockets: true,
    allowLocalBinding: true,
  };
}

function filesystemPolicy(
  project: string,
  runtimeTemp: string,
  cacheRoot: string,
  hostTmpdir: string,
): SandboxRuntimeConfig["filesystem"] {
  const projectSecrets = existingProjectSecretPaths(project);
  return {
    denyRead: [...sensitiveHomePaths(), ...projectSecrets],
    allowWrite: [
      project,
      runtimeTemp,
      cacheRoot,
      ...compatibilityWritePaths(hostTmpdir),
    ],
    denyWrite: [...projectSecrets],
    allowGitConfig: false,
  };
}

function platformPolicy(): Partial<SandboxRuntimeConfig> {
  if (process.platform !== "linux") {
    return {};
  }
  return {
    seccomp: {
      bpfPath: SECCOMP_BPF_PATH,
      applyPath: SECCOMP_APPLY_PATH,
    },
  };
}

// Sandbox Runtime always seeds these writable compatibility directories. In
// trusted mode they would be holes in the project-only write boundary unless
// denyWrite explicitly revokes them. Device entries in the upstream default
// remain writable so ordinary command I/O continues to work.
function runtimeDefaultDiskWritePaths(): string[] {
  return [
    path.join(os.homedir(), ".npm/_logs"),
    path.join(os.homedir(), ".claude/debug"),
    "/tmp/claude",
    "/private/tmp/claude",
  ];
}

export function sandboxConfig(
  project: string,
  runtimeTemp: string,
  cacheRoot = sandboxCacheRoot(),
  hostTmpdir = os.tmpdir(),
): SandboxRuntimeConfig {
  return {
    network: networkPolicy(),
    filesystem: filesystemPolicy(
      project,
      runtimeTemp,
      cacheRoot,
      hostTmpdir,
    ),
    enableWeakerNestedSandbox: false,
    allowPty: false,
    ripgrep: { command: "rg" },
    // This upstream scan covers shell/git files, not credentials (§2.4).
    mandatoryDenySearchDepth: 3,
    ...platformPolicy(),
  };
}

// Trust removes read, environment, and network restrictions, but keeps the
// write allowlist at the OS boundary. Shell syntax is too expressive for a
// lexical redirect check to prove where every program will write.
export function trustedSandboxConfig(
  project: string,
  runtimeTemp: string,
): SandboxRuntimeConfig {
  return {
    network: trustedNetworkPolicy(),
    filesystem: {
      denyRead: [],
      allowWrite: [project, runtimeTemp],
      denyWrite: runtimeDefaultDiskWritePaths(),
      allowGitConfig: true,
    },
    enableWeakerNestedSandbox: false,
    allowPty: false,
    ripgrep: { command: "rg" },
    mandatoryDenySearchDepth: 0,
    ...platformPolicy(),
  };
}

// Sandbox Runtime's public type requires allowedDomains, but its wrapper
// intentionally distinguishes an absent field (no network restriction) from
// an empty list (block all). updateConfig() accepts this filesystem-only shape
// without validation; tests pin the absent field and generated macOS profile
// so an upstream semantic change fails closed during the package build.
export function trustedRuntimeConfig(
  config: SandboxRuntimeConfig,
): SandboxRuntimeConfig {
  const { allowedDomains: _allowedDomains, ...network } = config.network;
  return { ...config, network } as unknown as SandboxRuntimeConfig;
}

// Linux has no usable read-deny globs, so each command needs a fresh literal
// project scan. Keep all fixed/base restrictions and add newly discovered
// paths; stale entries are harmless and preserve protection if a path returns.
function linuxCommandFilesystemConfig(
  project: string,
  base: SandboxRuntimeConfig["filesystem"],
): SandboxRuntimeConfig["filesystem"] {
  const projectSecrets = existingProjectSecretPaths(project, 50_000, false);
  return {
    ...base,
    denyRead: [...new Set([...base.denyRead, ...projectSecrets])],
    denyWrite: [...new Set([...base.denyWrite, ...projectSecrets])],
  };
}

// Per-command policy overlay, or undefined where the stored policy already
// covers late-created secrets through globs (macOS).
export function commandSandboxConfig(
  project: string,
  currentConfig: SandboxRuntimeConfig | undefined,
  platform: string = process.platform,
): Partial<SandboxRuntimeConfig> | undefined {
  if (platform !== "linux") {
    return undefined;
  }
  if (!currentConfig) {
    throw new Error("Sandbox Runtime has no active configuration");
  }
  return {
    filesystem: linuxCommandFilesystemConfig(project, currentConfig.filesystem),
  };
}
