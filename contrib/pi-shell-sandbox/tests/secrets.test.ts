import assert from "node:assert/strict";
import test from "node:test";

import { accessesSecret, projectSecretPathGlobs } from "../secrets.ts";

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
