{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    # Source of pi's bun.lock and pinned revision, read by pi-shell-sandbox.
    # The consumer should point this at its own pi-nix so both resolve to one
    # checkout.
    pi-nix = {
      url = "github:lukasl-dev/pi.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    # pi-shell-sandbox's checkPhase uses bun2nix to install pi's deps.
    bun2nix = {
      url = "github:nix-community/bun2nix?ref=2.1.0";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      pi-nix,
      bun2nix,
      ...
    }:
    {
      overlays.default = import ./overlay.nix { inherit pi-nix; };

      # Home Manager modules for programs with no upstream module.
      homeModules = {
        default = ./home-manager;
        goose-cli = ./home-manager/goose.nix;
      };
    }
    // flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [
            bun2nix.overlays.default
            pi-nix.overlays.default
            self.overlays.default
          ];
        };
      in
      {
        # Its checkPhase runs tsc against the real pi and sandbox-runtime
        # typings, the test-shim conformance assertions, and the unit tests;
        # installCheckPhase loads the installed extension through jiti.
        # Exposing it as a check means `nix flake check` from this directory
        # runs the full suite and fails the build on regression.
        checks = {
          pi-shell-sandbox = pkgs.pi-shell-sandbox;
        };
      }
    );
}
