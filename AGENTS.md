# Repository Guidelines

This is a [home-manager](https://github.com/nix-community/home-manager) flake-based Nix configuration for user `pllong`.
It manages dotfiles and environment across macOS (Darwin) and Linux.

## Project Structure

- **Root Nix files** — Configuration entry points: `flake.nix`, `home.nix`, `darwin.nix`, `linux.nix`, `shells.nix`
- **home-manager/** — Main home-manager flake (symlinked to `~/.config/home-manager`)
- **nixpkgs/** — Legacy nixpkgs config (symlinked to `~/.config/nixpkgs`)
- **scripts/** — Bootstrap and setup scripts (`init.sh`, `install-nix.sh`)
- **contrib/** — Custom derivations and scripts (`claude-session-info.py`, `agent-wrapper.nix`)

## Key Commands

| Command | Description |
|---------|-------------|
| `home-manager switch` | Apply configuration changes |
| `update-home` | Update flakes, upgrade Nix, and switch |
| `nix flake update --flake ~/.config/home-manager` | Update flake lock file |
| `./scripts/init.sh` | Bootstrap on new machine |
| `nixpkgs-fmt <file.nix>` | Format Nix files |

## Coding Style

- Use `enable = x: x // { enable = true; }` to enable home-manager programs
- Pass `nixVersion` as `extraSpecialArgs` for channel construction
- VSCode is configured as VSCodium (`pkgs.vscodium`) with immutable extensions directory
- Format Nix files with `nixpkgs-fmt` before committing
- Follow commit message pattern: `<scope>: <description>` (e.g., `flake: update inputs`)

## Testing & Validation

- No automated tests; validate with `nix eval` or `home-manager build`
- Use `home-manager switch --dry-run` to preview changes
- Check evaluation: `nix eval .#legacyPackages.<system>.homeConfigurations.pllong.activationPackage`

## Commit Guidelines

- Prefix scopes: `flake`, `packages`, `shells`, `vim`, `vscode`, `claude`, `codex`
- Reference issues/PRs in body when applicable
- Keep commits focused; one change per commit when possible
