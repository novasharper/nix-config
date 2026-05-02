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
  home = {
    packages = with pkgs; [
      ffmpeg
      gnupg
      # TODO: Broken
      #keepassxc
      libreoffice-bin
      ncdu
      wget
    ];
    shellAliases = {
      dequarantine = "xattr -d com.apple.quarantine";
    }
  };

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
  };
}
