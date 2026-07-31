{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { ... }:
    {
      overlays.default = import ./overlay.nix;

      # Home Manager modules for programs with no upstream module.
      homeModules = {
        default = ./home-manager;
        goose-cli = ./home-manager/goose.nix;
      };
    };
}
