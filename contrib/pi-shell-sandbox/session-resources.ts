// Host resources owned by one sandbox session.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureCacheDirectories, sandboxCacheRoot } from "./environment.ts";

export type SessionResources = {
  cacheRoot: string;
  runtimeTemp: string;
  hostTmpdir: string;
  previousTmpdir: string | undefined;
  previousClaudeTmpdir: string | undefined;
};

function createRuntimeTemp(): string {
  const directory = fs.mkdtempSync(path.join("/tmp", "pi-sandbox-"));
  fs.chmodSync(directory, 0o700);
  return fs.realpathSync.native(directory);
}

function restoreEnvironmentVariable(
  name: string,
  previous: string | undefined,
): void {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

function removeRuntimeTemp(runtimeTemp: string): void {
  if (!path.basename(runtimeTemp).startsWith("pi-sandbox-")) {
    return;
  }
  try {
    fs.rmSync(runtimeTemp, { recursive: true, force: true });
  } catch {
    // The OS eventually clears stale private temp directories.
  }
}

export function createSessionResources(): SessionResources {
  const cacheRoot = sandboxCacheRoot();
  ensureCacheDirectories(cacheRoot);

  return {
    cacheRoot,
    runtimeTemp: createRuntimeTemp(),
    hostTmpdir: process.env.TMPDIR || os.tmpdir(),
    previousTmpdir: process.env.TMPDIR,
    previousClaudeTmpdir: process.env.CLAUDE_TMPDIR,
  };
}

// Sandbox Runtime reads these variables later while wrapping each command.
export function redirectTempEnvironment(resources: SessionResources): void {
  if (process.platform === "darwin") {
    process.env.TMPDIR = resources.runtimeTemp;
  }
  process.env.CLAUDE_TMPDIR = resources.runtimeTemp;
}

export function releaseSessionResources(
  resources: SessionResources | undefined,
): void {
  if (!resources) {
    return;
  }
  if (process.platform === "darwin") {
    restoreEnvironmentVariable("TMPDIR", resources.previousTmpdir);
  }
  restoreEnvironmentVariable(
    "CLAUDE_TMPDIR",
    resources.previousClaudeTmpdir,
  );
  removeRuntimeTemp(resources.runtimeTemp);
}
