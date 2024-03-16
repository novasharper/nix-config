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
            rm -rf "$baseDir"
          fi
          mkdir -p "$baseDir"
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
          fi

          echo "Updating channel" && nix-channel --update
          sudo -i sh -c '
            echo "Stopping nix daemon" && launchctl remove org.nixos.nix-daemon &&
            echo "Sleeping for 5 seconds" && sleep 5 &&
            echo "Starting nix daemon" && launchctl load /Library/LaunchDaemons/org.nixos.nix-daemon.plist
          '
          echo "Installing latest nix" && nix-env -iA nixpkgs.nix
          echo "Installing synced home-manager" && nix-env -iA home-manager.home-manager
        '';
      };
      ".local/bin/update-home" = {
        executable = true;
        text = ''
          #!/usr/bin/env nix-shell
          #!nix-shell -i bash -p home-manager
          set -e
          home-manager switch "$@"
        '';
      };
    };
  };
}