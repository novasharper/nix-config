# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a [home-manager](https://github.com/nix-community/home-manager) flake-based Nix configuration for the user `pllong`. It manages a cross-platform dotfiles/environment across macOS (Darwin) and Linux using Nix flakes.

The repo is symlinked into place: `~/.config/home-manager` → `./home-manager/` and `~/.config/nixpkgs` → `./nixpkgs/`.

## Key Commands

**Apply configuration changes:**
```bash
home-manager switch
```

**Update all flake inputs and apply:**
```bash
update-home   # managed script in ~/.local/bin/: flake update + nix upgrade-nix + home-manager switch
```

**Update flake lock file only:**
```bash
nix flake update --flake ~/.config/home-manager
```

**Initial bootstrap on a new machine:**
```bash
./init.sh
```

**Format Nix files:**
```bash
nixpkgs-fmt <file.nix>
```

**Check/evaluate config without switching:**
```bash
nix eval .#legacyPackages.$(nix eval --impure --expr 'builtins.currentSystem').homeConfigurations.pllong.activationPackage
```

**Garbage collect old generations:**
```bash
home-generations-gc   # expires generations older than 7 days and runs nix-store --gc
```

## Architecture

### `home-manager/flake.nix`
The flake entry point. Defines inputs (nixpkgs-unstable, home-manager, flake-utils, nix-vscode-extensions, fenix for Rust toolchains, nixgl for Linux GPU support) and exposes a single home configuration for `pllong` via `legacyPackages.<system>.homeConfigurations.pllong`.

### `home-manager/home.nix`
The root home-manager module. Sets up packages, shell aliases, session variables, managed scripts in `~/.local/bin/`, and imports platform-specific modules:
- Always imported: `git.nix`, `shells.nix`, `vim.nix`
- Linux only: `linux.nix`
- Darwin only: `darwin.nix`
- Optional local overrides: `~/.config/nix-local/default.nix` (not in repo)

Notable packages: Python 3.14, Rust via `fenix.stable.completeToolchain`, Raspberry Pi Pico tools (`pico-sdk`, `probe-rs-tools`), beancount/fava for accounting.

Programs configured here (beyond imports): `dircolors`, `gemini-cli`, `gh` (GitHub CLI), `go`, `home-manager`, `tmux`, `vscode` (VSCodium), `yt-dlp`.

Managed scripts in `~/.local/bin/`: `home-generations`, `home-generations-gc`, `update-channel`, `update-home` (flake update + nix upgrade-nix + home-manager switch).

### Platform modules
- **`darwin.nix`** — macOS-specific packages (ffmpeg, gnupg, libreoffice-bin, ncdu, wget) and programs (mpv, claude-code with session-info slash command + sandbox/statusLine settings, inetutils overlay workaround)
- **`linux.nix`** — Linux-specific packages, nixGL GPU detection for OpenGL wrapping, XDG MIME setup
- **`shells.nix`** — Configures zsh (oh-my-zsh with `ys` theme, syntax highlighting, history substring search) and bash; sources `shell-common.nix`
- **`shell-common.nix`** — Shared shell functions (git helpers `glm`/`glm1`, kubernetes helpers, `msh`/`tsh` for mosh+tmux sessions)
- **`git.nix`** — Git configuration and global ignores
- **`vim.nix`** — Vim with ALE linter, lightline, NERDTree, rust-vim, vim-polyglot

### `home-manager/contrib/`
Local derivations and scripts:
- `inhibit-gnome.nix` — mpv plugin for Linux GNOME idle inhibition
- `claude-session-info.py` — Python script used as the Claude Code statusLine command and `/session-info` slash command

### `nixpkgs/config.nix`
Legacy nixpkgs config (`allowUnfree = true`). Retained for compatibility; flake config is the primary configuration path.

## Conventions

- The helper `enable = x: x // { enable = true; };` is used throughout to enable home-manager programs concisely.
- `nixVersion` is passed as `extraSpecialArgs` and used to construct channel names/URLs. Currently set to `"unstable"`.
- VSCode is configured as VSCodium (`pkgs.vscodium`) with `mutableExtensionsDir = false` — all extensions must be declared in `home.nix`.
- Rust toolchain comes from `fenix.stable.completeToolchain` rather than nixpkgs.
