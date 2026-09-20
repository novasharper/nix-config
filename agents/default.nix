{
  lib,
  pkgs,
  ...
}:

{
  imports = [
    ./claude.nix
    ./codex.nix
    ./goose.nix
    ./opencode.nix
  ];

  options = {
    agents.enable = lib.mkOption {
      type = lib.types.bool;
      default = pkgs.stdenv.hostPlatform.isDarwin;
      example = true;
      description = "Whether to enable coding agents.";
    };
  };
}
