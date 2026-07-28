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

  tmuxPlugins = prev.tmuxPlugins // {
    catppuccin = final.tmuxPlugins.mkTmuxPlugin rec {
      pluginName = "catppuccin";
      version = "2.3.0";
      src = final.fetchFromGitHub {
        owner = "catppuccin";
        repo = "tmux";
        rev = "v${version}";
        sha256 = "3CJRQCgS8NAN7vOLBjNGiHbGXTIrIyY/FLmfZrXcEYc=";
      };
      postInstall = ''
        sed -i -e 's|''${PLUGIN_DIR}/catppuccin-selected-theme.tmuxtheme|''${TMUX_TMPDIR}/catppuccin-selected-theme.tmuxtheme|g' $target/catppuccin.tmux
      '';
      meta = {
        homepage = "https://github.com/catppuccin/tmux";
        description = "Soothing pastel theme for Tmux";
        license = final.lib.licenses.mit;
        platforms = final.lib.platforms.unix;
        maintainers = [ ];
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
