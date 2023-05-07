{ config, pkgs, lib, ... }:

{
  disabledModules = ["targets/darwin/linkapps.nix"]; # to use custom aliasing instead
  home = {
    activation.aliasApplications =
        lib.mkIf pkgs.stdenv.hostPlatform.isDarwin
        (lib.hm.dag.entryAfter ["writeBoundary"] ''
          app_folder="Home Manager Apps"
          app_path="$(echo ~/Applications)/$app_folder"
          tmp_path="$(mktemp -dt "$app_folder.XXXXXXXXXX")" || exit 1
          # NB: aliasing ".../home-path/Applications" to
          #    "~/Applications/Home Manager Apps" doesn't work (presumably
          #     because the individual apps are symlinked in that directory, not
          #     aliased). So this makes "Home Manager Apps" a normal directory
          #     and then aliases each application into there directly from its
          #     location in the nix store.
          for app in \
            $(find "$newGenPath/home-path/Applications" -type l -exec \
              readlink -f {} \;)
          do
            $DRY_RUN_CMD /usr/bin/osascript \
              -e "tell app \"Finder\"" \
              -e "make new alias file at POSIX file \"$tmp_path\" \
                                      to POSIX file \"$app\"" \
              -e "set name of result to \"$(basename $app)\"" \
              -e "end tell"
          done
          # TODO: Wish this was atomic, but it’s only tossing symlinks
          $DRY_RUN_CMD [ -e "$app_path" ] && rm -r "$app_path"
          $DRY_RUN_CMD mv "$tmp_path" "$app_path"
        '');
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
          fi

          echo "Updating channel" && nix-channel --update
          sudo -i sh -c '
            echo "Stopping nix daemon" && launchctl remove org.nixos.nix-daemon &&
            echo "Sleeping for 5 seconds" && sleep 5 &&
            echo "Starting nix daemon" && launchctl load /Library/LaunchDaemons/org.nixos.nix-daemon.plist
          '
          echo "Installing latest nix" && nix-env -iA nixpkgs.nix
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