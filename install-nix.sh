#!/bin/sh

# This script installs the Nix package manager on your system by
# downloading a binary distribution and running its installer script
# (which in turn creates and populates /nix).

{ # Prevent execution if this script was only partially downloaded
oops() {
    echo "$0:" "$@" >&2
    exit 1
}

umask 0022

tmpDir="$(mktemp -d -t nix-binary-tarball-unpack.XXXXXXXXXX || \
          oops "Can't create temporary directory for downloading the Nix binary tarball")"
cleanup() {
    rm -rf "$tmpDir"
}
trap cleanup EXIT INT QUIT TERM

require_util() {
    command -v "$1" > /dev/null 2>&1 ||
        oops "you do not have '$1' installed, which I need to $2"
}

case "$(uname -s).$(uname -m)" in
    Linux.x86_64)
        hash=8d9f536c9f795eeb4f875fedf12e597409ff22f5a38ad3708d24101cd152dff7
        path=88zidy38mzr9bpl2drpr59c759cwy5wi/nix-2.30.0-x86_64-linux.tar.xz
        system=x86_64-linux
        ;;
    Linux.i?86)
        hash=0435fd0cdf261aba0e051bd6743cd4d127ebc95ef96a6c1f5ff99b23ac9f0891
        path=83n6qs4ssr3681mas2ykqdrn1fd50i5v/nix-2.30.0-i686-linux.tar.xz
        system=i686-linux
        ;;
    Linux.aarch64)
        hash=d94aed27317293609b0182a6524466cf4e197fa78d9f259af1cea1fe7ce9c1c7
        path=vpfrcww68pylw5d49c6987b7b2p9kqq5/nix-2.30.0-aarch64-linux.tar.xz
        system=aarch64-linux
        ;;
    Linux.armv6l)
        hash=4fb089ca2e100f5bd968ad5e463612abad48f0f342877f65f279d18ae60934fc
        path=6zkv8myz5acnki2wml8grc47xlqmwxcx/nix-2.30.0-armv6l-linux.tar.xz
        system=armv6l-linux
        ;;
    Linux.armv7l)
        hash=89277ad3857d8408d67d21734fb63d8bfd3345fa30cbab48b1eb1e42cacddd9f
        path=q6hj1xlg3vi01icx0f6x989lhdi1gan1/nix-2.30.0-armv7l-linux.tar.xz
        system=armv7l-linux
        ;;
    Linux.riscv64)
        hash=fd3e79827d9125d0f5a732b9baf85ba317408657c3cf25773561bd52ab6e3127
        path=nadcn9hppndh87cjjarmxv40sfw3j7dy/nix-2.30.0-riscv64-linux.tar.xz
        system=riscv64-linux
        ;;
    Darwin.x86_64)
        hash=1772e6e55a4c7616a8702b68b83eb5abcbf26d6277c404030e1f80a8c1820b31
        path=qws7ik36mq6vwrnmvgjy6na81jzyfbnn/nix-2.30.0-x86_64-darwin.tar.xz
        system=x86_64-darwin
        ;;
    Darwin.arm64|Darwin.aarch64)
        hash=611f331e2d54430858f8553c282f42bd9edd608aecc4fe3c417f98bd366d06e2
        path=narx927qrwq6zgsanvkd0hb66lgr7vzc/nix-2.30.0-aarch64-darwin.tar.xz
        system=aarch64-darwin
        ;;
    *) oops "sorry, there is no binary distribution of Nix for your platform";;
esac

# Use this command-line option to fetch the tarballs using nar-serve or Cachix
if [ "${1:-}" = "--tarball-url-prefix" ]; then
    if [ -z "${2:-}" ]; then
        oops "missing argument for --tarball-url-prefix"
    fi
    url=${2}/${path}
    shift 2
else
    url=https://releases.nixos.org/nix/nix-2.30.0/nix-2.30.0-$system.tar.xz
fi

tarball=$tmpDir/nix-2.30.0-$system.tar.xz

require_util tar "unpack the binary tarball"
if [ "$(uname -s)" != "Darwin" ]; then
    require_util xz "unpack the binary tarball"
fi

if command -v curl > /dev/null 2>&1; then
    fetch() { curl --fail -L "$1" -o "$2"; }
elif command -v wget > /dev/null 2>&1; then
    fetch() { wget "$1" -O "$2"; }
else
    oops "you don't have wget or curl installed, which I need to download the binary tarball"
fi

echo "downloading Nix 2.30.0 binary tarball for $system from '$url' to '$tmpDir'..."
fetch "$url" "$tarball" || oops "failed to download '$url'"

if command -v sha256sum > /dev/null 2>&1; then
    hash2="$(sha256sum -b "$tarball" | cut -c1-64)"
elif command -v shasum > /dev/null 2>&1; then
    hash2="$(shasum -a 256 -b "$tarball" | cut -c1-64)"
elif command -v openssl > /dev/null 2>&1; then
    hash2="$(openssl dgst -r -sha256 "$tarball" | cut -c1-64)"
else
    oops "cannot verify the SHA-256 hash of '$url'; you need one of 'shasum', 'sha256sum', or 'openssl'"
fi

if [ "$hash" != "$hash2" ]; then
    oops "SHA-256 hash mismatch in '$url'; expected $hash, got $hash2"
fi

unpack=$tmpDir/unpack
mkdir -p "$unpack"
tar -xJf "$tarball" -C "$unpack" || oops "failed to unpack '$url'"

script=$(echo "$unpack"/*/install)

[ -e "$script" ] || oops "installation script is missing from the binary tarball!"
export INVOKED_FROM_INSTALL_IN=1
"$script" "$@"

} # End of wrapping
