# Shell sandbox security review conclusions

The initial patch built and its tests passed, but the new deny-list scanner had
several fail-open cases that left intended credential paths readable. All four
findings below are now covered by fixes and regression tests.

The locations below point to the current implementation of each fix.

> **Validation status.** All four conclusions hold and are fixed. Verdicts were
> reached with unit regressions, real policies executed under Seatbelt on
> `aarch64-darwin`, and the real Linux wrapper generator. The generated Linux
> command was inspected but not executed under Bubblewrap.
>
> | Conclusion | Verdict | Action |
> | --- | --- | --- |
> | Resolve secret-bearing file symlinks | **Valid** — reproduced | fixed |
> | Refresh Linux denies for nested secrets | **Valid** | fixed |
> | Fail closed when enumeration fails | **Valid** (Linux only) | fixed |
> | Complete the macOS suffix fallback | **Valid** — reproduced | fixed |

## P1: Resolve secret-bearing file symlinks during the scan

Location: [`project-scan.ts`](project-scan.ts) → `secretPathsForEntry`

In the initial patch, an innocuously named file symlink such as
`config -> ../.env` was not denied. `accessesSecret(relativePath)` returned
false for `config`, and the scanner recorded neither the link nor its resolved
target. A model could consequently run
`cat config`, or invoke a checked-in helper that reads it, without triggering
the lexical guard. Sandbox Runtime permits the read because its filesystem
policy is deny-list based.

Resolve and classify file symlinks as well as directory symlinks, denying the
link whenever its resolved target is secret-bearing.

See [`UPSTREAM.md` §2.2](../../agents/pi/UPSTREAM.md#22-filesystem-policy-semantics).

### Validation: valid, reproduced — fixed

The original invalid verdict tested `config -> .env` inside the project, where
the target was already denied. It did not test the reported escaping case.
Measured with `config -> ../.env`:

```
READABLE  config        # lexical guard allowed it; Seatbelt returned the secret
BLOCKED   ../.env       # the lexical guard recognized the direct spelling
```

That is a privilege gain: the deny-only runtime permits the outside target,
while the innocuous link bypasses the layer that would block its real name. The
Linux wrapper generator likewise emitted no deny mount for either unlisted
spelling.

Fixed in `existingProjectSecretPaths`: every file or directory symlink is
resolved, its target is classified with the same secret matcher, and both the
link and target enter the deny policy. Broken links retain their resolved
lexical target so macOS protects a target created later; Linux's per-command
refresh resolves it once it exists. Covered by `project secret scan denies an
innocuous file symlink and its secret target`, and re-measured as blocked under
Seatbelt.

## P1: Refresh Linux denies when nested secrets appear

Location: [`policy.ts`](policy.ts) → `linuxCommandFilesystemConfig`,
`commandSandboxConfig`

In the initial patch, Linux project secrets were enumerated only at session
startup. If a later `git checkout`, build, or other process created
`nested/.env`, that path was absent from the sandbox configuration. A benignly
named script could then read it. Linux requires each denied path to be literal,
and Sandbox Runtime's
per-command mandatory scan does not search for credentials or backstop
`denyRead`.

Refresh the literal Linux deny set when project contents change, or provide an
equivalent enforcement mechanism that covers secrets created after
`session_start`.

See [`UPSTREAM.md` §2.3](../../agents/pi/UPSTREAM.md#23-globs-work-on-macos-only) and
[`UPSTREAM.md` §2.4](../../agents/pi/UPSTREAM.md#24-mandatory-deny-scan).

### Validation: valid — fixed

The original mechanism reproduced with a policy built before `nested/.env`
existed: a checked-in helper returned the late-created secret, and the real
Linux wrapper generator emitted no mount for it. The per-command ripgrep pass
covers rc files in `denyWrite` and is not a credential scan (`UPSTREAM.md`
§2.4).

The platform scoping is right too. On macOS the same scenario is already
covered, because the profile carries glob patterns that Seatbelt evaluates at
access time. Measured against a policy built from an *empty* project, with the
files created afterwards:

```
BLOCKED   nested/.env
BLOCKED   nested/.npmrc
BLOCKED   node_modules/pkg/.npmrc
```

Fixed by building a per-command filesystem overlay on Linux immediately before
`wrapWithSandbox`. `commandSandboxConfig` runs
`existingProjectSecretPaths(project, 50_000, false)`, preserves every stored
restriction, adds newly discovered paths to both `denyRead` and `denyWrite`, and
passes the result through `customConfig`. A scan or configuration failure is
handled by the existing command-refusal path. macOS keeps its dynamic globs and
does not pay for another walk.

Covered by `Linux command policy refreshes secrets created after
initialization`, which builds the first policy without a nested `.env`, creates
the file, and confirms the next command policy contains it in both deny lists.
The Linux wrapper generator was also checked to emit the new literal mount;
execution under Bubblewrap remains outstanding.

## P1: Fail closed when a directory cannot be enumerated

Location: [`project-scan.ts`](project-scan.ts) → `readDirectoryOrFail`

On Linux, a directory can forbid listing while still allowing known files to be
opened. For example, a mode-`0111` directory can contain a world-readable
nested `.env`. The initial scanner swallowed `readdirSync` errors, omitted that
subtree from `denyRead`, and left the credential readable because Linux has no
glob fallback.

Abort initialization when enumeration fails and no complete fallback exists.
Skipped paths must not remain readable under an allow-by-default read policy.

See [`UPSTREAM.md` §2.2](../../agents/pi/UPSTREAM.md#22-filesystem-policy-semantics) and
[`UPSTREAM.md` §2.3](../../agents/pi/UPSTREAM.md#23-globs-work-on-macos-only).

### Validation: valid on Linux — fixed

The mechanism is real. Measured with a mode-`0111` directory holding a `.env`,
the scan does miss it:

```
BLOCKED   opaque/.env   # lexically secret: true, found by the scan: FALSE
```

It reads as blocked only because this ran on macOS, where `**/.env` covers the
subtree the walk could not enter. Without that fallback the miss is the whole
story, and the file stays readable — which is exactly the partial deny-read
policy the directory cap already refuses to start with.

Fixed in `readDirectoryOrFail`: a `readdirSync` failure is now swallowed only
when `hasCompleteGlobFallback`, and otherwise throws with the offending
directory named. Covered by `project secret scan fails closed on an unlistable
directory`, which asserts both halves.

The trade-off is deliberate: on Linux, a project containing a directory pi
cannot list will now refuse to start rather than start with a hole. That is the
same stance as the cap, and the error names the directory so it is actionable.

## P1: Complete the macOS fallback for suffix-style secrets

Location: [`secrets.ts`](secrets.ts) → `projectSecretPathGlobBases`

The initial macOS glob fallback did not cover every name recognized by
`accessesSecret`. Names such as `.credentials.yaml` and `config.credentials`
were sensitive according to the lexical regex, but the fallback covered only
`credentials.*` and the single `.credentials.json` spelling. A matching file
created after startup, or located below a generated or capped subtree, never
entered `denyRead` and remained readable under the allow-by-default policy.

Derive the fallback from the same patterns used by `accessesSecret`, or add all
missing suffix forms so the scanner and fallback classify the same paths.

See [`UPSTREAM.md` §2.2](../../agents/pi/UPSTREAM.md#22-filesystem-policy-semantics) and
[`UPSTREAM.md` §2.3](../../agents/pi/UPSTREAM.md#23-globs-work-on-macos-only).

### Validation: valid, reproduced — fixed

Measured against a policy built from an empty project, with the files created
afterwards:

```
READABLE  .credentials.yaml
READABLE  config.credentials
READABLE  app.secret
READABLE  .credentials
```

Fixed by extending `projectSecretPathGlobBases` to every shape the `secretWord`
rule matches — bare, dot-prefixed, and suffixed, each with and without a further
extension — for all three of `credentials`, `secret`, `secrets`. Re-measured:

```
BLOCKED   .credentials.yaml
BLOCKED   config.credentials
BLOCKED   app.secret
BLOCKED   .credentials
```

"Derive the fallback from the same patterns" is not literally possible — the
matcher is a regex over an arbitrary command string and globs cannot express it
— so `macOS glob fallback covers all secret-word filename shapes` generates the
cross-product of all three secret words with bare, dot-prefixed, suffixed, and
further-extension forms. It also checks representative ordinary names remain
allowed. The broader matrix was mutation-tested by removing
`**/*.secrets.*`; the test now fails for `config.secrets.yaml`.

### Incidental finding

Writing that test surfaced something worth recording: `accessesSecret` does
**not** match the bare words `credentials`, `secret`, or `secrets`. That is
deliberate — the matcher requires an adjacent separator or dot so that
`git commit -m "add secret rotation"` and `rg credentials src/` keep working —
but it means a project-root file named exactly `credentials` is invisible to the
walk. It is not a hole: such paths reach `denyRead` through
`fixedSecretRelativePaths` and through `**/credentials`. The
test now pins that reasoning so the carve-out is not mistaken for a bug later.

## Reproducing these measurements

The scanner and policy-construction regressions are permanent unit tests. The
real Seatbelt checks use a temporary harness: build a policy with
`sandboxConfig`, hand it to `SandboxManager.updateConfig`, wrap a benign helper
with `SandboxManager.wrapWithSandbox`, and execute the result. Passing an empty
`allowedDomains` avoids starting proxies while retaining the filesystem policy.

The Linux checks call the real `wrapCommandWithSandboxLinux` generator and
inspect its Bubblewrap arguments. An equivalent execution on a Linux host is
still outstanding.
