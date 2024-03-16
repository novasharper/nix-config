{ config, pkgs, lib, ... }:

{
  home = {
    activation = {
      linkDesktopApplications = {
        after = [
          "writeBoundary"
          "createXdgUserDirectories"
        ];
        before = [ ];
        data = ''
          rm -rf $HOME/.home-manager-share
          mkdir -p $HOME/.home-manager-share
          cp -Lr --no-preserve=mode,ownership ${config.home.homeDirectory}/.nix-profile/share/* $HOME/.home-manager-share
        '';
      };
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
            _nix_channel=nixos-$_nix_version
            nix-channel --add https://nixos.org/channels/$_nix_channel nixpkgs
            nix-channel --add https://github.com/nix-community/home-manager/archive/release-$_nix_version.tar.gz home-manager
          fi

          echo "Updating channel" && nix-channel --update
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
          update-desktop-database
        '';
      };
    };
  };

  targets.genericLinux.enable = true;

  xdg = {
    enable = true;
    mime.enable = true;
    systemDirs.data = [
      "$HOME/.home-manager-share"
      "$HOME/.local/share"
    ];
  };
}