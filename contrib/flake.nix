{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    # Source of pi's bun.lock and pinned revision, read by pi-shell-sandbox.
    # The consumer should point this at its own pi-nix so both resolve to one
    # checkout.
    pi-nix.url = "github:lukasl-dev/pi.nix";
  };

  outputs =
    { pi-nix, ... }:
    {
      overlays.default = import ./overlay.nix { inherit pi-nix; };

      # Home Manager modules for programs with no upstream module.
      homeModules = {
        default = ./home-manager;
        goose-cli = ./home-manager/goose.nix;
      };
    };
}
