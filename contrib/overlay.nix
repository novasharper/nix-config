let
  disabled = {
    # pkg = {
    #   skipDarwin = true;
    #   skipLinux = true;
    # }
  };

in
final: prev:
{
  mkAgentWrapper = import ./agent-wrapper.nix { pkgs = final; };

  vscode-local = {
    ms-vscode.cpptools = final.vscode-utils.buildVscodeMarketplaceExtension {
      mktplcRef = {
        name = "cpptools";
        publisher = "ms-vscode";
        version = "1.30.5";
        sha256 = "ulYBWC42PFeoSuaGu4RpYniW5wGZ+4k7Il/Nsz13ySA=";
      };
    };
  };
}
// (builtins.mapAttrs (
  name: value:
  if (value.skipDarwin && prev.stdenv.isDarwin || value.skipLinux && prev.stdenv.isLinux) then
    prev.${name}.overrideAttrs (old: {
      doCheck = false;
    })
  else
    prev.${name}
) disabled)
