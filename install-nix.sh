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
        hash=0a0f8380a581c98bc813e31b6b38ecbca075ef6be2c90b8da6c89766a7cd501d
        path=ml60s224bjsc53jkdjr171kyi8g10kap/nix-2.22.1-x86_64-linux.tar.xz
        system=x86_64-linux
        ;;
    Linux.i?86)
        hash=ce359e545f3758e563d3bbd6668ab1b8028ab73336f4cdb7e29181e9b282c43b
        path=n2dranancfhwiqc4nkc6k89z9aj45ppy/nix-2.22.1-i686-linux.tar.xz
        system=i686-linux
        ;;
    Linux.aarch64)
        hash=3694481327ee34edb8aef1107bb7dd569a604b6707653e36802b9192d576c4df
        path=8s8yqgs5iscyf56qg9cipgbykg9n7yx9/nix-2.22.1-aarch64-linux.tar.xz
        system=aarch64-linux
        ;;
    Linux.armv6l)
        hash=44aaaff746ca9da964f961d916c6d33820468cbfcb6f4323d394409b5b4ee5f6
        path=0l0bxii1r4qn0byqhn4pws0ncjsvgrfv/nix-2.22.1-armv6l-linux.tar.xz
        system=armv6l-linux
        ;;
    Linux.armv7l)
        hash=59f624f7b2375a1acbb8e7bcffc35bdd6e588d374d026d1797deb53784200685
        path=g3bx9fs23c7w2s0v063ik4n0g8mwac1j/nix-2.22.1-armv7l-linux.tar.xz
        system=armv7l-linux
        ;;
    Darwin.x86_64)
        hash=fc7415d8d28b94ff1959c3a670430b0c9804e5dcb281b1a36e8646860397e656
        path=56iy2576f73v5yrcn6l8fqsz51mlf2dr/nix-2.22.1-x86_64-darwin.tar.xz
        system=x86_64-darwin
        ;;
    Darwin.arm64|Darwin.aarch64)
        hash=1cc1cb82e744e853b8d2c6fe075a1048c3600a404b4b8894ae892bf24258ca37
        path=1c4gbsd8kmx2zkd2pasarmkvafcpwvsm/nix-2.22.1-aarch64-darwin.tar.xz
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
    url=https://releases.nixos.org/nix/nix-2.22.1/nix-2.22.1-$system.tar.xz
fi

tarball=$tmpDir/nix-2.22.1-$system.tar.xz

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

echo "downloading Nix 2.22.1 binary tarball for $system from '$url' to '$tmpDir'..."
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
