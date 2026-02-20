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
            if [[ $_nix_version == unstable ]] ; then
              _nix_channel=nixpkgs-unstable
              _home_mgr_channel=master.tar.gz
            else
              _nix_channel=nixpkgs-$_nix_version-darwin
              _home_mgr_channel=release-$_nix_version.tar.gz
            fi
            nix-channel --add https://nixos.org/channels/$_nix_channel nixpkgs
            nix-channel --add https://github.com/nix-community/home-manager/archive/$_home_mgr_channel home-manager
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
          if ! nix-env -iA nixpkgs.nixVersions.latest 2> /dev/null ; then
            echo "Failed... Retrying"
            sudo launchctl kickstart system/org.nixos.nix-daemon
            echo "Installing latest nix"
            nix-env -iA nixpkgs.nixVersions.latest
          fi
        '';
      };
      ".local/bin/update-home" = {
        executable = true;
        text = ''
          #!/usr/bin/env bash
          set -e
          nix flake update --flake ~/.config/home-manager
          home-manager switch --flake ~/.config/home-manager#pllong
        '';
      };
    };
  };

  # Workaround for https://github.com/NixOS/nixpkgs/issues/488689
  nixpkgs.overlays = [
    (final: prev: {
      inetutils = prev.inetutils.overrideAttrs (
        old: {
          env = (old.env or {}) // {
            NIX_CFLAGS_COMPILE = toString [
              (old.env.NIX_CFLAGS_COMPILE or "")
              "-Wno-format-security"
            ];
          };
        }
      );
    })
  ];
}
