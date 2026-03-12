{ self
, config
, pkgs
, lib
, nixVersion
, ...
}:

let
  # nixgl = import ./nixgl-package.nix { inherit config pkgs lib; };
  enable = x: x // { enable = true; };

in
{
  targets.genericLinux = {
    enable = true;
    gpu =
      let
        _modulesFile =
          pkgs.runCommand "impure-loaded-modules-file"
            {
              time = self.lastModified;
              preferLocalBuild = true;
              allowSubstitues = false;
            } "cp /proc/modules $out 2> /dev/null || touch $out";
        _moduleMatch =
          builtins.match
            ".*video [0-9]+ [0-9]+ (([a-z0-9_]+,)+) .*"
            (builtins.readFile _modulesFile);
        videoModules =
          let
            data = lib.optionals
              (_moduleMatch != null)
              (builtins.split "," (builtins.head _moduleMatch));
          in
          builtins.trace "[NixGL] Detected Modules: ${builtins.toString data}" data;
        # i915           = intel module
        # nvidia_modeset = nvidia module
        # amdgpu         = amd module
        intelPresent =
          let
            data = builtins.any (mod: mod == "i915") videoModules;
            strv = if data then "true" else "false";
          in
          builtins.trace "[NixGL] Intel Present: ${strv}" data;
        amdPresent =
          let
            data = builtins.any (mod: mod == "amdgpu") videoModules;
            strv = if data then "true" else "false";
          in builtins.trace "[NixGL] AMD Present: ${strv}" data;
        nvidiaPresent =
          let
            data = builtins.any (mod: mod == "nvidia_modeset") videoModules;
            strv = if data then "true" else "false";
          in
          builtins.trace "[NixGL] NVIDIA Present: ${strv}" data;

      in
      {
        nvidia.enable = nvidiaPresent;
      };
  };

  home.packages = with pkgs; [
    gimp
    makemkv
    mypaint
    ncdu
    # (nixgl.wrap celluloid)
    # cemu
    # obs-studio
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
              inherit lib;
              inherit (pkgs)
                dbus
                fetchFromGitHub
                mpv-unwrapped
                pkg-config
                stdenv;
            };

          in pkgs.mpv.override { scripts = [ inhibit-gnome ]; };
      };
    };

  xdg = {
    enable = true;
    mime.enable = true;
    systemDirs.data = [
      "$HOME/.home-manager-share"
      "$HOME/.local/share"
      "$HOME/.local/share/flatpak/exports/share"
      "/var/lib/flatpak/exports/share"
    ];
  };
}
