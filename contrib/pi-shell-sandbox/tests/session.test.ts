import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";
import { parse as parseShellCommand } from "shell-quote";

import {
  beginSession,
  requireActiveSandbox,
  sandboxStatus,
  shutdownSandbox,
} from "../session.ts";
import {
  tempProject,
  withEnvironmentOverrides,
  withStubbedSandboxManager,
} from "./test-support.ts";

test("session starts once, changes projects, and restores resources", async (context) => {
  const testRoot = tempProject(context, "pi-session-test-");
  const firstProject = path.join(testRoot, "first");
  const secondProject = path.join(testRoot, "second");
  fs.mkdirSync(firstProject);
  fs.mkdirSync(secondProject);

  await withEnvironmentOverrides(
    {
      CLAUDE_TMPDIR: "/tmp/original-claude-tmp",
      XDG_CACHE_HOME: path.join(testRoot, "cache"),
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
    { XDG_CACHE_HOME: path.join(testRoot, "cache"), CLAUDE_TMPDIR: undefined },
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
      { TMPDIR: hostTmpdir, XDG_CACHE_HOME: path.join(testRoot, "cache") },
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
