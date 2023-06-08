{ config, pkgs, lib, ... }:

let
  enable = x: x // { enable = true; };
  shellCommon = import ./shell-common.nix;

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
      envExtra = shellCommon.envExtra;
      initExtra = shellCommon.initExtra;
    };

    bash = enable {
      enableVteIntegration = true;
      bashrcExtra = shellCommon.envExtra;
      initExtra = ''
        if [ -f /etc/bashrc ] ; then
          . /etc/bashrc
        fi

        ${shellCommon.initExtra}
      '';
    };
  };
}
