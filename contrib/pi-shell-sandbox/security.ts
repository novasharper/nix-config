// Host-side guard, evaluated before a tool runs and independently of the
// sandbox policy. It gates credential access, confirms destructive commands,
// and holds the fail-closed bash delegate.
import path from "node:path";

import { errorMessage } from "./errors.ts";
import { resolveReal, resolveThroughBrokenLinks } from "./fs-paths.ts";
import type { SandboxBashOperations } from "./sandbox.ts";
import {
  accessesSecret,
  exposesSecretValue,
  isDestructiveCommand,
} from "./secrets.ts";
import { trustedProject } from "./session.ts";

type GuardResult = { block: true; reason: string } | undefined;

function escapesDirectory(target: string, root: string): boolean {
  return target !== root && !target.startsWith(`${root}${path.sep}`);
}

const escalationApproval = Symbol("pi-shell-sandbox.escalation-approval");

type EscalationInput = Record<PropertyKey, unknown>;

// Approval is attached as a module-private symbol after Pi validates the model
// input. The bash tool consumes it immediately before selecting host execution,
// so a model cannot forge approval with ordinary JSON tool arguments.
export function consumeEscalationApproval(input: EscalationInput): boolean {
  const approvedCommand = input[escalationApproval];
  delete input[escalationApproval];
  return (
    typeof approvedCommand === "string" &&
    approvedCommand === input.command
  );
}

const sandboxBashOperationsKey = Symbol.for(
  "nix-config.pi.shell-sandbox.operations",
);

function getSandboxBashOperations(): SandboxBashOperations | undefined {
  return (globalThis as Record<symbol, SandboxBashOperations | undefined>)[
    sandboxBashOperationsKey
  ];
}

// The absent delegate keeps model and user bash blocked during registration.
export function installSandboxBashOperations(
  operations: SandboxBashOperations,
): void {
  (globalThis as Record<symbol, SandboxBashOperations | undefined>)[
    sandboxBashOperationsKey
  ] = operations;
}

export const guardedUserBashOperations: SandboxBashOperations = {
  async exec(command, cwd, options) {
    const sandboxBashOperations = getSandboxBashOperations();
    if (!sandboxBashOperations) {
      throw new Error(
        "Shell sandbox is unavailable; refusing to run the command.",
      );
    }
    return sandboxBashOperations.exec(command, cwd, options);
  },
};

function blocked(reason: string): GuardResult {
  return { block: true, reason };
}

const fileTools = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const pathRequiredTools = new Set(["read", "write", "edit"]);
const writeTools = new Set(["write", "edit"]);

async function approveBashEscalation(
  input: EscalationInput,
  command: string,
  title: string,
  explanation: string,
  ctx: any,
): Promise<GuardResult> {
  if (!ctx.hasUI) {
    return blocked(`${explanation} Approval requires interactive mode.`);
  }

  const approved = await ctx.ui.confirm(
    title,
    `${explanation}\n\nAllow this command to run outside the shell sandbox?\n\n${command}`,
  );
  if (!approved) {
    return blocked("Unsandboxed command rejected by user.");
  }

  input.sandbox_permissions = "require_escalated";
  input[escalationApproval] = command;
}

// Splitting on the metacharacters that can abut an argument is enough here:
// this only has to name candidate paths, and anything it mis-splits ends up
// unattributable, which confirms.
const tokenSeparators = /[\s;&|<>()]+/;
const quotedToken = /^(['"])(.*)\1$/;
// Only a plain literal path can be attributed to a directory. resolveReal
// understands "@", "~", "~/", and file:// and nothing else, so a token
// carrying anything the shell would expand or strip resolves to a spelling
// bash never sees — `~user/…`, `\/Users/…`, `"/Users"/…`, `{/Users/x,}/…` and
// globs all land under the project while the command reads outside it.
// Listing what stays literal, rather than what expands, is what makes the
// unlisted case fail closed.
const unresolvableToken = /[$`\\{}*?[\]'"]|~(?!\/|$)/;
// Anything that re-roots the relative paths that follow. The flag forms cover
// `tar -C`, `git -C`, `make -C`, `env -C`, and clustered and attached
// spellings such as `tar -xC dir` and `tar -C../..`. Only a numeric value is
// excluded, because that is `grep -C2`, a context count rather than a
// directory — testing the value's first character instead would let through
// `-C..`, `-C~`, and `-C"$HOME"`.
const directoryChange =
  /\b(?:cd|pushd|popd)\b|(?:^|\s)-[a-zA-Z]*C(?=$|[^0-9])|--(?:directory|chdir)\b/;

// A flag can carry its path in the same token: `curl -d@PATH`, `ssh -iPATH`,
// `rsync --files-from=PATH`. Splitting the value out is what keeps those
// attributable — dropping every "-" token made them *absent* from attribution
// rather than unattributable, so a single in-project token elsewhere in the
// command was enough to call the whole thing contained.
const flagPrefix = /^-{1,2}[A-Za-z0-9-]*[=@]?/;

// The path a token contributes, or undefined when it carries none.
function pathCandidate(token: string): string | undefined {
  const assignment = /^[A-Za-z_][A-Za-z0-9_]*=(.*)$/.exec(token);
  if (assignment) {
    return assignment[1] === "" ? undefined : assignment[1];
  }
  if (!token.startsWith("-")) {
    return token;
  }
  const value = token.replace(flagPrefix, "");
  return value === "" ? undefined : value;
}

export function commandPathTokens(command: string): string[] {
  return command
    .split(tokenSeparators)
    .map((token) => {
      const quoted = quotedToken.exec(token);
      return quoted ? quoted[2] : token;
    })
    .filter((token) => token !== "");
}

// True when a command's credential-looking paths cannot all be shown to live
// inside the trusted project. accessesSecret matches the whole command line,
// so telling `cat .env` from `cat ~/.aws/credentials` means attributing the
// match to individual tokens. Every ambiguity answers "escapes": a wrong
// escape costs one confirmation prompt, a wrong containment costs a silent
// credential read.
export function secretPathsEscapeProject(
  command: string,
  project: string,
  cwd: string,
): boolean {
  if (directoryChange.test(command)) {
    return true;
  }

  const commandMentionsSecret = accessesSecret(command);
  let attributed = 0;
  for (const token of commandPathTokens(command)) {
    const candidate = pathCandidate(token);
    if (candidate === undefined) {
      // A flag with no value to split out still escapes if the flag itself
      // reads as a credential path: unattributable, not absent.
      if (accessesSecret(token)) {
        return true;
      }
      continue;
    }
    if (unresolvableToken.test(candidate)) {
      if (commandMentionsSecret) {
        return true;
      }
      continue;
    }

    const resolved = resolveReal(candidate, cwd);
    if (!accessesSecret(candidate) && !accessesSecret(resolved)) {
      continue;
    }
    attributed += 1;
    if (escapesDirectory(resolved, project)) {
      return true;
    }
  }

  // The command line matched but nothing in it did, so the match came from a
  // construct this cannot attribute.
  return commandMentionsSecret && attributed === 0;
}

async function guardBashCall(input: any, ctx: any): Promise<GuardResult> {
  if (!getSandboxBashOperations()) {
    return blocked("Shell sandbox is unavailable; refusing to run the command.");
  }

  const command = input?.command;
  if (typeof command !== "string" || command.trim() === "") {
    return blocked("bash call without a command string is blocked.");
  }

  const requestedPermissions = input?.sandbox_permissions;
  if (
    requestedPermissions !== undefined &&
    requestedPermissions !== "require_escalated"
  ) {
    return blocked("Unknown bash sandbox permission request.");
  }

  // Undefined while the sandbox is on; otherwise the project trust was granted
  // for, which is what "inside the project" is measured against below.
  const trusted = trustedProject();

  if (requestedPermissions === "require_escalated") {
    const justification = input?.justification;
    if (typeof justification !== "string" || justification.trim() === "") {
      return blocked("Unsandboxed bash calls require a justification.");
    }
    return approveBashEscalation(
      input,
      command,
      "Run outside shell sandbox",
      `Reason: ${justification.trim()}`,
      ctx,
    );
  }

  const readsSecretPath = trusted === undefined
    ? accessesSecret(command)
    : secretPathsEscapeProject(
        command,
        trusted,
        resolveThroughBrokenLinks(String(ctx.cwd)),
      );
  if (readsSecretPath || exposesSecretValue(command)) {
    return approveBashEscalation(
      input,
      command,
      "Access protected data",
      "This command may read credentials, secrets, or credential stores.",
      ctx,
    );
  }

  if (isDestructiveCommand(command)) {
    if (!ctx.hasUI) {
      return blocked("Destructive commands are blocked in non-interactive mode.");
    }

    const approved = await ctx.ui.confirm(
      "Potentially destructive command",
      `Allow this command?\n\n${command}`,
    );
    if (!approved) {
      return blocked("Command rejected by user.");
    }
  }
}

async function guardFileToolCall(
  toolName: string,
  requestedPath: unknown,
  ctx: any,
): Promise<GuardResult> {
  if (
    requestedPath === undefined ||
    requestedPath === null ||
    requestedPath === ""
  ) {
    if (pathRequiredTools.has(toolName)) {
      return blocked(`${toolName} call without a path is blocked.`);
    }
    // grep/find/ls default to the project directory.
    return;
  }

  if (typeof requestedPath !== "string") {
    return blocked(`${toolName} call with a non-string path is blocked.`);
  }

  const realCwd = resolveThroughBrokenLinks(String(ctx.cwd));
  const resolvedPath = resolveReal(requestedPath, realCwd);

  // A trusted project is unrestricted inside its own tree — the sandbox is off
  // and its own .env is part of the work. Only paths that leave the project
  // are still confirmed, measured against the trusted project rather than
  // ctx.cwd, which can move outside it once commands run unwrapped.
  const trusted = trustedProject();
  if (trusted !== undefined && !escapesDirectory(resolvedPath, trusted)) {
    return;
  }

  if (accessesSecret(requestedPath) || accessesSecret(resolvedPath)) {
    if (!ctx.hasUI) {
      return blocked(
        "Credential and secret paths are blocked in non-interactive mode.",
      );
    }

    const approved = await ctx.ui.confirm(
      "Access protected path",
      `Allow ${toolName} to access ${resolvedPath}?`,
    );
    if (!approved) {
      return blocked("Protected path access rejected by user.");
    }
  }

  const writeRoot = trusted ?? realCwd;
  if (writeTools.has(toolName) && escapesDirectory(resolvedPath, writeRoot)) {
    if (!ctx.hasUI) {
      return blocked(
        "Writes outside the project are blocked in non-interactive mode.",
      );
    }

    const approved = await ctx.ui.confirm(
      "Write outside project",
      `Allow ${toolName} to modify ${resolvedPath}?`,
    );
    if (!approved) {
      return blocked("Write rejected by user.");
    }
  }
}

async function evaluateToolCall(event: any, ctx: any): Promise<GuardResult> {
  if (event.toolName === "bash") {
    return guardBashCall(event.input, ctx);
  }
  if (fileTools.has(event.toolName)) {
    return guardFileToolCall(event.toolName, event.input?.path, ctx);
  }
}

export async function guardToolCall(
  event: any,
  ctx: any,
): Promise<GuardResult> {
  try {
    return await evaluateToolCall(event, ctx);
  } catch (error) {
    return blocked(
      `Security extension failed (${errorMessage(error)}); blocking.`,
    );
  }
}
