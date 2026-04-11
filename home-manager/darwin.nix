{
  config,
  pkgs,
  lib,
  nixVersion,
  ...
}:

let
  stdenv = pkgs.stdenv;
  enable = x: x // { enable = true; };

in
{
  home.packages = with pkgs; [
    ffmpeg
    gnupg
    # TODO: Broken
    #keepassxc
    libreoffice-bin
    ncdu
    wget
  ];

  programs = {
    mpv = enable {
      config = {
        script-opts =
          with lib.strings;
          concatStringsSep "," [
            "ytdl_hook-ytdl_path=${lib.getExe pkgs.yt-dlp}"
          ];
      };
    };

    claude-code = {
      enable = true;
      commands = {
        session-info = ''
          ---
          description: Show Claude Code session info for the current project
          allowed-tools: Bash
          ---
          Run `${./contrib/claude-session-info.py}` and output the result verbatim to the user. Do not summarize, truncate, reformat, or omit any part of the output.
        '';
      };
      settings = {
        autoMemoryEnabled = true;
        sandbox = {
          enabled = true;
        };
        permissions = {
          defaultMode = "default";
          disableBypassPermissionsMode = "disable";
        };
        includeCoAuthoredBy = false;
        statusLine = {
          type = "command";
          command = ./contrib/claude-session-info.py;
        };
      };
    };
  };

  # Workaround for https://github.com/NixOS/nixpkgs/issues/488689
  nixpkgs.overlays = [
    (final: prev: {
      inetutils = prev.inetutils.overrideAttrs (old: {
        env = (old.env or { }) // {
          NIX_CFLAGS_COMPILE = toString [
            (old.env.NIX_CFLAGS_COMPILE or "")
            "-Wno-format-security"
          ];
        };
      });
    })
  ];
}
