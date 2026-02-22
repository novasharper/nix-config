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
    sh ./install-nix.sh
    # Ensure that nix is loaded
    if [[ "$os" == "macos" ]] ; then
        source /nix/var/nix/profiles/default/etc/profile.d/nix.sh
    else
        source $HOME/.nix-profile/etc/profile.d/nix.sh
    fi
fi

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

if ! command -v home-manager &>/dev/null ; then
    echo "Initializing user environment"
    NIX_PATH="$HOME/.nix-defexpr/channels:$HOME/.local/state/nix/profiles/channels:/nix/var/nix/profiles/per-user/$USER/channels${NIX_PATH:+:$NIX_PATH}"
    export NIX_PATH
    nix --experimental-features 'nix-command flakes' run home-manager/master -- switch
else
    echo "Updating user environment"
    home-manager switch
fi
