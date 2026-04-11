#!/bin/bash

NIX_VERSION=$(nix eval --raw 'github:NixOS/nixpkgs/nixpkgs-unstable#nix.version')
curl --proto '=https' --tlsv1.2 -Lo install-nix.sh "https://releases.nixos.org/nix/nix-${NIX_VERSION}/install"