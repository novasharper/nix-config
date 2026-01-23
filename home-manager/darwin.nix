{ config, pkgs, lib, ... }:

{
  home = {
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
          if ! sudo launchctl kickstart -k system/org.nixos.nix-daemon ; then
            echo "Failed... Retrying"
            sudo launchctl kickstart system/org.nixos.nix-daemon
          fi

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