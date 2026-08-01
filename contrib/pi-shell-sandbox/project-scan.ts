// Enumerates credential paths inside the project so they can be named in
// denyRead/denyWrite.
//
// Sandbox Runtime applies denyRead as denyOnly — reads are allow-by-default —
// so anything this scan does not name stays readable inside the sandbox. That
// is why the walk descends into generated trees, follows symlinks, and refuses
// to start on a partial result where no glob fallback covers the gap.
// See UPSTREAM.md §2.2.
import fs from "node:fs";
import path from "node:path";

import { errorMessage } from "./errors.ts";
import { isDirectoryTarget, realpathOrSelf, symlinkTarget } from "./fs-paths.ts";
import { accessesSecret, projectSecretPathGlobs } from "./secrets.ts";

// Denied whether or not they exist, so a file created later at one of these
// fixed locations is already covered. Also covers the names accessesSecret
// deliberately does not match at the project root (a bare `credentials`).
const fixedSecretRelativePaths = [
  ".env",
  ".git/config",
  ".git/credentials",
  ".aws",
  ".docker",
  ".gnupg",
  ".kube",
  ".ssh",
  ".config/gcloud/application_default_credentials.json",
  ".pi/agent/auth.json",
  ".pi/agent/models.json",
  "auth.json",
  "models.json",
  ".llm-auth-key",
  ".netrc",
  ".npmrc",
  ".openrouter-api-key",
  "Library/Keychains",
  "secret",
  "secrets",
  "credentials",
  ".git-credentials",
];

// Generated trees. Walking them in full can dominate the scan: a Rust target/
// or a JS node_modules is far larger than the source it was built from. They
// are not skipped outright, though — these trees do hold credentials
// (.venv/pip.conf, node_modules/@scope/pkg/.npmrc). Where a complete glob
// fallback exists they are opened one level deep and the globs cover the rest;
// elsewhere they are scanned to boundedScanDepth.
const generatedDirectoryNames = new Set([
  ".direnv",
  ".next",
  ".venv",
  "build",
  "dist",
  "node_modules",
  "target",
  "venv",
]);

// Descent budget for subtrees whose size this scan does not control: generated
// trees, and links that resolve outside the project. Deep enough to reach
// node_modules/@scope/package/.npmrc, shallow enough that a stray link to $HOME
// cannot walk the whole home directory into the cap below.
const boundedScanDepth = 3;

// budget is the number of further levels a directory may be descended into;
// Infinity for ordinary project directories.
type ScanEntry = { directory: string; budget: number };

type ScanContext = {
  project: string;
  hasCompleteGlobFallback: boolean;
  result: Set<string>;
  queue: ScanEntry[];
  visited: Set<string>;
};

// git objects are content-addressed: every name is a hex fragment, so none can
// match accessesSecret. Skipping them costs no coverage and saves 256
// directories per repository.
function isContentAddressedGitData(relativePath: string): boolean {
  return /(?:^|\/)\.git\/objects(?:\/|$)/.test(relativePath);
}

function seedSecretPaths(project: string): Set<string> {
  return new Set(
    fixedSecretRelativePaths.map((entry) => path.join(project, entry)),
  );
}

// A directory can forbid listing while still allowing a known name to be
// opened — mode 0111 is the textbook case — so treating an unreadable
// directory as empty leaves everything under it readable under the deny-only
// read policy. Where the globs cover the tree that costs nothing; where they
// do not, it is the same partial policy the directory cap refuses to start
// with.
function readDirectoryOrFail(
  directory: string,
  hasCompleteGlobFallback: boolean,
): fs.Dirent[] | undefined {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (hasCompleteGlobFallback) {
      return undefined;
    }
    throw new Error(
      `Project secret scan could not enumerate ${directory} (${errorMessage(error)}); refusing to start with a partial deny-read policy. Make the directory readable, or open pi on a narrower directory.`,
    );
  }
}

// Both spellings of a secret-bearing entry, or undefined when it is not one.
// An innocuous link such as `config -> ../.env` bypasses the lexical command
// guard, while a deny on only the link or only an in-project spelling can miss
// the canonical target on the other side of the project boundary.
function secretPathsForEntry(
  entryPath: string,
  relativePath: string,
  linkTarget: string | undefined,
): string[] | undefined {
  const isSecret =
    accessesSecret(relativePath) ||
    (linkTarget !== undefined && accessesSecret(linkTarget));
  if (!isSecret) {
    return undefined;
  }
  return [entryPath, linkTarget ?? realpathOrSelf(entryPath)];
}

// One level down, clamped for subtrees this scan does not control.
function descentBudget(
  entry: fs.Dirent,
  resolved: string,
  parentBudget: number,
  project: string,
  hasCompleteGlobFallback: boolean,
): number {
  let budget = parentBudget - 1;
  if (generatedDirectoryNames.has(entry.name)) {
    budget = Math.min(budget, hasCompleteGlobFallback ? 0 : boundedScanDepth);
  }
  // A link out of the project can point at an arbitrarily large tree —
  // `ln -s ~ ./home` would otherwise walk the whole home directory.
  const escapesProject =
    resolved !== project && !resolved.startsWith(`${project}${path.sep}`);
  if (escapesProject) {
    budget = Math.min(budget, boundedScanDepth);
  }
  return budget;
}

function projectRelativePath(project: string, entryPath: string): string {
  return path.relative(project, entryPath).split(path.sep).join("/");
}

function recordSecretEntry(
  context: ScanContext,
  entryPath: string,
  relativePath: string,
  linkTarget: string | undefined,
): boolean {
  const secrets = secretPathsForEntry(entryPath, relativePath, linkTarget);
  if (!secrets) {
    return false;
  }
  for (const secret of secrets) {
    context.result.add(secret);
  }
  return true;
}

function queueDirectory(
  context: ScanContext,
  scan: ScanEntry,
  entry: fs.Dirent,
  entryPath: string,
  relativePath: string,
): void {
  if (
    scan.budget <= 0 ||
    !isDirectoryTarget(entry, entryPath) ||
    isContentAddressedGitData(relativePath)
  ) {
    return;
  }

  const resolved = realpathOrSelf(entryPath);
  if (context.visited.has(resolved)) {
    return;
  }
  context.visited.add(resolved);
  context.queue.push({
    directory: entryPath,
    budget: descentBudget(
      entry,
      resolved,
      scan.budget,
      context.project,
      context.hasCompleteGlobFallback,
    ),
  });
}

function scanDirectory(context: ScanContext, scan: ScanEntry): void {
  const entries = readDirectoryOrFail(
    scan.directory,
    context.hasCompleteGlobFallback,
  );
  if (!entries) {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(scan.directory, entry.name);
    const relativePath = projectRelativePath(context.project, entryPath);
    const linkTarget = entry.isSymbolicLink()
      ? symlinkTarget(entryPath)
      : undefined;

    if (recordSecretEntry(context, entryPath, relativePath, linkTarget)) {
      continue;
    }
    queueDirectory(context, scan, entry, entryPath, relativePath);
  }
}

function addGlobFallbacks(project: string, result: Set<string>): void {
  for (const pattern of projectSecretPathGlobs) {
    result.add(path.join(project, pattern));
  }
}

export function existingProjectSecretPaths(
  project: string,
  directoryLimit = 50_000,
  hasCompleteGlobFallback = process.platform === "darwin",
): string[] {
  const result = seedSecretPaths(project);
  const queue: ScanEntry[] = [
    { directory: project, budget: Number.POSITIVE_INFINITY },
  ];
  // Symlinks are followed, so a visited set of resolved paths is what keeps a
  // cycle (or a link back to an ancestor) from looping forever.
  const visited = new Set<string>([realpathOrSelf(project)]);
  const context: ScanContext = {
    project,
    hasCompleteGlobFallback,
    result,
    queue,
    visited,
  };
  let directoriesVisited = 0;

  while (queue.length > 0) {
    if (directoriesVisited >= directoryLimit) {
      if (hasCompleteGlobFallback) {
        break;
      }
      throw new Error(
        `Project secret scan exceeded ${directoryLimit} directories under ${project}; refusing to start with a partial deny-read policy. Open pi on a narrower directory, or remove symlinks pointing outside it.`,
      );
    }

    const scan = queue.pop()!;
    directoriesVisited += 1;
    scanDirectory(context, scan);
  }

  if (hasCompleteGlobFallback) {
    addGlobFallbacks(project, result);
  }

  return [...result];
}
