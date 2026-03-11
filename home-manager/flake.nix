{
  description = "Darwin configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";

    home-manager = {
      url = "github:nix-community/home-manager";
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
    inputs@{ self
    , nixpkgs
    , flake-utils
    , home-manager
    , ...
    }:
    let
      inherit (self) outputs;
      # Temp measure until cache for it is built
      disableNodejsTesting =
        final: prev:
        {
          nodejs_22 = prev.nodejs_22.overrideAttrs { doCheck = false; };
          nodejs-slim_22 = prev.nodejs-slim_22.overrideAttrs { doCheck = false; };
        };

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
            disableNodejsTesting
          ];
        };
      in
      {
        legacyPackages = {
          homeConfigurations = {
            pllong = home-manager.lib.homeManagerConfiguration {
              inherit pkgs;
              modules = [
                ./home.nix
              ];
              extraSpecialArgs = {
                inherit inputs outputs pkgs;
                nixVersion = "unstable";
              };
            };
          };
        };
      }
    );
}
