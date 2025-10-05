{ config, pkgs, lib, ... }:

{
  disabledModules = ["targets/darwin/linkapps.nix"]; # to use custom aliasing instead
  home = {
    activation = lib.mkIf pkgs.stdenv.isDarwin {
      copyApplications =
        let
          apps = pkgs.buildEnv {
            name = "home-manager-applications";
            paths = config.home.packages;
            pathsToLink = "/Applications";
          };
        in lib.hm.dag.entryAfter [ "writeBoundary" ] ''
          baseDir="$HOME/Applications/Home Manager Apps"
          if [ -d "$baseDir" ]; then
            $DRY_RUN_CMD rm -rf "$baseDir"
          fi
          $DRY_RUN_CMD mkdir -p "$baseDir"
          for appFile in ${apps}/Applications/*; do
            target="$baseDir/$(basename "$appFile")"
            $DRY_RUN_CMD cp ''${VERBOSE_ARG:+-v} -fHRL "$appFile" "$baseDir"
            $DRY_RUN_CMD chmod ''${VERBOSE_ARG:+-v} -R +w "$target"
          done
        '';
    };
    file = {
      ".local/bin/update-channel" = {
        executable = true;
        text = ''
          #!/usr/bin/env bash
          set -e

          _nix_version_file="$HOME/.config/nixpkgs/VERSION"
          if [ -f $_nix_version_file ] ; then
            _nix_version=$(cat $_nix_version_file)
            _nix_channel=nixpkgs-$_nix_version-darwin
            nix-channel --add https://nixos.org/channels/$_nix_channel nixpkgs
            nix-channel --add https://github.com/nix-community/home-manager/archive/release-$_nix_version.tar.gz home-manager
            nix-channel --add https://github.com/nix-community/fenix/archive/main.tar.gz fenix
          fi

          echo "Updating channel"
          nix-channel --update

          echo "Restarting nix daemon"
          sudo launchctl kickstart -k system/org.nixos.nix-daemon

          echo "Installing latest nix"
          nix-env -iA nixpkgs.nixVersions.latest
        '';
      };
      ".local/bin/update-home" = {
        executable = true;
        text = ''
          #!/usr/bin/env nix-shell
          #!nix-shell <home-manager> -i bash -p home-manager
          set -e
          home-manager switch "$@"
        '';
      };
    };
  };
}