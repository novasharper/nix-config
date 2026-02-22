{
  description = "Darwin configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/release-25.11";
    flake-utils.url = "github:numtide/flake-utils";

    home-manager = {
      url = "github:nix-community/home-manager/release-25.11";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    fenix = {
      url = "github:nix-community/fenix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixgl = {
      url = "github:nix-community/nixgl";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{
      self,
      nixpkgs,
      flake-utils,
      home-manager,
      ...
    }:
    let
      inherit (self) outputs;
    
    in
      flake-utils.lib.eachDefaultSystem (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            config = {
              allowUnfree = true;
              allowUnfreePredicate = (_: true);
            };
            overlays = [
              inputs.fenix.overlays.default
              inputs.nixgl.overlay
            ];
          };
        in {
          legacyPackages = {
            homeConfigurations = {
              pllong = home-manager.lib.homeManagerConfiguration {
                inherit pkgs;
                modules = [
                  ./home.nix
                ];
                extraSpecialArgs = {
                  inherit inputs outputs pkgs;
                  nixVersion = "25.11";
                };
              };
            };
          };
        }
      );
}
