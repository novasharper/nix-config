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
      dotDir = "${config.xdg.configHome}/zsh";
      enableCompletion = true;
      enableVteIntegration = true;
      historySubstringSearch.enable = true;
      initContent = lib.mkOrder 1000 shellCommon.initExtra;
      oh-my-zsh = {
        enable = true;
        theme = "ys";
      };
      profileExtra = profileExtra;
      syntaxHighlighting.enable = true;
    };

    bash = enable {
      bashrcExtra = profileExtra;
      enableVteIntegration = true;
      initExtra = ''
        if [ -f /etc/bashrc ] ; then
          . /etc/bashrc
        fi

        ${shellCommon.initExtra}
      '';
    };
  };
}
