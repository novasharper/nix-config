// Fixtures shared by the extension's test files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

// Normalize /var vs /private/var spellings and remove the fixture afterward.
export function tempProject(context: TestContext, prefix: string): string {
  const project = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix)),
  );
  context.after(() => fs.rmSync(project, { recursive: true, force: true }));
  return project;
}

export type CapturedExtension = {
  handlers: Map<string, (...args: any[]) => any>;
  // Registration order is load-bearing; see UPSTREAM.md §1.2.
  registrations: string[];
  commands: Map<string, any>;
  tools: Map<string, any>;
};

export function captureExtension(
  factory: (pi: any) => void,
): CapturedExtension {
  const handlers = new Map<string, (...args: any[]) => any>();
  const registrations: string[] = [];
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();

  factory({
    on(name: string, handler: (...args: any[]) => any) {
      handlers.set(name, handler);
      registrations.push(`event:${name}`);
    },
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
      registrations.push(`tool:${tool.name}`);
    },
    registerCommand(name: string, command: any) {
      commands.set(name, command);
      registrations.push(`command:${name}`);
    },
  });

  return { handlers, registrations, commands, tools };
}

// The production delegate persists on globalThis, so tests restore it.
const sandboxBashOperationsKey = Symbol.for(
  "nix-config.pi.shell-sandbox.operations",
);

export function uninstallSandboxBashOperations(): void {
  delete (globalThis as Record<symbol, unknown>)[sandboxBashOperationsKey];
}

export function restoreSandboxBashOperationsAfter(
  context: TestContext,
): void {
  const operations = (globalThis as Record<symbol, unknown>)[
    sandboxBashOperationsKey
  ];
  context.after(() => {
    if (operations === undefined) {
      uninstallSandboxBashOperations();
    } else {
      (globalThis as Record<symbol, unknown>)[sandboxBashOperationsKey] =
        operations;
    }
  });
}

// Restore each variable to its original value or absence.
export async function withEnvironmentOverrides<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(overrides)) {
    previous.set(
      name,
      Object.hasOwn(process.env, name) ? process.env[name] : undefined,
    );
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

export type SandboxManagerHarness = {
  getConfig: () => any;
  initializeCount: () => number;
};

type SandboxManagerStubs = {
  initialize?: (config: any) => Promise<void>;
  waitForNetworkInitialization?: () => Promise<boolean>;
  wrapWithSandbox?: typeof SandboxManager.wrapWithSandbox;
};

// Keeps the real config store while avoiding network listeners.
export async function withStubbedSandboxManager<T>(
  fn: (harness: SandboxManagerHarness) => Promise<T>,
  stubs: SandboxManagerStubs = {},
): Promise<T> {
  const originalInitialize = SandboxManager.initialize;
  const originalWaitForNetworkInitialization =
    SandboxManager.waitForNetworkInitialization;
  const originalWrapWithSandbox = SandboxManager.wrapWithSandbox;
  let captured: any;
  let initializeCount = 0;

  SandboxManager.initialize = async (config) => {
    initializeCount += 1;
    captured = config;
    if (stubs.initialize) {
      await stubs.initialize(config);
      return;
    }
    SandboxManager.updateConfig(config);
  };
  SandboxManager.waitForNetworkInitialization =
    stubs.waitForNetworkInitialization ?? (async () => true);
  if (stubs.wrapWithSandbox) {
    SandboxManager.wrapWithSandbox = stubs.wrapWithSandbox;
  }

  try {
    return await fn({
      getConfig: () => captured,
      initializeCount: () => initializeCount,
    });
  } finally {
    SandboxManager.initialize = originalInitialize;
    SandboxManager.waitForNetworkInitialization =
      originalWaitForNetworkInitialization;
    SandboxManager.wrapWithSandbox = originalWrapWithSandbox;
    await SandboxManager.reset();
  }
}
