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
              _nix_channel=nixos-unstable
              _home_mgr_channel=master.tar.gz
            else
              _nix_channel=nixos-$_nix_version
              _home_mgr_channel=release-$_nix_version.tar.gz
            fi
            nix-channel --add https://nixos.org/channels/$_nix_channel nixpkgs
            nix-channel --add https://github.com/nix-community/home-manager/archive/$_home_mgr_channel home-manager
            nix-channel --add https://github.com/nix-community/fenix/archive/main.tar.gz fenix
          fi

          echo "Updating channel"
          nix-channel --update

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