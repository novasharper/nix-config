{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs =
    { ... }:
    {
      overlays.default = import ./overlay.nix;
    };
}
