{ config, pkgs, lib, ... }:

{
  programs.zsh =
    let shellCommon = import ./shell-common.nix;
    in {
      enable = true;
      enableCompletion = true;
      enableSyntaxHighlighting = true;
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
}
