import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  getDefaultWritePaths,
  SandboxManager,
} from "@anthropic-ai/sandbox-runtime";
import { wrapCommandWithSandboxLinux } from "@anthropic-ai/sandbox-runtime/dist/sandbox/linux-sandbox-utils.js";
import { parse as parseShellCommand } from "shell-quote";

import {
  trustedRuntimeConfig,
  trustedSandboxConfig,
} from "../policy.ts";
import {
  createSandboxBashOperations,
  wrapForSandbox,
  wrapForTrustedProject,
} from "../sandbox.ts";
import {
  beginSession,
  requireTrustedSandbox,
  shutdownSandbox,
} from "../session.ts";
import {
  tempProject,
  withEnvironmentOverrides,
  withStubbedSandboxManager,
} from "./test-support.ts";

test("command wrapping uses bash and does not latch a transient failure", async (context) => {
  const project = tempProject(context, "pi-wrap-test-");
  let attempts = 0;
  const shells: Array<string | undefined> = [];

  await withStubbedSandboxManager(
    async () => {
      SandboxManager.updateConfig({
        network: { allowedDomains: [], deniedDomains: [] },
        filesystem: {
          denyRead: [],
          allowWrite: [project],
          denyWrite: [],
          allowGitConfig: false,
        },
      });

      await assert.rejects(
        wrapForSandbox("pwd", project, undefined),
        /returned an unwrapped command.*command refused/i,
      );
      assert.equal(await wrapForSandbox("pwd", project, undefined), "wrapped pwd");
      assert.deepEqual(shells, ["bash", "bash"]);
    },
    {
      wrapWithSandbox: async (command, shell) => {
        attempts += 1;
        shells.push(shell);
        return attempts === 1 ? command : `wrapped ${command}`;
      },
    },
  );
});

test("sandbox operations sanitize the environment before local execution", async (context) => {
  const testRoot = tempProject(context, "pi-exec-test-");
  const project = path.join(testRoot, "project");
  fs.mkdirSync(project);
  const calls: any[] = [];

  await withEnvironmentOverrides(
    {
      PI_SHELL_SANDBOX: undefined,
      XDG_STATE_HOME: path.join(testRoot, "state"),
      XDG_CACHE_HOME: path.join(testRoot, "cache"),
    },
    () =>
      withStubbedSandboxManager(
        async () => {
          await beginSession(project, { setStatus() {} });
          try {
            const operations = createSandboxBashOperations({
              async exec(command, cwd, options) {
                calls.push({ command, cwd, options });
                return { exitCode: 7 };
              },
            });

            const result = await operations.exec("pwd", project, {
              onData() {},
              env: { PATH: "/bin", OPENAI_API_KEY: "secret" },
            });

            assert.deepEqual(result, { exitCode: 7 });
            assert.equal(calls[0].command, "wrapped pwd");
            assert.equal(calls[0].cwd, project);
            assert.equal(calls[0].options.env.PATH, "/bin");
            assert.equal(calls[0].options.env.OPENAI_API_KEY, undefined);
            assert.match(calls[0].options.env.TMPDIR, /pi-sandbox-/);
          } finally {
            await shutdownSandbox();
          }
        },
        { wrapWithSandbox: async (command) => `wrapped ${command}` },
      ),
  );
});

test("a trusted project confines writes without sanitizing the environment", async (context) => {
  const testRoot = tempProject(context, "pi-trusted-exec-test-");
  const project = path.join(testRoot, "project");
  fs.mkdirSync(project);
  const calls: any[] = [];
  let wrapCalls = 0;

  await withEnvironmentOverrides(
    {
      PI_SHELL_SANDBOX: "0",
      XDG_STATE_HOME: path.join(testRoot, "state"),
      XDG_CACHE_HOME: path.join(testRoot, "cache"),
    },
    () =>
      withStubbedSandboxManager(
        async () => {
          await beginSession(project, { setStatus() {} });
          try {
            const runtimeTemp = requireTrustedSandbox().runtimeTemp;
            const operations = createSandboxBashOperations({
              async exec(command, cwd, options) {
                calls.push({ command, cwd, options });
                return { exitCode: 3 };
              },
            });

            const result = await operations.exec("pwd", project, {
              onData() {},
              env: { PATH: "/bin", OPENAI_API_KEY: "secret" },
            });

            assert.deepEqual(result, { exitCode: 3 });
            assert.equal(calls[0].command, "trusted pwd");
            assert.equal(wrapCalls, 1);
            // The real environment is the point of turning the sandbox off.
            assert.equal(calls[0].options.env.OPENAI_API_KEY, "secret");
            assert.equal(calls[0].options.env.PATH, "/bin");
            assert.equal(calls[0].options.env.TMPDIR, runtimeTemp);
          } finally {
            await shutdownSandbox();
          }
        },
        {
          wrapWithSandbox: async (command) => {
            wrapCalls += 1;
            return `trusted ${command}`;
          },
        },
      ),
  );
});

test("trusted wrapping fails closed when confinement is unavailable", async () => {
  await withStubbedSandboxManager(
    async () => {
      await assert.rejects(
        wrapForTrustedProject("echo data > ../outside", undefined),
        /returned an unwrapped command.*command refused/i,
      );
    },
    { wrapWithSandbox: async (command) => command },
  );
});

test(
  "macOS trusted profile permits reads but confines writes to the project",
  { skip: process.platform !== "darwin" },
  async (context) => {
    const testRoot = tempProject(context, "pi-trusted-boundary-test-");
    const project = path.join(testRoot, "project");
    const outsideWrite = path.join(testRoot, "outside");
    fs.mkdirSync(project);

    await withEnvironmentOverrides(
      {
        PI_SHELL_SANDBOX: "0",
        XDG_STATE_HOME: path.join(testRoot, "state"),
        XDG_CACHE_HOME: path.join(testRoot, "cache"),
      },
      () =>
        withStubbedSandboxManager(async () => {
          await beginSession(project, { setStatus() {} });
          try {
            const config = SandboxManager.getConfig();
            assert.ok(config);
            assert.deepEqual(config.filesystem.denyRead, []);
            assert.equal(Object.hasOwn(config.network, "allowedDomains"), false);

            const wrapped = await wrapForTrustedProject("true", undefined);
            const wrappedArguments = parseShellCommand(wrapped);
            const profileOption = wrappedArguments.indexOf("-p");
            assert.notEqual(profileOption, -1);
            const profile = wrappedArguments[profileOption + 1];
            assert.equal(typeof profile, "string");

            assert.match(profile, /\(deny file-write\*/);
            assert.match(profile, /\(allow network\*\)/);
            assert.ok(
              profile.includes(`(subpath ${JSON.stringify(project)})`),
            );
            assert.ok(
              profile.includes(
                `(subpath ${JSON.stringify(config.filesystem.allowWrite[1])})`,
              ),
            );
            assert.ok(
              !profile.includes(`(subpath ${JSON.stringify(testRoot)})`),
              "the project parent must not become writable",
            );
            assert.ok(
              !profile.includes(`(subpath ${JSON.stringify(outsideWrite)})`),
            );
          } finally {
            await shutdownSandbox();
          }
        }),
    );
  },
);

test("Linux trusted wrapper preserves networking and trusted writes", async (context) => {
  const testRoot = tempProject(context, "pi-trusted-linux-test-");
  const project = path.join(testRoot, "project");
  const runtimeTemp = path.join(testRoot, "runtime");
  fs.mkdirSync(project);
  fs.mkdirSync(runtimeTemp);

  const config = trustedRuntimeConfig(
    trustedSandboxConfig(project, runtimeTemp),
  );
  assert.equal(Object.hasOwn(config.network, "allowedDomains"), false);

  const wrapped = await wrapCommandWithSandboxLinux({
    command: "true",
    needsNetworkRestriction: false,
    readConfig: { denyOnly: config.filesystem.denyRead },
    writeConfig: {
      allowOnly: [
        ...getDefaultWritePaths(),
        ...config.filesystem.allowWrite,
      ],
      denyWithinAllow: config.filesystem.denyWrite,
    },
    enableWeakerNestedSandbox: false,
    allowAllUnixSockets: true,
    binShell: "bash",
    mandatoryDenySearchDepth: config.mandatoryDenySearchDepth,
    allowGitConfig: config.filesystem.allowGitConfig,
  });
  const args = parseShellCommand(wrapped);

  assert.equal(args[0], "bwrap");
  assert.ok(!args.includes("--unshare-net"));
  for (const writable of [project, runtimeTemp]) {
    assert.ok(
      args.some(
        (entry, index) =>
          entry === "--bind" &&
          args[index + 1] === writable &&
          args[index + 2] === writable,
      ),
      `${writable} should be writable`,
    );
  }
  assert.ok(
    !args.some(
      (entry, index) =>
        entry === "--bind" && args[index + 1] === testRoot,
    ),
    "the project parent must not become writable",
  );
});
