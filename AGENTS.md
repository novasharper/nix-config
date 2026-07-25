# Repository Guidelines

This repository is a Home Manager flake for user `pllong`. It manages shell tools, editors, agents, and platform-specific settings across macOS (Darwin) and Linux.

## Project Structure & Module Organization

- Root modules are the primary entry points: `flake.nix`, `home.nix`, `darwin.nix`, `linux.nix`, and `shells.nix`.
- `editors/` contains Vim, Neovim, VSCodium, and Zed configuration.
- `agents/` contains Claude and Codex modules.
- `contrib/` provides custom derivations, overlays, and helper programs.
- `scripts/` contains installation and bootstrap scripts.
- `home-manager/` and `nixpkgs/` support configuration paths under `~/.config`.

Keep changes in the narrowest relevant module. Put shared settings in `home.nix` or a focused module; keep OS-specific behavior in `darwin.nix` or `linux.nix`.

## Build, Test, and Development Commands

- `home-manager build` builds the configuration without activating it.
- `home-manager switch --dry-run` previews activation changes.
- `home-manager switch` builds and applies the current configuration.
- `nix eval .#legacyPackages.<system>.homeConfigurations.pllong.activationPackage` checks flake evaluation; replace `<system>` with a target such as `aarch64-darwin`.
- `nix flake update --flake ~/.config/home-manager` updates locked inputs.
- `./scripts/init.sh` bootstraps a new machine.

## Coding Style & Naming Conventions

Use two-space indentation in Nix files and run `nixpkgs-fmt <file.nix>` before submitting changes. Prefer small, composable modules and existing repository patterns. Use `enable = x: x // { enable = true; };` when enabling Home Manager programs, and pass `nixVersion` through `extraSpecialArgs` for channel construction. VSCodium is configured through `pkgs.vscodium`; preserve its immutable extensions setup.

Name new modules descriptively with lowercase, hyphenated filenames where needed. Shell scripts should use clear command names and fail safely.

## Testing Guidelines

There is no automated test suite or coverage requirement. At minimum, format changed Nix files and run an evaluation or `home-manager build`. For activation-sensitive changes, inspect `home-manager switch --dry-run` before applying them. Validate both Darwin and Linux branches when modifying shared logic.

## Commit & Pull Request Guidelines

Use focused commits with subjects in the form `<scope>: <description>`, for example `flake: update inputs` or `packages: remove gemini-cli`. Common scopes include `flake`, `packages`, `shells`, `vim`, `vscode`, `claude`, and `codex`.

Pull requests should explain the configuration change, identify affected platforms, list validation commands, and link relevant issues. Include screenshots only for visible editor or UI changes.
