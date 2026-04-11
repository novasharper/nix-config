let
  disabled = {
    # pkg = {
    #   skipDarwin = true;
    #   skipLinux = true;
    # }
  };

in
final: prev: {
  mkAgentWrapper = import ./agent-wrapper.nix { pkgs = final; };
} // (
  builtins.mapAttrs
    (
      name: value:
        if (value.skipDarwin && prev.stdenv.isDarwin || value.skipLinux && prev.stdenv.isLinux) then
          prev.${name}.overrideAttrs
            (old: {
              doCheck = false;
            })
        else
          prev.${name}
    )
    disabled
)