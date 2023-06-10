{ config, pkgs, lib, ... }:

let
  enable = x: x // { enable = true; };
  shellCommon = import ./shell-common.nix;
  profileExtra = lib.optionalString (config.home.sessionPath != [ ]) ''
    # TODO: Get rid of this after https://github.com/nix-community/home-manager/issues/3324
    #       is addressed
    export PATH="${lib.concatStringsSep ":" config.home.sessionPath}''${PATH:+:}$PATH"
  '';

in
{
  programs = {
    zsh = enable {
      enableCompletion = true;
      enableSyntaxHighlighting = true;
      enableVteIntegration = true;
      historySubstringSearch = {
        enable = true;
      };
      oh-my-zsh = {
        enable = true;
        theme = "ys";
      };
      profileExtra = profileExtra;
      initExtra = shellCommon.initExtra;
    };

    bash = enable {
      enableVteIntegration = true;
      bashrcExtra = profileExtra;
      initExtra = ''
        if [ -f /etc/bashrc ] ; then
          . /etc/bashrc
        fi

        ${shellCommon.initExtra}
      '';
    };
  };
}
