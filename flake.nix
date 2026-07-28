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

    # Nix Community
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
                inputs.nixvim.homeModules.nixvim
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
