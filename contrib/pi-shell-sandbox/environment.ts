// The environment handed to sandboxed commands: provider credentials and
// credential-redirection variables removed, package-manager caches redirected
// to a writable root, TMPDIR pointed at the session scratch directory.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { piSecretEnvVars } from "./secrets.ts";

const providerEnvPrefixes = [
  "AI_GATEWAY_",
  "ANTHROPIC_",
  "ANT_LING_",
  "AWS_",
  "AZURE_",
  "CEREBRAS_",
  "CLAUDE_",
  "CLOUDFLARE_",
  "COPILOT_",
  "DEEPSEEK_",
  "FIREWORKS_",
  "GEMINI_",
  "GH_",
  "GITHUB_",
  "GOOGLE_CLOUD_",
  "GROQ_",
  "HF_",
  "KIMI_",
  "LLM_",
  "MINIMAX_",
  "MISTRAL_",
  "MOONSHOT_",
  "NVIDIA_",
  "OPENCODE_",
  "OPENAI_",
  "OPENROUTER_",
  "QWEN_",
  "RADIUS_",
  "TOGETHER_",
  "XAI_",
  "XIAOMI_",
  "ZAI_",
] as const;

const explicitlyRemovedEnvVars = new Set([
  ...piSecretEnvVars,
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "BASH_ENV",
  // Credential redirection: these move a tool's config (and its stored
  // tokens) outside the fixed sensitiveHomePaths() list, so denying the
  // default location alone is not enough.
  "CLOUDSDK_CONFIG",
  "CURL_HOME",
  "DOCKER_CONFIG",
  "GIT_ASKPASS",
  "GNUPGHOME",
  "GPG_AGENT_INFO",
  "GPG_TTY",
  "KUBECONFIG",
  "NETRC",
  "NIX_ACCESS_TOKENS",
  "NIX_CONFIG",
  "NPM_CONFIG_USERCONFIG",
  "PINENTRY_USER_DATA",
  "PI_CODING_AGENT_DIR",
  "PI_MODEL",
  "PI_PROVIDER",
  "PI_REASONING_LEVEL",
  "PI_SESSION_FILE",
  "PI_SESSION_ID",
  "PIP_EXTRA_INDEX_URL",
  "PIP_INDEX_URL",
  "SSH_ASKPASS",
  "SSH_ASKPASS_REQUIRE",
  "SSH_AUTH_SOCK",
  "SUDO_ASKPASS",
  "UV_EXTRA_INDEX_URL",
  "UV_INDEX_URL",
]);

const secretEnvNamePattern =
  /(?:^|_)(?:API_?KEY|AUTH|CREDENTIALS?|OAUTH|PASSW(?:OR)?D|PRIVATE_KEY|SECRET|TOKEN)(?:$|_)/i;

// Package managers need writable caches, and the real home-directory caches
// are denied inside the sandbox. A per-session temp directory would be deleted
// at shutdown and force a full re-download every session, so the redirected
// caches live in a stable per-user root that sandboxConfig adds to allowWrite.
const cacheEnvSubdirectories = {
  CARGO_HOME: "cargo",
  GOCACHE: "go-cache",
  GOMODCACHE: "go-mod",
  GOPATH: "go",
  NPM_CONFIG_CACHE: "npm",
  PIP_CACHE_DIR: "pip",
  RUSTUP_HOME: "rustup",
  YARN_CACHE_FOLDER: "yarn",
} as const;

function isSensitiveEnvName(name: string): boolean {
  return (
    explicitlyRemovedEnvVars.has(name) ||
    providerEnvPrefixes.some((prefix) => name.startsWith(prefix)) ||
    secretEnvNamePattern.test(name) ||
    name.endsWith("_ASKPASS") ||
    name.startsWith("GIT_CONFIG_") ||
    name.startsWith("PI_SESSION_")
  );
}

export function sandboxCacheRoot(): string {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "pi-shell-sandbox");
}

// Tools that expect their cache directory to already exist fail outright when
// it does not, so create the tree once per session rather than per command.
export function ensureCacheDirectories(root: string): void {
  for (const subdirectory of Object.values(cacheEnvSubdirectories)) {
    fs.mkdirSync(path.join(root, subdirectory), {
      recursive: true,
      mode: 0o700,
    });
  }
}

export function sanitizedEnvironment(
  source: NodeJS.ProcessEnv | undefined,
  runtimeTemp: string,
  // Passed in rather than recomputed: sandboxCacheRoot() reads XDG_CACHE_HOME
  // at call time, and a mid-session change would point the child's caches
  // outside the allowWrite entry sandboxConfig() froze at initialization.
  cacheRoot = sandboxCacheRoot(),
): NodeJS.ProcessEnv {
  const env = { ...(source ?? process.env) };

  for (const name of Object.keys(env)) {
    if (isSensitiveEnvName(name)) {
      delete env[name];
    }
  }

  for (const [name, subdirectory] of Object.entries(cacheEnvSubdirectories)) {
    env[name] = path.join(cacheRoot, subdirectory);
  }

  // Scratch files stay session-scoped and inside allowWrite.
  env.TMPDIR = runtimeTemp;

  return env;
}
