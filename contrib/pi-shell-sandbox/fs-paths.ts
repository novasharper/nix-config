// Filesystem path resolution shared by the guard and the project scanner.
//
// Three realpath helpers live here because they differ in what they do when
// resolution fails, and each caller depends on its own behaviour. They are
// deliberately not merged.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Falls back to the input. Used while walking, where an unresolvable entry
// still has to be compared against the visited set under some stable name.
export function realpathOrSelf(target: string): string {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return target;
  }
}

// Resolves one link level at a time so a broken link still yields its intended
// target. Used by the guard, where a path the model names may not exist yet.
export function resolveThroughBrokenLinks(target: string, depth = 0): string {
  if (depth > 32) {
    return target;
  }
  try {
    return fs.realpathSync.native(target);
  } catch {
    // realpath fails for broken symlinks; resolve one link level manually.
    try {
      const link = fs.readlinkSync(target);
      return resolveThroughBrokenLinks(
        path.resolve(path.dirname(target), link),
        depth + 1,
      );
    } catch {
      return target;
    }
  }
}

// Returns undefined rather than the input, so the scanner can tell "this link
// resolves to X" from "this link resolves to nothing to classify". The lexical
// spelling is preserved for a broken link as well, so a future target with a
// credential-bearing name is already present in macOS's literal deny policy;
// Linux will resolve it on the next per-command refresh once it exists.
export function symlinkTarget(entryPath: string): string | undefined {
  try {
    return fs.realpathSync.native(entryPath);
  } catch {
    try {
      return path.resolve(path.dirname(entryPath), fs.readlinkSync(entryPath));
    } catch {
      return undefined;
    }
  }
}

// readdirSync reports a symlinked directory as isDirectory() === false, so a
// link inside the project would otherwise never be descended into and its
// secrets would never reach denyRead.
export function isDirectoryTarget(
  entry: fs.Dirent,
  entryPath: string,
): boolean {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  try {
    return fs.statSync(entryPath).isDirectory();
  } catch {
    return false;
  }
}

function existsLstat(target: string): boolean {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

// Mirror pi's own input normalization (utils/paths.ts): strip an "@" prefix,
// expand "~", and unwrap file:// URLs. Anything pi's tools expand that we
// don't is a guard bypass.
function normalizeLikePi(input: string): string {
  let value = input;
  if (value.startsWith("@")) {
    value = value.slice(1);
  }
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (/^file:\/\//.test(value)) {
    return fileURLToPath(value);
  }
  return value;
}

// Resolve symlinks in the deepest existing ancestor so a link inside the
// project can't smuggle reads/writes past the lexical checks.
export function resolveReal(requestedPath: string, cwd: string): string {
  const resolved = path.resolve(cwd, normalizeLikePi(requestedPath));
  const tail: string[] = [];
  let existing = resolved;
  while (!existsLstat(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      break;
    }
    tail.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(resolveThroughBrokenLinks(existing), ...tail);
}
