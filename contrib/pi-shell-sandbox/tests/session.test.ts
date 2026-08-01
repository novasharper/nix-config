import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { parse as parseShellCommand } from "shell-quote";

import { rememberTrust } from "../mode.ts";
import {
  beginSession,
  requireActiveSandbox,
  requireTrustedSandbox,
  sandboxEnabled,
  sandboxStatus,
  setSandboxMode,
  shutdownSandbox,
  trustedProject,
} from "../session.ts";
import {
  tempProject,
  withEnvironmentOverrides,
  withStubbedSandboxManager,
} from "./test-support.ts";

// Every session now resolves its mode from the environment and the trust
// store, so tests that expect an enforced sandbox pin both away from whatever
// the developer running them happens to have configured.
function enforcedEnvironment(testRoot: string): Record<string, string | undefined> {
  return {
    PI_SHELL_SANDBOX: undefined,
    XDG_STATE_HOME: path.join(testRoot, "state"),
    XDG_CACHE_HOME: path.join(testRoot, "cache"),
  };
}

test("session starts once, changes projects, and restores resources", async (context) => {
  const testRoot = tempProject(context, "pi-session-test-");
  const firstProject = path.join(testRoot, "first");
  const secondProject = path.join(testRoot, "second");
  fs.mkdirSync(firstProject);
  fs.mkdirSync(secondProject);

  await withEnvironmentOverrides(
    {
      ...enforcedEnvironment(testRoot),
      CLAUDE_TMPDIR: "/tmp/original-claude-tmp",
    },
    () =>
      withStubbedSandboxManager(async ({ initializeCount }) => {
        await Promise.all([
          beginSession(firstProject, { setStatus() {} }),
          beginSession(firstProject, { setStatus() {} }),
        ]);
        assert.equal(initializeCount(), 1);
        assert.equal(sandboxStatus().phase, "active");

        const first = requireActiveSandbox(firstProject);
        assert.ok(fs.existsSync(first.runtimeTemp));
        assert.equal(process.env.CLAUDE_TMPDIR, first.runtimeTemp);

        await beginSession(secondProject, { setStatus() {} });
        assert.equal(initializeCount(), 2);
        assert.equal(sandboxStatus().project, secondProject);
        assert.ok(!fs.existsSync(first.runtimeTemp));

        const second = requireActiveSandbox(secondProject);
        await shutdownSandbox();
        assert.equal(sandboxStatus().phase, "idle");
        assert.ok(!fs.existsSync(second.runtimeTemp));
        assert.equal(process.env.CLAUDE_TMPDIR, "/tmp/original-claude-tmp");
      }),
  );
});

test("initialization failure cleans resources and blocks commands", async (context) => {
  const testRoot = tempProject(context, "pi-session-failure-test-");

  await withEnvironmentOverrides(
    { ...enforcedEnvironment(testRoot), CLAUDE_TMPDIR: undefined },
    () =>
      withStubbedSandboxManager(
        async () => {
          await beginSession(testRoot, { setStatus() {} });
          assert.equal(sandboxStatus().phase, "failed");
          assert.match(sandboxStatus().error ?? "", /test initialization failure/);
          assert.throws(
            () => requireActiveSandbox(testRoot),
            /not active.*test initialization failure.*command refused/is,
          );
          assert.equal(process.env.CLAUDE_TMPDIR, undefined);
          await shutdownSandbox();
        },
        {
          initialize: async () => {
            throw new Error("test initialization failure");
          },
        },
      ),
  );
});

test("trusted write-boundary failure grants no relaxation", async (context) => {
  const testRoot = tempProject(context, "pi-trusted-failure-test-");

  await withEnvironmentOverrides(
    {
      ...enforcedEnvironment(testRoot),
      PI_SHELL_SANDBOX: "0",
      CLAUDE_TMPDIR: undefined,
    },
    () =>
      withStubbedSandboxManager(
        async () => {
          await beginSession(testRoot, { setStatus() {}, notify() {} });
          assert.equal(sandboxStatus().phase, "failed");
          assert.equal(sandboxStatus().mode, "disabled");
          assert.equal(trustedProject(), undefined);
          assert.throws(
            () => requireTrustedSandbox(),
            /write boundary is not active.*test initialization failure/is,
          );
          await shutdownSandbox();
        },
        {
          initialize: async () => {
            throw new Error("test initialization failure");
          },
        },
      ),
  );
});

test("a remembered trusted project starts with only write confinement", async (context) => {
  const testRoot = tempProject(context, "pi-trusted-session-test-");
  const project = path.join(testRoot, "project");
  fs.mkdirSync(project);

  await withEnvironmentOverrides(enforcedEnvironment(testRoot), () =>
    withStubbedSandboxManager(async ({ initializeCount }) => {
      rememberTrust(project);

      const statuses: Array<string | undefined> = [];
      const notices: Array<[string, string]> = [];
      const ui = {
        setStatus(_key: string, text: string | undefined) {
          statuses.push(text);
        },
        notify(message: string, level: string) {
          notices.push([message, level]);
        },
      };

      try {
        await beginSession(project, ui);

        assert.equal(initializeCount(), 1, "trusted write confinement is initialized");
        assert.equal(sandboxEnabled(), false);
        assert.equal(trustedProject(), project);
        assert.equal(sandboxStatus().mode, "disabled");
        assert.equal(sandboxStatus().trustScope, "remembered");
        assert.match(statuses.at(-1) ?? "", /off — project trusted \(remembered\)/);
        assert.equal(notices.at(-1)?.[1], "warning");

        // The status stays visible after the switch, so trust is never silent.
        await setSandboxMode("enforced", project, ui);
        assert.equal(initializeCount(), 2);
        assert.equal(sandboxStatus().phase, "active");
        assert.equal(sandboxEnabled(), true);
        assert.equal(trustedProject(), undefined);
        assert.match(statuses.at(-1) ?? "", /sandbox: active/);
      } finally {
        await shutdownSandbox();
      }
    }),
  );
});

test("a session toggle does not follow the session into another project", async (context) => {
  const testRoot = tempProject(context, "pi-toggle-scope-test-");
  const first = path.join(testRoot, "first");
  const second = path.join(testRoot, "second");
  fs.mkdirSync(first);
  fs.mkdirSync(second);

  await withEnvironmentOverrides(enforcedEnvironment(testRoot), () =>
    withStubbedSandboxManager(async () => {
      const ui = { setStatus() {}, notify() {} };

      try {
        await beginSession(first, ui);
        assert.equal(sandboxEnabled(), true);

        await setSandboxMode("disabled", first, ui);
        assert.equal(sandboxEnabled(), false);
        assert.equal(trustedProject(), first);

        // resume/fork can enter a different project in the same process.
        await beginSession(second, ui);
        assert.equal(
          sandboxEnabled(),
          true,
          "trusting one project must not trust the next one",
        );
        assert.equal(sandboxStatus().project, second);
      } finally {
        await shutdownSandbox();
      }
    }),
  );
});

test(
  "macOS runtime profile does not grant the host TMPDIR parent",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const testRoot = tempProject(context, "pi-runtime-profile-test-");
    const project = path.join(testRoot, "project");
    fs.mkdirSync(project);

    const hostTmpdir = "/var/folders/zz/pi-sandbox-profile-test/T";
    const hostTmpdirParents = [
      path.dirname(hostTmpdir),
      `/private${path.dirname(hostTmpdir)}`,
    ];

    await withEnvironmentOverrides(
      { ...enforcedEnvironment(testRoot), TMPDIR: hostTmpdir },
      () =>
        withStubbedSandboxManager(async ({ getConfig }) => {
          try {
            await beginSession(project, { setStatus() {} });
            const config = getConfig();
            assert.ok(config);

            const runtimeTemp = config.filesystem.allowWrite[1];
            assert.equal(process.env.TMPDIR, runtimeTemp);
            assert.equal(process.env.CLAUDE_TMPDIR, runtimeTemp);

            const wrapped = await SandboxManager.wrapWithSandbox("true", "bun", {
              network: { ...config.network, allowedDomains: [] },
            });
            const wrappedArguments = parseShellCommand(wrapped);
            const profileOption = wrappedArguments.indexOf("-p");
            assert.notEqual(profileOption, -1);
            const profile = wrappedArguments[profileOption + 1];
            assert.equal(typeof profile, "string");

            assert.ok(
              profile.includes(`(subpath ${JSON.stringify(hostTmpdir)})`),
            );
            assert.ok(
              profile.includes(`(subpath ${JSON.stringify(runtimeTemp)})`),
            );
            for (const parent of hostTmpdirParents) {
              assert.ok(
                !profile.includes(`(subpath ${JSON.stringify(parent)})`),
                `${parent} should not be granted`,
              );
            }
          } finally {
            await shutdownSandbox();
          }

          assert.equal(process.env.TMPDIR, hostTmpdir);
        }),
    );
  },
);
