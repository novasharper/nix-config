{
  description = "Darwin configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    # Coding Agents
    claude-code = {
      url = "github:sadjow/claude-code-nix";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };
    codex-cli = {
      url = "github:sadjow/codex-cli-nix";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };
    pi-nix = {
      url = "github:lukasl-dev/pi.nix";
      inputs.bun2nix.follows = "bun2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Nix Community
    bun2nix = {
      url = "github:nix-community/bun2nix?ref=2.1.0";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nix-vscode-extensions = {
      url = "github:nix-community/nix-vscode-extensions";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixgl = {
      url = "github:nix-community/nixgl";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixvim.url = "github:nix-community/nixvim";

    # Local
    contrib = {
      url = ./contrib;
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.pi-nix.follows = "pi-nix";
      inputs.bun2nix.follows = "bun2nix";
      inputs.flake-utils.follows = "flake-utils";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      home-manager,
      ...
    }@inputs:
    let
      inherit (self) outputs;
    in
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = import ./nixpkgs-config.nix;
          overlays = [
            inputs.claude-code.overlays.default
            inputs.codex-cli.overlays.default
            inputs.fenix.overlays.default
            inputs.nixgl.overlay
            inputs.nix-vscode-extensions.overlays.default
            inputs.bun2nix.overlays.default
            inputs.pi-nix.overlays.default
            # Last: contrib's pi-shell-sandbox resolves bun2nix and
            # pi-coding-agent-bun out of the overlays above.
            inputs.contrib.overlays.default
          ];
        };
      in
      {
        formatter = pkgs.nixfmt-tree;

        legacyPackages = {
          homeConfigurations = {
            pllong = home-manager.lib.homeManagerConfiguration {
              inherit pkgs;
              modules = [
                inputs.contrib.homeModules.default
                inputs.nixvim.homeModules.nixvim
                inputs.pi-nix.homeModules.default
                ./home.nix
              ];
              extraSpecialArgs = {
                inherit
                  inputs
                  self
                  outputs
                  pkgs
                  ;
                nixVersion = "unstable";
              };
            };
          };
        };
      }
    );
}
