import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";

import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";

import { sandboxCacheRoot } from "../environment.ts";
import {
  allowedDomains,
  commandSandboxConfig,
  sandboxConfig,
  sensitiveHomePaths,
} from "../policy.ts";
import { tempProject } from "./test-support.ts";

function emptyPolicy(context: TestContext) {
  return sandboxConfig(
    tempProject(context, "pi-project-test-"),
    tempProject(context, "pi-runtime-test-"),
  );
}

test("network allowlist contains only approved developer service families", () => {
  const domains = new Set<string>(allowedDomains);
  for (const domain of [
    "github.com",
    "*.githubusercontent.com",
    "*.npmjs.org",
    "*.yarnpkg.com",
    "pypi.org",
    "*.pythonhosted.org",
    "crates.io",
    "*.rust-lang.org",
    "proxy.golang.org",
    "sum.golang.org",
    "cache.nixos.org",
    "*.cachix.org",
  ]) {
    assert.ok(domains.has(domain), `${domain} should be allowed`);
  }

  for (const domain of [
    "anthropic.com",
    "openrouter.ai",
    "example.com",
    "localhost",
  ]) {
    assert.ok(!domains.has(domain), `${domain} should not be allowed`);
  }
});

test("filesystem policy denies project credentials", (context) => {
  const project = tempProject(context, "pi-project-test-");
  const runtimeTemp = tempProject(context, "pi-runtime-test-");
  fs.writeFileSync(path.join(project, ".env"), "SECRET=value\n");
  fs.mkdirSync(path.join(project, "secrets"));
  fs.writeFileSync(path.join(project, "credentials.json"), "{}\n");
  fs.writeFileSync(
    path.join(project, ".npmrc"),
    "//registry.invalid/:_authToken=x\n",
  );
  fs.writeFileSync(path.join(project, "auth.json"), "{}\n");
  fs.mkdirSync(path.join(project, ".ssh"));
  fs.mkdirSync(path.join(project, "nested"));
  fs.writeFileSync(path.join(project, "nested", "models.json"), "{}\n");

  const config = sandboxConfig(project, runtimeTemp);

  assert.deepEqual(config.filesystem.allowWrite.slice(0, 3), [
    project,
    runtimeTemp,
    sandboxCacheRoot(),
  ]);
  for (const entry of [
    ".env",
    "secrets",
    "credentials.json",
    ".npmrc",
    "auth.json",
    ".ssh",
    "nested/models.json",
  ]) {
    assert.ok(
      config.filesystem.denyRead.includes(path.join(project, entry)),
      `${entry} should be denied by Sandbox Runtime`,
    );
  }
  assert.ok(config.filesystem.denyWrite.includes(path.join(project, ".env")));

  if (process.platform === "darwin") {
    for (const pattern of [
      "**/credentials.*",
      "**/.npmrc",
      "**/.ssh/**",
      "**/auth.json",
    ]) {
      assert.ok(
        config.filesystem.denyRead.includes(path.join(project, pattern)),
        `${pattern} should be included in the macOS fallback policy`,
      );
    }
  }
});

test("compatibility paths remain writable", (context) => {
  const config = emptyPolicy(context);

  // denyWrite would revoke Sandbox Runtime's own compatibility defaults.
  for (const entry of [".npm/_logs", ".claude/debug"]) {
    const compatibilityPath = path.join(os.homedir(), entry);
    assert.ok(
      config.filesystem.allowWrite.includes(compatibilityPath),
      `${entry} should stay writable`,
    );
    assert.ok(
      !config.filesystem.denyWrite.includes(compatibilityPath),
      `${entry} should not be denied`,
    );
  }

  if (process.platform === "darwin") {
    const tmp = fs.realpathSync.native(os.tmpdir());
    if (/^\/(?:private\/)?var\/folders\/[^/]{2}\/[^/]+\/T$/.test(tmp)) {
      assert.ok(
        config.filesystem.allowWrite.includes(tmp),
        "$TMPDIR itself should be writable",
      );
    }
    assert.ok(
      !config.filesystem.allowWrite.includes(path.dirname(tmp)),
      "granting the $TMPDIR parent would also grant the user cache directory",
    );
  }
});

test("runtime policy disables privileged capabilities", (context) => {
  const config = emptyPolicy(context);

  assert.deepEqual(config.network.allowUnixSockets, []);
  assert.equal(config.network.allowAllUnixSockets, false);
  assert.equal(config.network.allowLocalBinding, false);
  assert.equal(config.enableWeakerNestedSandbox, false);
  assert.equal(config.allowPty, false);
  assert.equal("ignoreViolations" in config, false);
});

test("sensitive home paths cover credential stores", () => {
  const homePaths = sensitiveHomePaths();
  for (const entry of [
    ".ssh",
    ".aws",
    ".docker",
    ".gnupg",
    ".kube",
    ".npm",
    ".config/gh",
    ".config/gcloud",
    ".pi",
    ".config/pi",
    ".codex",
    ".claude.json",
    ".claude/.credentials.json",
    ".git-credentials",
    "Library/Keychains",
  ]) {
    assert.ok(
      homePaths.includes(path.join(os.homedir(), entry)),
      `${entry} should be denied for reads`,
    );
  }
});

test("Linux command policy refreshes secrets created after initialization", (context) => {
  const project = tempProject(context, "pi-refresh-test-");
  const nested = path.join(project, "nested");
  const lateSecret = path.join(nested, ".env");
  fs.mkdirSync(nested);

  const currentConfig: SandboxRuntimeConfig = {
    network: { allowedDomains: [], deniedDomains: [] },
    filesystem: {
      denyRead: ["/fixed-read-deny"],
      allowWrite: [project],
      denyWrite: ["/fixed-write-deny"],
      allowGitConfig: false,
    },
  };
  const before = commandSandboxConfig(
    project,
    currentConfig,
    "linux",
  )?.filesystem;
  assert.ok(before);
  assert.ok(!before.denyRead.includes(lateSecret));
  assert.ok(!before.denyWrite.includes(lateSecret));
  assert.equal(
    commandSandboxConfig(project, currentConfig, "darwin"),
    undefined,
  );

  fs.writeFileSync(lateSecret, "SECRET=value\n");
  const after = commandSandboxConfig(
    project,
    currentConfig,
    "linux",
  )?.filesystem;
  assert.ok(after);
  assert.ok(after.denyRead.includes(lateSecret));
  assert.ok(after.denyWrite.includes(lateSecret));
  assert.ok(after.denyRead.includes("/fixed-read-deny"));
  assert.ok(after.denyWrite.includes("/fixed-write-deny"));
  assert.deepEqual(after.allowWrite, currentConfig.filesystem.allowWrite);
});
