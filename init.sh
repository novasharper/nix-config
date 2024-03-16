#!/bin/bash
set -e

CURRENT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
unset LD_LIBRARY_PATH

case "$OSTYPE" in
    darwin*)
        os=macos
        ;;
    linux-gnu*)
        os=linux
        ;;
esac

if ! command -v nix-env &>/dev/null ; then
    echo "Installing NIX"
    sh ./install-nix.sh --no-channel-add
    # Ensure that nix is loaded
    if [[ "$os" == "macos" ]] ; then
        source /nix/var/nix/profiles/default/etc/profile.d/nix.sh
    else
        source $HOME/.nix-profile/etc/profile.d/nix.sh
    fi
fi

NIXPKGS_VERSION=$(cat $CURRENT_DIR/nixpkgs/VERSION)
if [[ "$os" == "macos" ]] ; then
    NIXPKGS_CHANNEL=nixpkgs-$NIXPKGS_VERSION-darwin
else
    NIXPKGS_CHANNEL=nixos-$NIXPKGS_VERSION
fi
echo "Configuring nix to use the $NIXPKGS_VERSION channel"
nix-channel --add https://nixos.org/channels/$NIXPKGS_CHANNEL nixpkgs
nix-channel --add https://github.com/guibou/nixGL/archive/main.tar.gz nixgl
nix-channel --add https://github.com/nix-community/home-manager/archive/release-$NIXPKGS_VERSION.tar.gz home-manager
nix-channel --update

if [[ ! -d ~/.config ]] ; then
    echo "Creating XDG_CONFIG_DIR"
    mkdir ~/.config
fi

if [[ ! -d ~/.config/nixpkgs ]] ; then
    echo "Linking in nix config"
    ln -s $CURRENT_DIR/nixpkgs ~/.config
fi

if [[ ! -d ~/.config/home-manager ]] ; then
    echo "Linking in user environment config"
    ln -s $CURRENT_DIR/home-manager ~/.config
fi

echo "Initializing/updating user environment"
NIX_PATH="$HOME/.nix-defexpr/channels:/nix/var/nix/profiles/per-user/$USER/channels${NIX_PATH:+:$NIX_PATH}"
export NIX_PATH
nix-shell -p home-manager --run 'home-manager switch'
