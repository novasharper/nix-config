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
        hash=a21fde5116b1f28ef4990cc9fdb2b5002cff43bbd85171e199f2e72b7fc0b9fa
        path=3qvkvw4i2x9lvqkf2w7bjzxp4z139353/nix-2.31.4-x86_64-linux.tar.xz
        system=x86_64-linux
        ;;
    Linux.i?86)
        hash=e2b565f0d67e68b46651f44ddc1de32fa63ad37881e740785b7e32aad6557fc2
        path=lngvzdmip6wasdv99fswjiqf86xdchkz/nix-2.31.4-i686-linux.tar.xz
        system=i686-linux
        ;;
    Linux.aarch64)
        hash=3fdef0c5638853dc78136d27583984e42d16d5e9c1d9569eb0fbec8aed966daf
        path=fnxxy2h6phlcxp9fl716sn1br1y4p4n6/nix-2.31.4-aarch64-linux.tar.xz
        system=aarch64-linux
        ;;
    Linux.armv6l)
        hash=ad543e6df71ee39081d4c9510198ca1d833199f51466a7e939f4284c23484c01
        path=fdyynp1705ig6k4zkcjy52vgn26hqcyg/nix-2.31.4-armv6l-linux.tar.xz
        system=armv6l-linux
        ;;
    Linux.armv7l)
        hash=4c41f8e1221060cca4d26c16a06e80dca0b7647aa28172391d404a359744dd27
        path=ps3hdyzb0gfjyqmi3kx9q4x66czmb53w/nix-2.31.4-armv7l-linux.tar.xz
        system=armv7l-linux
        ;;
    Linux.riscv64)
        hash=9799a2eb68ab43a18ef6b1f65bf9f2a5ed069447ca0c79e3ab4746159b5e049b
        path=y10avswf4pvjcn99b078416v92ng0mxa/nix-2.31.4-riscv64-linux.tar.xz
        system=riscv64-linux
        ;;
    Darwin.x86_64)
        hash=e06a1e30b05c707f5c554d213eb60b3282521998d1656d3e05868ff2abc870f6
        path=rx0d62d1q7pc0wb4vnzask7rzlm4w1jd/nix-2.31.4-x86_64-darwin.tar.xz
        system=x86_64-darwin
        ;;
    Darwin.arm64|Darwin.aarch64)
        hash=f023e8ed587cfd17809e6825aa46520f99b8e3c8c5c6faf3e308f84a839e2e13
        path=211dncqs1w8rc67nsb52lqsfgqacc1rd/nix-2.31.4-aarch64-darwin.tar.xz
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
    url=https://releases.nixos.org/nix/nix-2.31.4/nix-2.31.4-$system.tar.xz
fi

tarball=$tmpDir/nix-2.31.4-$system.tar.xz

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

echo "downloading Nix 2.31.4 binary tarball for $system from '$url' to '$tmpDir'..."
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
