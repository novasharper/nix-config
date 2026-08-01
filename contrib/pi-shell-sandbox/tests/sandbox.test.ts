import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

import {
  createSandboxBashOperations,
  wrapForSandbox,
} from "../sandbox.ts";
import { beginSession, shutdownSandbox } from "../session.ts";
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
    { XDG_CACHE_HOME: path.join(testRoot, "cache") },
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
