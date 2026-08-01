import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { sandboxCacheRoot, sanitizedEnvironment } from "../environment.ts";
import { piSecretEnvVars } from "../secrets.ts";

const runtimeTemp = "/tmp/pi-sandbox-test";

test("child environments omit credentials, agents, askpass, and Pi metadata", () => {
  const env = sanitizedEnvironment(
    {
      PATH: "/bin",
      BASH_ENV: "/tmp/host-shell-setup",
      OPENROUTER_API_KEY: "provider-secret",
      UNLISTED_SERVICE_TOKEN: "broad-secret",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      GIT_ASKPASS: "/tmp/askpass",
      GPG_AGENT_INFO: "agent-handle",
      PI_SESSION_FILE: "/tmp/session.jsonl",
      PI_SESSION_ID: "session-id",
      PIP_INDEX_URL: "https://user:password@example.invalid/simple",
      KUBECONFIG: "/data/clusters/prod.yaml",
      DOCKER_CONFIG: "/data/docker",
      GNUPGHOME: "/data/gnupg",
      CLOUDSDK_CONFIG: "/data/gcloud",
    },
    runtimeTemp,
  );

  assert.equal(env.PATH, "/bin");
  for (const name of [
    "OPENROUTER_API_KEY",
    "BASH_ENV",
    "UNLISTED_SERVICE_TOKEN",
    "SSH_AUTH_SOCK",
    "GIT_ASKPASS",
    "GPG_AGENT_INFO",
    "PI_SESSION_FILE",
    "PI_SESSION_ID",
    "PIP_INDEX_URL",
    // Credential redirection: denying ~/.kube is useless if KUBECONFIG can
    // point somewhere else.
    "KUBECONFIG",
    "DOCKER_CONFIG",
    "GNUPGHOME",
    "CLOUDSDK_CONFIG",
  ]) {
    assert.equal(env[name], undefined, `${name} should be removed`);
  }

  assert.ok(piSecretEnvVars.includes("OPENROUTER_API_KEY"));
});

test("package manager caches survive the session temp directory", () => {
  const env = sanitizedEnvironment({ PATH: "/bin" }, runtimeTemp);
  const cacheRoot = sandboxCacheRoot();

  assert.equal(env.NPM_CONFIG_CACHE, path.join(cacheRoot, "npm"));
  assert.equal(env.PIP_CACHE_DIR, path.join(cacheRoot, "pip"));
  assert.equal(env.CARGO_HOME, path.join(cacheRoot, "cargo"));

  // shutdownSandbox deletes runtimeTemp, so a cache under it would force a
  // full re-download every session.
  for (const name of Object.keys(env)) {
    assert.ok(
      !env[name]?.startsWith(runtimeTemp) || name === "TMPDIR",
      `${name} should not live in the per-session temp directory`,
    );
  }
  assert.equal(env.TMPDIR, runtimeTemp);
});
