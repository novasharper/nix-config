# Upstream reference: pi, pi.nix, and sandbox-runtime

Facts about the three upstream projects `agents/pi/` and
`contrib/pi-shell-sandbox/` build on, recorded so changes there don't have to
re-derive them. Everything below was read out of the pinned store paths, not
from documentation — upstream ships no reference for most of it.

**When editing `contrib/pi-shell-sandbox/`, read this first.** The sandbox
extension's
correctness depends on several non-obvious upstream behaviours (allow-by-default
reads, Linux globs being inert, first-handler-wins events); each is called out
below with a ⚠️.

## Re-deriving the store paths

The paths in this document are pinned versions and will change on
`nix flake update`. To find the current ones:

```bash
# pi coding agent (the JS package, with .d.ts files)
nix eval --raw .#pi-coding-agent-bun
#   → <store>/lib/node_modules/@earendil-works/pi-coding-agent/

# pi.nix (the flake that provides the home-manager module)
nix flake metadata --json | jq -r '.locks.nodes.pi.locked'
#   the checkout lands in /nix/store/*-source with coding-agent/options.nix

# @anthropic-ai/sandbox-runtime (pulled in through pi's bun.lock)
ls -d /nix/store/*bun-pkg--anthropic-ai-sandbox-runtime-*/share/bun-packages/@anthropic-ai/sandbox-runtime@*/
```

Versions this document was written against: pi `0.83.0`, sandbox-runtime
`0.0.26`, pi.nix rev `3b8eaf7`.

---

## 1. pi coding agent

Package root: `@earendil-works/pi-coding-agent`. Type declarations sit next to
the `.js` files (`core/tools/bash.d.ts`, `core/extensions/types.d.ts`, …), and
`index.d.ts` re-exports the public surface.

### 1.1 Extension entry point

An extension is a default-exported function taking `ExtensionAPI`
(`core/extensions/types.d.ts:855`):

```ts
export default function (pi: ExtensionAPI) { … }
```

Registration methods: `on`, `registerTool`, `registerCommand`,
`registerShortcut`, `registerFlag`, `getFlag`, `registerMessageRenderer`,
`registerEntryRenderer`, `sendMessage`, `sendUserMessage`, `appendEntry`,
`setSessionName`, `getSessionName`, `setLabel`, `exec`, `getActiveTools`,
`getAllTools`, `setActiveTools`, `getCommands`, `setModel`, `getThinkingLevel`,
`setThinkingLevel`, `registerProvider`.

### 1.2 Events

`on()` is overloaded per event name. The ones this repo uses:

| Event | Result type | Notes |
| --- | --- | --- |
| `session_start` | — | Also fires for `reload`, `new`, `resume`, `fork`; `event.reason` says which. `ctx.cwd` can differ between fires. |
| `session_shutdown` | — | |
| `tool_call` | `ToolCallEventResult` | `{ block?: boolean; reason?: string }`. To rewrite arguments, mutate `event.input` in place. |
| `user_bash` | `UserBashEventResult` | `{ operations?: BashOperations; result?: BashResult }`. Fired for `!`-prefixed user commands. |

⚠️ **First non-undefined result wins.** `ExtensionRunner.emitUserBash`
(`core/extensions/runner.js:717`) iterates extensions in registration order,
then each extension's handlers in registration order, and `return`s on the first
truthy handler result. Registering a second `user_bash` handler on the same
extension after one that always returns is dead code. A handler that throws is
reported through `emitError` and skipped — it does not block.

The agent loop validates tool arguments once, passes that object to
`beforeToolCall`, then retains the same object for `tool.execute`; it does not
clone or revalidate after the event. Mutations and symbol properties attached by
a `tool_call` handler therefore reach the tool definition.

### 1.3 ExtensionContext

Handlers receive `(event, ctx)` where `ctx` is `ExtensionContext`
(`types.d.ts:209`):

- `ctx.cwd: string` — current working directory
- `ctx.hasUI: boolean` — dialog-capable UI available (TUI and RPC modes)
- `ctx.mode: ExtensionMode`
- `ctx.ui: ExtensionUIContext` — `select`, `confirm(title, message)`,
  `input`, `notify(message, "info" | "warning" | "error")`,
  `onTerminalInput`, `setStatus(key, text | undefined)`, `setWorkingMessage`
- `ctx.sessionManager`, `ctx.modelRegistry`, `ctx.model`

### 1.4 The bash tool

`core/tools/bash.d.ts`. All of these are re-exported from the package root.

```ts
interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
}

interface BashSpawnContext { command: string; cwd: string; env: NodeJS.ProcessEnv }
type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

interface BashToolOptions {
  operations?: BashOperations;      // default: local shell
  commandPrefix?: string;           // prepended to every command, newline-separated
  shellPath?: string;               // explicit shell path from settings
  exposeSessionEnvironment?: boolean; // default true; injects PI_* vars
  spawnHook?: BashSpawnHook;        // adjust command/cwd/env before execution
}

function createLocalBashOperations(options?: { shellPath?: string }): BashOperations;
function createBashToolDefinition(cwd: string, options?: BashToolOptions): ToolDefinition<…>;
function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<…>;
```

`createBashToolDefinition` captures `cwd` once and passes it to
`resolveSpawnContext(command, cwd, spawnHook, exposeSessionEnvironment, ctx)`
(`core/tools/bash.js:114`), which builds `env` from `getShellEnv()`, strips the
five `PI_*` session variables, re-adds them when `exposeSessionEnvironment` is
set, and finally applies `spawnHook`. **`spawnHook` is the supported way to
rebind `cwd` per call** — do not rebuild the whole tool definition inside
`execute`.

### 1.5 Shell resolution

⚠️ `createLocalBashOperations` resolves its interpreter through
`getShellConfig(options?.shellPath)` (`utils/shell.js:58`), which on Unix tries
`/bin/bash`, then `bash` on `PATH`, then falls back to `sh -c`. **It never reads
`$SHELL`.** Anything that hands a different interpreter to a downstream wrapper
changes the language the model's commands are interpreted in, and non-bash
login shells (zsh, fish) source their own rc files.

`getShellEnv()` (`utils/shell.js:103`) returns `process.env` with pi's managed
bin directory prepended to `PATH`.

### 1.6 CLI argument order

⚠️ pi requires its subcommand to be **`argv[0]` literally**. `cli/credential-print.js:6`
tests `args[0] === "auth"`, and the other subcommands parse the same way. Global
flags such as `--append-system-prompt` or `--extension` placed *before* the
subcommand break it. This is why `agents/pi/default.nix` carries its own
subcommand-first wrapper (see §3.3).

---

## 2. @anthropic-ai/sandbox-runtime

Public surface (`dist/index.d.ts`): `SandboxManager`, `SandboxViolationStore`,
`getDefaultWritePaths`, and the config types/schemas.

### 2.1 SandboxManager

```ts
initialize(config, sandboxAskCallback?, enableLogMonitor?): Promise<void>
isSandboxingEnabled(): boolean
waitForNetworkInitialization(): Promise<boolean>
wrapWithSandbox(command, binShell?, customConfig?, abortSignal?): Promise<string>
getConfig(): SandboxRuntimeConfig | undefined
updateConfig(newConfig): void
reset(): Promise<void>
getLinuxGlobPatternWarnings(): string[]
annotateStderrWithSandboxFailures(command, stderr): string
```

`wrapWithSandbox` returns a *string*: the original command wrapped in
`sandbox-exec …` (macOS) or `bwrap … apply-seccomp …` (Linux), ending in
`<binShell> -c '<command>'`. The caller still has to run that string through a
shell. `binShell` defaults to the literal `bash`
(`macos-sandbox-utils.js:486`, `linux-sandbox-utils.js:659`), resolved on
`PATH` inside the sandbox — passing `"bash"` is the portable choice, and
`/bin/bash` does not exist on NixOS.

`customConfig` is a per-call overlay; it does not mutate the configuration held
by the manager. `wrapWithSandbox` selects `filesystem.allowWrite`, `denyWrite`,
and `denyRead` independently from the custom configuration with `??`, then
falls back to the stored configuration. The public type is only shallowly
`Partial<SandboxRuntimeConfig>`, so TypeScript callers that override one nested
filesystem field should spread the stored `filesystem` object and replace the
desired fields. This is the supported way to refresh a literal deny list for a
single command without racing a global `updateConfig`.

### 2.2 Filesystem policy semantics

`wrapWithSandbox` (`sandbox-manager.js:383`) derives:

```js
writeConfig = {
  allowOnly:        [...getDefaultWritePaths(), ...config.filesystem.allowWrite],
  denyWithinAllow:  config.filesystem.denyWrite,
};
readConfig = { denyOnly: config.filesystem.denyRead };
```

⚠️ **Reads are allow-by-default.** `denyRead` is a deny list, not an allowlist:
anything not named in it is readable inside the sandbox. A scan that builds
`denyRead` and skips subtrees leaves everything in those subtrees readable.

⚠️ **Symlink enforcement depends on the resolved target being covered.**
Measured on macOS with Sandbox Runtime 0.0.26, denying `<project>/.env` also
blocks `config -> .env`, because Seatbelt evaluates the file operation against
the canonical target. That does *not* protect `config -> ../.env`: a
project-rooted literal or glob does not match the outside target, and `cat
config` succeeds when neither the link nor target is otherwise denied. The
Linux wrapper generator likewise emits no read-deny mount for an unlisted link
or target. A scanner therefore has to classify file symlink targets and add
both the link spelling and resolved target; testing only an in-project link
does not exercise the escaping case.

⚠️ **Writes are allowlist-plus-holes.** Listing a path under `denyWrite` that
the runtime seeds via `getDefaultWritePaths()` revokes the runtime's own
default. `getDefaultWritePaths()` (`sandbox-utils.js:236`) is:
`/dev/{stdout,stderr,null,tty,dtracehelper,autofs_nowait}`, `/tmp/claude`,
`/private/tmp/claude`, `~/.npm/_logs`, `~/.claude/debug`.

### 2.3 Globs work on macOS only

macOS converts glob patterns to regex directly in the Seatbelt profile. Linux
resolves each deny path with `fs.existsSync` and mounts `--tmpfs` (directories)
or `--ro-bind /dev/null` (files) over it (`linux-sandbox-utils.js:481-505`), so
a pattern like `**/.env` simply doesn't exist and is silently skipped. The
runtime knows this and exposes `getLinuxGlobPatternWarnings()` to report the
inert patterns.

`globToRegex` is purely syntactic; it does not know about a consumer's lexical
path matcher. Separate shapes are required for `credentials.*`,
`.credentials.*`, `*.credentials`, and `*.credentials.*` (and the equivalent
`secret`/`secrets` forms). Real Seatbelt runs confirmed that these globs cover
matching files created *after* the policy was built. Tests should generate the
cross-product of words and shapes: a representative-name test stayed green
when `**/*.secrets.*` was removed, even though a late-created
`app.secrets.toml` then became readable.

Corollary: on Linux every denied path must be enumerated literally, and each one
becomes another bwrap mount argument on **every command**.

### 2.4 Mandatory deny scan

⚠️ `mandatoryDenySearchDepth` (default 3, `sandbox-manager.js:343`) is
**Linux-only** — the macOS branch never passes it — and it only searches for
shell/git rc files, never credentials. `linuxGetMandatoryDenyPaths`
(`linux-sandbox-utils.js:72`) runs one `rg --files --hidden --max-depth <n>`
per command, globbing exactly:

- `DANGEROUS_FILES` = `.gitconfig`, `.gitmodules`, `.bashrc`, `.bash_profile`,
  `.zshrc`, `.zprofile`, `.profile`, `.ripgreprc`, `.mcp.json`
- `getDangerousDirectories()` = `.vscode`, `.idea`, `.claude/commands`,
  `.claude/agents`
- `**/.git/hooks/**`, and `**/.git/config` unless `allowGitConfig`

It excludes `**/node_modules/**`. Its results feed `denyWithinAllow`
(the **write** side). It is not a credential scan and does not back-stop a
`denyRead` policy.

`generateFilesystemArgs` consumes the effective `denyOnly` list on every
`wrapWithSandbox` call. Consequently, a freshly enumerated literal supplied in
`customConfig.filesystem.denyRead` is mounted for that command, while a path
created after the stored configuration was built remains readable if the
caller keeps passing no override. The generated Linux wrapper was verified to
contain no mount for such an unlisted late-created `.env`.

### 2.5 Config shape

`SandboxRuntimeConfig` (`sandbox/sandbox-config.d.ts`):

```ts
{
  network: { allowedDomains, deniedDomains, allowUnixSockets,
             allowAllUnixSockets, allowLocalBinding },
  filesystem: { denyRead, allowWrite, denyWrite, allowGitConfig },
  enableWeakerNestedSandbox?, allowPty?, ignoreViolations?,
  ripgrep?: { command, args? },
  mandatoryDenySearchDepth?,
  seccomp?: { bpfPath, applyPath },   // Linux
}
```

Empty `allowedDomains` means *block all network*, not *allow all*; the proxy is
only started when the list is non-empty.

`generateProxyEnvVars` (`sandbox-utils.js:255`) sets `TMPDIR` inside the sandbox
from `CLAUDE_TMPDIR`, defaulting to `/tmp/claude` — which is why the extension
sets `CLAUDE_TMPDIR` for the session.

### 2.6 Linux assets

`vendor/seccomp/{x64,arm64}/unix-block.bpf` and `.../apply-seccomp` ship inside
the npm package; `contrib/pi-shell-sandbox/default.nix` copies them into `$out`
and substitutes their paths into the extension source.

---

## 3. pi.nix (`github:lukasl-dev/pi.nix`)

Provides `overlays.default` (the `pi-coding-agent-bun` package, among others)
and `homeModules.default` (the `programs.pi.coding-agent` options). The option
definitions live in `coding-agent/options.nix`; `coding-agent/module.nix` is the
thin per-platform wrapper.

### 3.1 Options

| Option | Meaning |
| --- | --- |
| `enable` | |
| `package` | Base pi package to wrap. |
| `rules` | Path or string → `--append-system-prompt`. Strings are written to `pi-AGENTS.md`. |
| `extensions` | List of paths → repeated `--extension`. |
| `skills`, `themes`, `promptTemplates` | Repeated `--skill` / `--theme` / `--prompt-template`. |
| `extraArgs` | Appended after the resource flags. |
| `environment` | Attrset of `{ value = …; }` or `{ file = …; }`, or a path to an env file sourced with `set -a`. Emitted as an `export` prelude. |
| `models`, `settings` | Rendered to JSON and installed into the agent config dir at run time. |
| `jail.enable`, `jail.permissions` | bubblewrap isolation via jail.nix. **Linux only** — throws on other platforms. |
| `finalRules` | Read-only: the resolved rules path (`null` when `rules` is unset). |
| `finalArgs` | Read-only: `resourceArgs ++ extraArgs`. |
| `finalPackage` | Read-only: the wrapper actually installed. |

### 3.2 How the wrapper is generated

`options.nix:270-395`. `resourceArgs` is built from `rules`/`skills`/
`extensions`/`themes`/`promptTemplates`. If `resourceArgs`, `environment`,
`models`, `settings`, and `extraArgs` are *all* empty, `finalPackage` is
`package` unchanged; otherwise it is a `writeShellScriptBin "pi"` of the form:

```bash
<envPrelude> <configDirPrelude> <modelsPrelude> <settingsPrelude>
case "${1-}" in install|remove|uninstall|update|list|config)
    exec <pi> "$@" ;;
  *)
    exec <pi> <resourceArgs> <extraArgs> "$@" ;;
esac
```

⚠️ **`auth` is missing from that case list**, so with `rules`/`extensions` set,
`pi auth` becomes `pi --append-system-prompt … auth`, which pi rejects (§1.6).

⚠️ `jail.enable` builds its bwrap permissions from `finalRules`/`finalArgs`.
An arrangement that carries the resource flags in its own wrapper instead of in
the module options leaves both empty, so the jail sees an agent with no rules
and no extensions. `agents/pi/default.nix` does exactly that and asserts
`jail.enable` is off as a result.

### 3.3 Why `agents/pi/default.nix` wraps pi itself

To keep `pi auth` working, the flags are carried by a local
`writeShellScriptBin "pi"` with `auth` added to the case list, passed as
`package`. Because `settings` and `environment` are still set, pi.nix wraps
*that* in turn — two wrapper scripts, one extra `exec` at startup. Drop the
local wrapper once upstream's case list covers `auth`.

---

## 4. This repo's extension

### 4.1 How pi finds and loads it

`--extension <dir>` resolves through `resolveExtensionEntries`
(`core/extensions/loader.js:450`): a `package.json` with a `pi.extensions` array
wins, else `index.ts`/`index.js`. Only the declared entries load.

Extensions are imported with **jiti** (`loader.js:317`), which transpiles
TypeScript and — with `tryNative: false` in the compiled binary — resolves every
import itself, relative files included. `isExtensionFile` accepts `.ts` and
`.js`. **So an extension is one declared entry point plus any number of sibling
files; it does not need to be bundled.**

Packages pi bundles into its own binary are injected as jiti `virtualModules`:
`typebox` (and `@sinclair/typebox`), `@earendil-works/pi-{coding-agent,agent-core,tui,ai}`
and their `@mariozechner/*` aliases. ⚠️ `@anthropic-ai/sandbox-runtime` is *not*
among them, so it has to be resolvable from the install prefix.

Beware `discoverExtensionsInDir` (`loader.js:489`), used for the config
extensions directory: it loads **every** `*.ts`/`*.js` directly inside it. That
is not our load path, but it is why the sources live in a subdirectory rather
than loose in `extensions/`.

### 4.2 Layout

`contrib/pi-shell-sandbox/` builds a single pi extension from a set of
TypeScript modules, installed as-is. It lives under `contrib/` with the repo's
other local derivations; `agents/pi/default.nix` consumes it as
`pkgs.pi-shell-sandbox`:

The source `package.json` marks the directory as an ESM Node package for
editors. `default.nix` adds the pinned version and installed extension path.

```
$out/package.json                              pi.extensions = [".../index.ts"]
$out/extensions/shell-sandbox/index.ts         entry point
$out/extensions/shell-sandbox/*.ts             imported relatively
$out/node_modules -> <pi-coding-agent-bun>/lib/node_modules
$out/vendor/seccomp/<arch>/                    Linux only
```

The `node_modules` symlink is what makes `@anthropic-ai/sandbox-runtime`
resolvable, and it points into pi's own install so both share one instance.
`default.nix` drives every phase from the `extensionSources`/`testSources`
lists, so a new module is a one-line addition there.

| Module | Role |
| --- | --- |
| `index.ts` | Entry point. Registers the guards, approval-aware `bash` tool, session events, and `/sandbox`, then installs the bash delegate last. |
| `sandbox.ts` | Sandboxed command wrapping, execution, environment sanitization, and diagnostics. |
| `session.ts` | Serialized sandbox lifecycle, state transitions, project validation, and status. |
| `session-resources.ts` | Session cache/temp creation, TMPDIR redirection and restoration, cleanup. |
| `policy.ts` | `SandboxRuntimeConfig` construction, the network allowlist, the seccomp asset paths substituted by Nix. |
| `project-scan.ts` | Enumerates in-project credential paths for `denyRead`/`denyWrite`. |
| `environment.ts` | The child environment: credential removal and cache redirection. |
| `security.ts` | Host-side lexical guards, manual escalation approval tokens, and the fail-closed bash delegate held on `globalThis`. |
| `secrets.ts` | The lexical patterns — secret paths, secret env names, destructive and credential-dumping commands. Pure. |
| `fs-paths.ts` | realpath/symlink/normalization helpers shared by the guard and the scanner. |
| `errors.ts` | Shared conversion of unknown failures to messages. |

macOS installs dynamic project-secret globs at initialization; Linux re-runs the
literal project-secret scan immediately before every command and supplies the
refreshed read/write denies through `customConfig`.

The registered `bash` tool adds `sandbox_permissions = "require_escalated"`
and `justification` inputs. The security handler asks for confirmation and
attaches a module-private approval symbol after Pi validates the JSON input;
the tool consumes that symbol before selecting local host operations. Protected
bash access requests the same approval automatically, while protected file-tool
access is confirmed in the guard. Missing UI or missing approval fails closed.

Because nothing is bundled, `default.nix` has almost no build step — the work is
in the check phases:

| Phase | What it does |
| --- | --- |
| `buildPhase` | Substitute the seccomp asset paths into `policy.ts`. |
| `checkPhase` | `tsc` against the *real* pi and sandbox-runtime typings; confirm the typechecked sandbox-runtime is the one resolved at run time; `bun test` with `@earendil-works/pi-coding-agent` rewritten to `pi-api.test-shim.ts` in `index.ts`, the only module importing it. |
| `installPhase` | Install `extensionSources`, the manifest, and the `node_modules` symlink. |
| `installCheckPhase` | Load the installed tree through jiti (`load-smoke-test.mjs`). |

`bun` strips types without checking them, which is why the separate `tsc` pass
exists; `pi-api.test-shim.ts` is kept honest by the assignability assertions in
`pi-api.conformance.ts`; and because nothing is bundled, the smoke test is what
catches an unresolvable import before a failed extension load leaves pi running
with no shell guard.

Tests follow the production concerns with shared fixtures in `test-support.ts`;
`checkPhase` runs the whole directory.

`doCheck`/`doInstallCheck` are both on, so all of it runs on a plain
`nix build`. The package is also exposed as `checks.<system>.pi-shell-sandbox`
in the root `flake.nix` — both that and `agents/pi` read it from
`contrib/overlay.nix`, so the module and the check build one derivation, which
is what makes `nix flake check` run the test suite.

⚠️ `contrib/overlay.nix` builds it with `final.callPackage`, so `bun2nix` and
`pi-coding-agent-bun` have to already be in `final`: the contrib overlay must be
applied after `bun2nix` and `pi-nix`. The `pi-nix` checkout itself is a contrib
flake input, pointed at the root flake's copy through
`contrib.inputs.pi-nix.follows`.
