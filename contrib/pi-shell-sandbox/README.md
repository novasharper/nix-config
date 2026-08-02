# Pi Shell Sandbox

`pi-shell-sandbox` is a [Pi](https://github.com/earendil-works/pi) extension
that confines shell commands by default and keeps high-risk operations behind
interactive confirmation. It protects both the model's `bash` tool and
`!`-prefixed user shell commands on macOS and Linux.

The extension is built for this Home Manager configuration. It uses
[`@anthropic-ai/sandbox-runtime`](https://github.com/anthropic-experimental/sandbox-runtime)
with Seatbelt on macOS and Bubblewrap plus seccomp on Linux.

## Quick start

The sandbox is enabled by default. Inside Pi, inspect or change it with:

```text
/sandbox
/sandbox status
/sandbox on
/sandbox off
/sandbox trust
/sandbox untrust
```

The commands have these effects:

| Command | Effect |
| --- | --- |
| `/sandbox` or `/sandbox status` | Show the current project, backend, mode, and restrictions. |
| `/sandbox on` | Enable the full sandbox for this project and session. A remembered trust decision is not removed. |
| `/sandbox off` | Trust this project for the current session while retaining project-only write confinement. |
| `/sandbox trust` | Confirm and remember trust for this exact project across sessions. |
| `/sandbox untrust` | Forget remembered trust and enable the full sandbox. |

`/sandbox trust` requires an interactive UI. Trust applies to one canonical
project path only: it does not automatically include parents, children, or
symlink aliases.

## Modes

| Capability | Sandbox on | Trusted project |
| --- | --- | --- |
| Project files | Credential files denied; ordinary files readable and writable | Unrestricted |
| Files outside the project | Readable except protected credential paths; writes denied | Readable; writes denied by an OS-level project allowlist |
| Provider credentials in the environment | Removed | Available |
| Network | Approved developer-service allowlist | Unrestricted |
| Unix sockets and local port binding | Blocked | Available |
| Destructive commands | Confirmed | Confirmed |
| Environment and credential dumps | Confirmed | Confirmed |
| Explicit host execution | Available after justification and confirmation | Available after justification and confirmation; bypasses write confinement |

Trusted mode is intentionally less restrictive, but it is not a completely
unwrapped shell. The small remaining filesystem policy is necessary because a
shell command can write through arbitrary child programs; a lexical check of
redirection operators cannot enforce the boundary soundly.

If either the full sandbox or the trusted write boundary cannot initialize,
shell execution fails closed.

## Configuration

The Home Manager option controls the startup default:

```nix
agents.pi.shellSandbox.enable = true;
```

Set it to `false` to start projects in trusted mode. The extension remains
loaded, and `/sandbox on` can still enable full confinement.

For one invocation, override the default with an environment variable:

```bash
PI_SHELL_SANDBOX=0 pi  # trusted mode
PI_SHELL_SANDBOX=1 pi  # full sandbox
```

Accepted enabled values are `1`, `on`, `true`, `yes`, and `enforced`. Accepted
trusted values are `0`, `off`, `false`, `no`, and `disabled`, case-insensitively.
An unknown value is reported and fails closed to the enabled sandbox.

Remembered decisions are stored at:

```text
${XDG_STATE_HOME:-~/.local/state}/pi-shell-sandbox/trusted-projects.json
```

The store is written with mode `0600`. A project containing the resolved store
path cannot be remembered as trusted, because a sandboxed command in that
project could otherwise modify its own trust decision.

## Manual host execution

The registered `bash` tool accepts two additional fields:

```text
sandbox_permissions = "require_escalated"
justification = "Why host execution is required"
```

Pi shows the complete command and justification for confirmation. Approval is
bound to that exact command with a private, single-use token; changing the
command or forging the JSON input does not grant host execution. Missing UI,
missing justification, rejected confirmation, or an unavailable guard blocks
the command.

In trusted mode, approved host execution also bypasses the project-only write
boundary. Use it only when an out-of-project write is necessary.

## What remains guarded

Host-side guards run independently of the kernel sandbox. They cover:

- credential paths such as `.env`, SSH/AWS/Git credentials, provider auth
  stores, and keychains;
- credential paths reached through symlinks, shell assignments, or unresolved
  expansion;
- environment dumps such as `env -0`, `env -u PATH`, `printenv`,
  `/bin/bash -c 'env'`, and direct references to known provider variables;
- destructive commands such as recursive removal, forced Git operations,
  disk tools, `sudo`, and remote-script pipelines;
- file-tool writes outside the trusted project.

Interactive use requests confirmation. Non-interactive access fails closed.

## Building and testing

Build the package check for the current platform:

```bash
nix build .#checks.aarch64-darwin.pi-shell-sandbox
nix build .#checks.x86_64-linux.pi-shell-sandbox
```

Use the system matching the machine or a configured remote builder. A package
build performs all of the following:

- TypeScript checking against Pi and Sandbox Runtime's real types;
- the complete unit and security-regression suite;
- runtime dependency consistency checks;
- an installed-extension load smoke test.

The extension is not bundled. Pi loads `index.ts` through jiti, and the Nix
package installs the sibling TypeScript modules unchanged. See
[agents/pi/UPSTREAM.md](https://github.com/novasharper/nix-config/blob/main/agents/pi/UPSTREAM.md)
for the pinned upstream API and runtime behavior on which the implementation
relies.

## Source layout

| File | Responsibility |
| --- | --- |
| `index.ts` | Pi registration, approval-aware `bash` tool, and `/sandbox`. |
| `session.ts` | Runtime lifecycle and enforced/trusted state transitions. |
| `sandbox.ts` | Command wrapping, execution, and diagnostics. |
| `policy.ts` | Network and filesystem policy construction. |
| `security.ts` | Host-side guards and approval tokens. |
| `secrets.ts` | Pure credential, dump, and destructive-command matchers. |
| `project-scan.ts` | Dynamic project credential discovery. |
| `environment.ts` | Credential removal and cache redirection. |
| `mode.ts` | Environment settings and remembered trust. |
| `fs-paths.ts` | Canonical path and symlink resolution. |
| `tests/` | Unit, regression, conformance, and policy-generation tests. |
