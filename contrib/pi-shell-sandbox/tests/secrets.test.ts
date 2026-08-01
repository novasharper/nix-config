import assert from "node:assert/strict";
import test from "node:test";

import {
  accessesSecret,
  exposesSecretValue,
  projectSecretPathGlobs,
} from "../secrets.ts";

test("credential guard separates paths from prose", () => {
  for (const command of [
    // The lexical guard is the only layer that sees these before the sandbox
    // policy is built, so a dotted filename or a command substitution must
    // not slip past it.
    "cat ~/.claude/.credentials.json",
    "cat ~/.git-credentials",
    "(cat ~/.netrc)",
    "`cat ~/.npmrc`",
    "cat secrets/prod.yaml",
    "cat ~/.secrets",
  ]) {
    assert.ok(accessesSecret(command), `${command} should be blocked`);
  }

  for (const command of [
    // "secret" is an ordinary English word; blocking it blocks real work.
    'git commit -m "add secret rotation"',
    "rg credentials src/",
    "grep -r secrets .",
    "cat .dockerignore",
  ]) {
    assert.ok(!accessesSecret(command), `${command} should be allowed`);
  }
});

test("environment dumps are recognized in command position only", () => {
  for (const command of [
    "env",
    "  env  ",
    "env | grep KEY",
    "cd /tmp && env",
    "export",
    "printenv",
    "gh auth token",
    // A separator is a separator whatever its spelling. Anchoring on the start
    // of the string alone let every one of these through, and a newline is how
    // a model usually writes a second step.
    "echo checking the build\nenv",
    "ls\nenv > /tmp/dump",
    "env\ncat report.txt",
    "cat foo\nexport",
    "set -e\nenv",
    "if true; then env; fi",
    "for i in 1; do env; done",
    "eval env",
    "command env",
    "exec env",
    "(env)",
    // Command substitution puts the verb in command position the same way a
    // subshell does, so a backtick must not be a way around the guard.
    "`env`",
    "echo `env`",
    "`export`",
    "`set`",
    "x=`env`",
    "echo `set` | sort",
    "`/usr/bin/env`",
    // A command word can also follow a brace, an inline assignment, a
    // modifier, or a negation, and can be spelled as a path.
    "{ env; }",
    "X=1 env",
    "LC_ALL=C env",
    "time env",
    "time env | head",
    "! env",
    "nohup env",
    "env -0",
    "env --null",
    "env -u PATH",
    "env --unset PATH",
    "env --unset=PATH",
    "env -iu PATH",
    "env FOO=bar",
    "/usr/bin/env",
    "/usr/bin/env -0",
    "bash -c env",
    "/bin/bash -c env",
    "/bin/bash -lc env",
    "/bin/bash --noprofile -c env",
    "bash -c 'env'",
    'bash -c "env"',
    "bash -c ' env '",
    "bash -c $'env'",
    "bash -c 'env | sort'",
    "/usr/bin/bash -c 'env -u PATH'",
    "/nix/store/example/bin/bash -c 'env -0'",
    "sh -c export",
  ]) {
    assert.ok(exposesSecretValue(command), `${command} should be guarded`);
  }

  // These name a file whose path happens to end in "env". The path rules
  // classify them, and unlike this one they can be attributed to a directory,
  // which is what lets a trusted project read its own .env without a prompt.
  for (const command of [
    "cat .env",
    "vim .env.local",
    "cp .env .env.bak",
    "docker run --env-file .env",
    "echo done\ncat .env",
    "if true; then cat .env; fi",
    "source .env",
    "bash -c 'cat .env'",
    "cat /home/me/.env",
  ]) {
    assert.ok(!exposesSecretValue(command), `${command} is not a dump`);
    assert.ok(accessesSecret(command), `${command} is still a secret path`);
  }

  // `env` with a command changes that command's environment; it does not
  // print the environment itself and should not add a trusted-mode prompt.
  for (const command of [
    "env -u PATH /usr/bin/true",
    "env -C /tmp pwd",
  ]) {
    assert.ok(!exposesSecretValue(command), `${command} is not a dump`);
    assert.ok(!accessesSecret(command), `${command} is not a secret path`);
  }
});

test("macOS glob fallback covers all secret-word filename shapes", () => {
  // The fallback is the only cover on macOS for a secret that appears after
  // the scan, so it has to classify the same names accessesSecret does.
  const bases = new Set(
    projectSecretPathGlobs.filter((pattern) => !pattern.endsWith("/**")),
  );
  const matchesSomeGlob = (name: string) =>
    [...bases].some((pattern) => {
      const tail = pattern.replace(/^\*\*\//, "");
      if (tail.includes("/")) {
        return false;
      }
      const source = tail
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*");
      return new RegExp(`^${source}$`).test(name);
    });

  for (const name of [
    ".env",
    ".env.local",
    "auth.json",
    ".npmrc",
    ".netrc",
  ]) {
    // The scan classifies a project-relative path, not a bare basename.
    assert.ok(
      accessesSecret(`dir/${name}`),
      `${name} should be lexically secret`,
    );
    assert.ok(matchesSomeGlob(name), `${name} should match a fallback glob`);
  }

  // Generate the complete filename grammar covered by the secretWord rule.
  // Keeping every word and shape in the cross-product makes a missing pattern
  // such as **/*.secrets.* observable rather than relying on representatives.
  for (const word of ["credentials", "secret", "secrets"]) {
    for (const name of [
      word,
      `${word}.yaml`,
      `.${word}`,
      `.${word}.yaml`,
      `config.${word}`,
      `config.${word}.yaml`,
    ]) {
      assert.ok(
        accessesSecret(`dir/${name}`),
        `${name} should be lexically secret below the project root`,
      );
      assert.ok(matchesSomeGlob(name), `${name} should match a fallback glob`);
    }

    // At the project root there is no leading path separator, so a bare word
    // is intentionally absent from the lexical matcher. The scanner's fixed
    // seed and the glob still deny the path.
    assert.ok(!accessesSecret(word));
    assert.ok(matchesSomeGlob(word), `${word} should match a fallback glob`);
  }

  // Ordinary names must stay readable; an over-broad glob would deny real work.
  for (const name of ["mysecret", "secretive.ts", "dotenv.ts", "README.md"]) {
    assert.ok(!accessesSecret(`dir/${name}`), `${name} should not be secret`);
    assert.ok(!matchesSomeGlob(name), `${name} should not be denied`);
  }
});
