{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    {
      overlays.default = import ./overlay.nix {};

      # Home Manager modules for programs with no upstream module.
      homeModules = {
        default = ./home-manager;
        goose-cli = ./home-manager/goose.nix;
      };
    };
}
