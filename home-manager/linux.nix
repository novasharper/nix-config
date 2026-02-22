{ config
, pkgs
, lib
, fetchFromGitHub
, nixVersion
, ...
}:

let
  nixgl = import ./nixgl-package.nix { inherit config pkgs lib; };
  enable = x: x // { enable = true; };

in
{
  targets.genericLinux.enable = true;

  home.packages = with pkgs; [
    gimp
    makemkv
    mypaint
    ncdu
    # (nixgl.wrap celluloid)
    (nixgl.wrap cemu)
    (nixgl.wrap obs-studio)
    # (nixgl.wrap vlc)
  ];

  programs =
    {
      mpv = enable {
        config = {
          script-opts = with lib.strings; concatStringsSep "," [
            "ytdl_hook-ytdl_path=${lib.getExe pkgs.yt-dlp}"
          ];
          gpu-api = "opengl";
          hwdec = "no";
        };
        package =
          let
            inhibit-gnome = import ./contrib/inhibit-gnome.nix {
              inherit lib fetchFromGitHub;
              inherit (pkgs) dbus mpv-unwrapped pkg-config stdenv;
            };

          in
          nixgl.wrap (
            pkgs.mpv.override {
              scripts = [ inhibit-gnome ];
            }
          );
      };
    };

  xdg = {
    enable = true;
    mime.enable = true;
    systemDirs.data = [
      "$HOME/.home-manager-share"
      "$HOME/.local/share"
    ];
  };
}
