// Lexical secret classification: the patterns that decide whether a string
// names a credential. Pure — no fs, no os, no platform checks — so both the
// host-side guard (security.ts) and the project scanner (project-scan.ts) can
// classify the same shapes.

// Provider credentials pi itself may hold. Also the seed for the environment
// sanitizer's explicit removal list.
export const piSecretEnvVars = [
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

// Bounds for a path token inside a shell command line. Both sets cover the
// metacharacters that can abut an argument — backtick (\x60), parentheses and
// "$" included, so `cat ~/.netrc` and (cat ~/.npmrc) are not bypasses. "." is
// in both so dotted credential files (.credentials.json) and suffixed copies
// (.env.local, auth.json.bak) still match.
const pathStart = String.raw`(?:^|[\/\s"'=<>(\x60$&|;:,.])`;
const pathEnd = String.raw`(?=$|[\/\s"';&|<>()\x60$:,.])`;

// "credentials"/"secret(s)" is a real word as well as a path component, so it
// only counts when a separator or extension dot sits next to it. That blocks
// secrets/prod.yaml and ~/.credentials.json while leaving prose alone —
// `git commit -m "add secret rotation"` and `rg secrets src/` are not attacks.
const secretWord = String.raw`(?:credentials|secrets?)`;

// Case-insensitive: the default macOS filesystem is case-insensitive, so
// ~/.SSH and ~/.ssh are the same directory.
const secretPaths = [
  String.raw`${pathStart}\.env${pathEnd}`,
  String.raw`${pathStart}\.git\/(?:config|credentials)${pathEnd}`,
  String.raw`${pathStart}\.(?:aws|docker|gnupg|kube|ssh)${pathEnd}`,
  String.raw`${pathStart}\.config\/gcloud\/application_default_credentials\.json${pathEnd}`,
  String.raw`${pathStart}\.(?:pi|config\/pi)\/agent\/(?:auth|models)\.json${pathEnd}`,
  String.raw`${pathStart}(?:auth|models)\.json${pathEnd}`,
  String.raw`${pathStart}${secretWord}(?=[\/.])|[\/.]${secretWord}${pathEnd}`,
  // ~/.claude holds an OAuth token, but its settings.json is ordinary config,
  // so only the credential-bearing entries are guarded.
  String.raw`${pathStart}\.claude(?:\.json|\/(?:\.env|\.credentials\.json|secrets))${pathEnd}`,
  String.raw`${pathStart}\.(?:git-credentials|llm-auth-key|netrc|npmrc|openrouter-api-key)${pathEnd}`,
  String.raw`${pathStart}Library\/Keychains${pathEnd}`,
].map((source) => new RegExp(source, "i"));

const projectSecretPathGlobBases = [
  "**/.env",
  "**/.env.*",
  "**/.git/config",
  "**/.git/credentials",
  "**/.aws",
  "**/.docker",
  "**/.gnupg",
  "**/.kube",
  "**/.ssh",
  "**/.config/gcloud/application_default_credentials.json",
  "**/.pi/agent/auth.json",
  "**/.pi/agent/models.json",
  "**/auth.json",
  "**/models.json",
  // The secretWord rule in secretPaths above matches a bare word, a
  // dot-prefixed one, and either as a suffix — `credentials`, `.credentials`,
  // `credentials.yaml`, `.credentials.yaml`, `config.credentials`. Every shape
  // needs a glob, because on macOS this list is the only thing covering a file
  // that appears after the scan or below a subtree the scan stopped at. A
  // measured gap: `.credentials.yaml` and `config.credentials` were readable.
  "**/credentials",
  "**/credentials.*",
  "**/.credentials",
  "**/.credentials.*",
  "**/*.credentials",
  "**/*.credentials.*",
  "**/secret",
  "**/secret.*",
  "**/.secret",
  "**/.secret.*",
  "**/*.secret",
  "**/*.secret.*",
  "**/secrets",
  "**/secrets.*",
  "**/.secrets",
  "**/.secrets.*",
  "**/*.secrets",
  "**/*.secrets.*",
  "**/.claude.json",
  "**/.claude/.credentials.json",
  "**/.git-credentials",
  "**/.llm-auth-key",
  "**/.netrc",
  "**/.npmrc",
  "**/.openrouter-api-key",
  "**/Library/Keychains",
] as const;

// A guarded path might itself be a directory. Include its descendants so the
// Darwin fallback has the same coverage as the lexical matcher above.
export const projectSecretPathGlobs = projectSecretPathGlobBases.flatMap(
  (pattern) => [pattern, `${pattern}/**`],
);

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

// Commands that print an environment or read a credential store directly,
// rather than naming a secret path.
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

// True when the value names a credential path. The value is a whole command
// line for the guard and a project-relative path for the scanner; the patterns
// are anchored on path-adjacent metacharacters so both work.
export function accessesSecret(value: string): boolean {
  return secretPaths.some((pattern) => pattern.test(value));
}

// True when the command would print a provider credential rather than open one.
export function exposesSecretValue(command: string): boolean {
  return (
    piSecretEnvPattern.test(command) ||
    credentialDumpCommands.some((pattern) => pattern.test(command))
  );
}

// True when the command destroys data or escalates; the guard confirms these
// with the user rather than blocking outright.
export function isDestructiveCommand(command: string): boolean {
  return destructiveCommands.some((pattern) => pattern.test(command));
}
