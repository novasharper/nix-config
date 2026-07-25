{
  lib,
  pkgs,
  ...
}:

{
  imports = [
    ./claude.nix
    ./codex.nix
    ./pi
  ];

  options = {
    agents.enable = lib.mkOption {
      type = lib.types.bool;
      default = pkgs.stdenv.isDarwin;
      example = true;
      description = "Whether to enable coding agents.";
    };
  };
}
