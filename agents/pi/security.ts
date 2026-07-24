import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const destructiveCommands = [
  // Match a recursive flag anywhere in the argument list, not just the first
  // flag token (`rm -f -r x`), while ignoring long options like --force.
  /\brm\b[^;&|]*(?:\s-[a-zA-Z]*[rR]|\s--recursive\b)/,
  /\bsudo\b/,
  /\b(?:mkfs|fdisk|diskutil\s+erase|dd\s+if=)\b/,
  /\bgit\s+(?:push\b[^;&|]*--force|reset\s+--hard|clean\b[^;&|]*\s-[a-zA-Z]*f)/,
  /\b(?:curl|wget)\b[^|;&]*\|\s*(?:ba|z|fi)?sh\b/,
  /\b(?:ba|z|fi)?sh\s+(?:-\S+\s+)*<\(\s*(?:curl|wget)\b/,
  /\bfind\b[^;&|]*\s-delete\b/,
  /\bnix-store\s+--delete\b/,
];

const piSecretEnvVars = [
  "AI_GATEWAY_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_OAUTH_TOKEN",
  "ANT_LING_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_OPENAI_API_KEY",
  "CEREBRAS_API_KEY",
  "CLOUDFLARE_API_KEY",
  "COPILOT_GITHUB_TOKEN",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GEMINI_API_KEY",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GOOGLE_CLOUD_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "KIMI_API_KEY",
  "LLM_AUTH_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "MISTRAL_API_KEY",
  "MOONSHOT_API_KEY",
  "NPM_TOKEN",
  "NVIDIA_API_KEY",
  "OPENCODE_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "QWEN_TOKEN_PLAN_API_KEY",
  "QWEN_TOKEN_PLAN_CN_API_KEY",
  "RADIUS_API_KEY",
  "TOGETHER_API_KEY",
  "XAI_API_KEY",
  "XIAOMI_API_KEY",
  "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  "ZAI_API_KEY",
  "ZAI_CODING_CN_API_KEY",
];

const piSecretEnvPattern = new RegExp(`\\b(?:${piSecretEnvVars.join("|")})\\b`);

const credentialDumpCommands = [
  /\b(?:env|export|set)\s*(?:$|[;&|>])/,
  /\b(?:declare|typeset|export)\s+(?:-[a-zA-Z]+\s*)*(?:$|[;&|>])/,
  /\bprintenv\b/,
  /\bprocess\.env\b/,
  /\bos\.environ\b/,
  /\/proc\/(?:self|\d+)\/environ\b/,
  /\bsecurity\s+find-(?:generic|internet)-password\b[^;&|]*\s-w\b/,
  /\bop\s+read\b/,
  /\bgh\s+auth\s+token\b/,
  /\bgcloud\s+auth\s+(?:application-default\s+)?print-access-token\b/,
  /\baws\s+configure\s+export-credentials\b/,
];

// Case-insensitive: the default macOS filesystem is case-insensitive, so
// ~/.SSH and ~/.ssh are the same directory.
const secretPaths = [
  /(?:^|\/)\.env(?:\.|$)/i,
  /(?:^|\/)\.git\/(?:config|credentials)(?:\/|$)/i,
  /(?:^|\/)\.(?:aws|docker|gnupg|kube|ssh)(?:\/|$)/i,
  /(?:^|\/)\.config\/gcloud\/application_default_credentials\.json$/i,
  /(?:^|\/)\.pi\/agent\/(?:auth|models)\.json$/i,
  /(?:^|\/)(?:auth|models)\.json$/i,
  /(?:^|\/)(?:credentials|secrets?)(?:\.|\/|$)/i,
  /(?:^|\/)\.(?:llm-auth-key|netrc|npmrc|openrouter-api-key)$/i,
  /\/Library\/Keychains(?:\/|$)/i,
];

function accessesSecret(value: string): boolean {
  return secretPaths.some((pattern) => pattern.test(value));
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

function realpathSafe(target: string, depth = 0): string {
  if (depth > 32) {
    return target;
  }
  try {
    return fs.realpathSync.native(target);
  } catch {
    // realpath fails for broken symlinks; resolve one link level manually.
    try {
      const link = fs.readlinkSync(target);
      return realpathSafe(path.resolve(path.dirname(target), link), depth + 1);
    } catch {
      return target;
    }
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

// Resolve symlinks in the deepest existing ancestor so a link inside the
// project can't smuggle reads/writes past the lexical checks.
function resolveReal(requestedPath: string, cwd: string): string {
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
  return path.join(realpathSafe(existing), ...tail);
}

const fileTools = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const pathRequiredTools = new Set(["read", "write", "edit"]);
const writeTools = new Set(["write", "edit"]);

async function guardToolCall(event: any, ctx: any) {
  if (event.toolName === "bash") {
    const command = event.input?.command;
    if (typeof command !== "string" || command.trim() === "") {
      return {
        block: true,
        reason: "bash call without a command string is blocked.",
      };
    }

    if (
      accessesSecret(command) ||
      piSecretEnvPattern.test(command) ||
      credentialDumpCommands.some((pattern) => pattern.test(command))
    ) {
      return {
        block: true,
        reason: "Access to Pi credentials, provider secrets, and credential stores is blocked.",
      };
    }

    if (destructiveCommands.some((pattern) => pattern.test(command))) {
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: "Destructive commands are blocked in non-interactive mode.",
        };
      }

      const approved = await ctx.ui.confirm(
        "Potentially destructive command",
        `Allow this command?\n\n${command}`,
      );
      if (!approved) {
        return { block: true, reason: "Command rejected by user." };
      }
    }
  }

  if (fileTools.has(event.toolName)) {
    const requestedPath = event.input?.path;

    if (requestedPath === undefined || requestedPath === null || requestedPath === "") {
      if (pathRequiredTools.has(event.toolName)) {
        return {
          block: true,
          reason: `${event.toolName} call without a path is blocked.`,
        };
      }
      // grep/find/ls default to the project directory.
      return;
    }

    if (typeof requestedPath !== "string") {
      return {
        block: true,
        reason: `${event.toolName} call with a non-string path is blocked.`,
      };
    }

    const realCwd = realpathSafe(String(ctx.cwd));
    const resolvedPath = resolveReal(requestedPath, realCwd);

    if (accessesSecret(requestedPath) || accessesSecret(resolvedPath)) {
      return {
        block: true,
        reason: "Access to credential and secret paths is blocked.",
      };
    }

    if (
      writeTools.has(event.toolName) &&
      resolvedPath !== realCwd &&
      !resolvedPath.startsWith(`${realCwd}${path.sep}`)
    ) {
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: "Writes outside the project are blocked in non-interactive mode.",
        };
      }

      const approved = await ctx.ui.confirm(
        "Write outside project",
        `Allow ${event.toolName} to modify ${resolvedPath}?`,
      );
      if (!approved) {
        return { block: true, reason: "Write rejected by user." };
      }
    }
  }
}

export default function (pi: any) {
  pi.on("tool_call", async (event: any, ctx: any) => {
    try {
      return await guardToolCall(event, ctx);
    } catch (err) {
      // Fail closed: a guard that errors must not fall through to "allow".
      return {
        block: true,
        reason: `Security extension failed (${err instanceof Error ? err.message : String(err)}); blocking.`,
      };
    }
  });
}
