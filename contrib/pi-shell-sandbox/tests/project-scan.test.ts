import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { existingProjectSecretPaths } from "../project-scan.ts";
import { accessesSecret } from "../secrets.ts";
import { tempProject } from "./test-support.ts";

test("project secret scan descends into symlinked directories", (context) => {
  const root = tempProject(context, "pi-symlink-test-");
  const project = path.join(root, "project");
  const shared = path.join(root, "shared");
  fs.mkdirSync(project);
  fs.mkdirSync(shared);
  fs.writeFileSync(path.join(shared, ".env"), "SECRET=value\n");
  fs.symlinkSync(shared, path.join(project, "shared"));

  const secrets = existingProjectSecretPaths(project, 50, false);

  assert.ok(
    secrets.includes(path.join(project, "shared", ".env")),
    "a secret behind an in-project symlink must reach denyRead",
  );
  // Denying only the link path leaves the same file readable under its real
  // name, which a command can reach without ever naming the link.
  assert.ok(
    secrets.includes(path.join(shared, ".env")),
    "the resolved path of a symlinked secret must also reach denyRead",
  );
});

test("project secret scan denies an innocuous file symlink and its secret target", (context) => {
  const root = tempProject(context, "pi-file-link-test-");
  const project = path.join(root, "project");
  const target = path.join(root, ".env");
  fs.mkdirSync(project);
  fs.writeFileSync(target, "SECRET=value\n");
  fs.symlinkSync("../.env", path.join(project, "config"));

  const link = path.join(project, "config");
  const secrets = existingProjectSecretPaths(project, 50_000, false);

  assert.ok(!accessesSecret("cat config"));
  assert.ok(accessesSecret("cat ../.env"));
  assert.ok(secrets.includes(link), "the innocuous link must reach denyRead");
  assert.ok(
    secrets.includes(target),
    "the escaping secret target must reach denyRead",
  );
});

test("project secret scan reaches into generated trees without a glob fallback", (context) => {
  const project = tempProject(context, "pi-generated-test-");
  const nested = path.join(project, "node_modules", "@scope", "pkg");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(
    path.join(nested, ".npmrc"),
    "//registry.invalid/:_authToken=x\n",
  );
  fs.mkdirSync(path.join(project, ".venv"));
  fs.writeFileSync(path.join(project, ".venv", "auth.json"), "{}\n");

  // denyRead is applied as denyOnly, so anything the scan does not name stays
  // readable. Platforms without a complete glob fallback have to enumerate it.
  const enumerated = existingProjectSecretPaths(project, 50_000, false);
  assert.ok(
    enumerated.includes(path.join(project, "node_modules/@scope/pkg/.npmrc")),
    "a credential inside node_modules must reach denyRead",
  );
  assert.ok(
    enumerated.includes(path.join(project, ".venv/auth.json")),
    "a credential inside .venv must reach denyRead",
  );

  // With a glob fallback the same paths are covered by **/.npmrc and
  // **/auth.json, so the walk stops at the top of the generated tree.
  const globbed = existingProjectSecretPaths(project, 50_000, true);
  assert.ok(
    !globbed.includes(path.join(project, "node_modules/@scope/pkg/.npmrc")),
    "the glob fallback should make the deep walk unnecessary",
  );
  assert.ok(globbed.includes(path.join(project, "**/.npmrc")));
});

test("project secret scan bounds descent through a symlink out of the project", (context) => {
  const root = tempProject(context, "pi-escape-test-");
  const project = path.join(root, "project");
  const outside = path.join(root, "outside");
  fs.mkdirSync(project);
  // The budget bounds how far the scan descends past the link, which is what
  // keeps `ln -s ~ .` from walking the whole home directory into the cap.
  fs.mkdirSync(path.join(outside, "a", "b", "c", "d"), { recursive: true });
  fs.writeFileSync(path.join(outside, "a", ".env"), "SECRET=1\n");
  fs.writeFileSync(path.join(outside, "a", "b", "c", "d", ".env"), "SECRET=2\n");
  fs.symlinkSync(outside, path.join(project, "link"));

  const secrets = existingProjectSecretPaths(project, 50_000, false);

  assert.ok(secrets.includes(path.join(project, "link", "a", ".env")));
  assert.ok(
    !secrets.includes(path.join(project, "link", "a", "b", "c", "d", ".env")),
    "descent through an escaping symlink must be bounded",
  );
});

test("project secret scan terminates on a symlink cycle", (context) => {
  const project = tempProject(context, "pi-cycle-test-");
  fs.mkdirSync(path.join(project, "nested"));
  fs.symlinkSync(project, path.join(project, "nested", "loop"));

  assert.ok(Array.isArray(existingProjectSecretPaths(project, 50, false)));
});

test("project secret scan skips content-addressed git data", (context) => {
  const project = tempProject(context, "pi-skip-test-");
  const objects = path.join(project, ".git", "objects", "ab");
  fs.mkdirSync(objects, { recursive: true });
  fs.writeFileSync(path.join(objects, "cdef"), "x\n");

  const secrets = existingProjectSecretPaths(project, 50, false);

  // Object names are hex fragments and can never match, so skipping them costs
  // no coverage while saving 256 directories per repository.
  assert.ok(!secrets.some((entry) => entry.startsWith(objects)));
});

test("project secret scan fails closed on an unlistable directory", (context) => {
  const project = tempProject(context, "pi-opaque-test-");
  const opaque = path.join(project, "opaque");
  fs.mkdirSync(opaque);
  fs.writeFileSync(path.join(opaque, ".env"), "SECRET=value\n");
  // Traversable but not listable: `cat opaque/.env` still succeeds, so the
  // scan cannot treat the directory as empty.
  fs.chmodSync(opaque, 0o111);

  try {
    assert.throws(
      () => existingProjectSecretPaths(project, 50_000, false),
      /could not enumerate.*partial deny-read policy/is,
    );
    // With a complete glob fallback the subtree is covered regardless, so the
    // same input must not block startup.
    assert.ok(Array.isArray(existingProjectSecretPaths(project, 50_000, true)));
  } finally {
    fs.chmodSync(opaque, 0o755);
  }
});

test("project secret scan fails closed at its cap without glob fallback", (context) => {
  const project = tempProject(context, "pi-scan-cap-test-");
  fs.mkdirSync(path.join(project, "first"));
  fs.mkdirSync(path.join(project, "second"));

  assert.throws(
    () => existingProjectSecretPaths(project, 1, false),
    /secret scan exceeded 1 directories.*partial deny-read policy/i,
  );
});
