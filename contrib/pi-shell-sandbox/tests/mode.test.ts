import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  forgetTrust,
  isRememberedTrusted,
  parseSandboxSetting,
  rememberTrust,
  trustStorePath,
} from "../mode.ts";
import { tempProject, withEnvironmentOverrides } from "./test-support.ts";

test("the setting defaults to enforced and reports unknown values", () => {
  for (const value of [undefined, "", "  ", "1", "on", "TRUE", " yes "]) {
    assert.equal(parseSandboxSetting(value), "enforced", `${value}`);
  }
  for (const value of ["0", "off", "false", "NO", "disabled"]) {
    assert.equal(parseSandboxSetting(value), "disabled", value);
  }
  // Anything else is a typo, and the caller says so rather than guessing.
  for (const value of ["maybe", "2", "onoff", "-1"]) {
    assert.equal(parseSandboxSetting(value), "invalid", value);
  }
});

test("the trust store round-trips and matches projects exactly", async (context) => {
  const testRoot = tempProject(context, "pi-trust-store-test-");
  const project = path.join(testRoot, "project");

  await withEnvironmentOverrides(
    { XDG_STATE_HOME: path.join(testRoot, "state") },
    async () => {
      assert.equal(isRememberedTrusted(project), false);
      assert.equal(forgetTrust(project), false);

      rememberTrust(project);
      assert.equal(isRememberedTrusted(project), true);
      assert.equal(
        isRememberedTrusted(path.join(project, "nested")),
        false,
        "a trusted project must not trust the projects nested inside it",
      );
      assert.equal(
        isRememberedTrusted(testRoot),
        false,
        "a trusted project must not trust its parent",
      );

      const stored = JSON.parse(fs.readFileSync(trustStorePath(), "utf8"));
      assert.equal(stored.version, 1);
      assert.ok(stored.projects[project].trustedAt);
      assert.equal(fs.statSync(trustStorePath()).mode & 0o777, 0o600);

      assert.equal(forgetTrust(project), true);
      assert.equal(isRememberedTrusted(project), false);
    },
  );
});

test("a project containing the store cannot be remembered as trusted", async (context) => {
  const testRoot = tempProject(context, "pi-trust-containment-test-");
  const state = path.join(testRoot, "state");

  await withEnvironmentOverrides({ XDG_STATE_HOME: state }, async () => {
    // allowWrite covers the whole project, so a store underneath it could have
    // been written by a sandboxed command rather than by the user.
    for (const project of [testRoot, path.dirname(state), state]) {
      assert.equal(rememberTrust(project), false, project);
      assert.equal(isRememberedTrusted(project), false, project);
    }

    // A hand-written entry for such a project is ignored, not honored.
    const sibling = path.join(testRoot, "project");
    assert.equal(rememberTrust(sibling), true);
    fs.writeFileSync(
      trustStorePath(),
      JSON.stringify({
        version: 1,
        projects: { [testRoot]: { trustedAt: new Date().toISOString() } },
      }),
    );
    assert.equal(isRememberedTrusted(testRoot), false);
  });
});

test("a symlinked state directory into the project cannot grant trust", async (context) => {
  const testRoot = tempProject(context, "pi-trust-symlink-test-");
  const project = path.join(testRoot, "project");
  const stateTarget = path.join(project, "state");
  const stateLink = path.join(testRoot, "external-state");
  fs.mkdirSync(project);
  fs.mkdirSync(stateTarget);
  fs.symlinkSync(stateTarget, stateLink);

  await withEnvironmentOverrides({ XDG_STATE_HOME: stateLink }, async () => {
    assert.equal(rememberTrust(project), false);
    assert.equal(isRememberedTrusted(project), false);
  });
});

test("a store that cannot be understood grants no trust", async (context) => {
  const testRoot = tempProject(context, "pi-trust-malformed-test-");
  const project = path.join(testRoot, "project");

  await withEnvironmentOverrides(
    { XDG_STATE_HOME: path.join(testRoot, "state") },
    async () => {
      rememberTrust(project);
      assert.equal(isRememberedTrusted(project), true);

      fs.writeFileSync(trustStorePath(), "{ not json");
      assert.equal(isRememberedTrusted(project), false);

      fs.writeFileSync(
        trustStorePath(),
        JSON.stringify({ version: 99, projects: { [project]: {} } }),
      );
      assert.equal(
        isRememberedTrusted(project),
        false,
        "a future store version must not be read as trust",
      );

      fs.rmSync(trustStorePath());
      assert.equal(isRememberedTrusted(project), false);
    },
  );
});
