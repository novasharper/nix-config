{ config, pkgs, lib, ... }:

with import <nixpkgs> { };
let
  nixgl = import <nixgl> { };
  guiWrapFactory = nixGLPkg: exeName: (
    pkg: pkgs.runCommandLocal
      "${pkg.name}-nixgui-wrapper"
      {
        inherit (pkg) name meta;
        inherit (pkg.version);
      }
      ''
        mkdir $out
        ln -s ${pkg}/* $out
        rm $out/bin
        mkdir $out/bin
        # nixGL/Home Manager issue; https://github.com/guibou/nixGL/issues/44
        # nixGL/Home Manager issue; https://github.com/guibou/nixGL/issues/114
        # nixGL causes all software ran under it to gain nixGL status; https://github.com/guibou/nixGL/issues/116
        # we wrap packages with nixGL; it customizes LD_LIBRARY_PATH and related
        # envs so that nixpkgs find a compatible OpenGL driver
        nixgl_bin="${lib.getExe' nixGLPkg exeName}"
        # Similar to OpenGL, the executables installed by nix cannot find the GTK modules
        # required by the environment. The workaround is to unset the GTK_MODULES and
        # GTK3_MODULES so that it does not reach for system GTK modules.
        # We also need to modify the GTK_PATH to point to libcanberra-gtk3 installed via Nix
        gtk_path="${lib.getLib pkgs.libcanberra-gtk3}/lib/gtk-3.0"
        for bin in ${pkg}/bin/*; do
          wrapped_bin=$out/bin/$(basename $bin)
          echo "exec env GTK_MODULES= GTK3_MODULES= GTK_PATH=\"$gtk_path\" $nixgl_bin  $bin \"\$@\"" > $wrapped_bin
          chmod +x $wrapped_bin
        done
      ''
  );
  # From https://github.com/guibou/nixGL/blob/main/nixGL.nix
  writeExecutable = { name, text }:
    writeTextFile {
      inherit name text;

      executable = true;
      destination = "/bin/${name}";

      checkPhase = ''
        ${shellcheck}/bin/shellcheck "$out/bin/${name}"
        # Check that all the files listed in the output binary exists
        for i in $(${pcre}/bin/pcregrep  -o0 '/nix/store/.*?/[^ ":]+' $out/bin/${name})
        do
          ls $i > /dev/null || (echo "File $i, referenced in $out/bin/${name} does not exists."; exit -1)
        done
      '';
    };

  # ----
  _modulesFile =
    runCommand "impure-loaded-modules-file"
      {
        time = builtins.currentTime;
        preferLocalBuild = true;
        allowSubstitues = false;
      } "cp /proc/modules $out 2> /dev/null || touch $out";
  _moduleMatch =
    builtins.match
      ".*video [0-9]+ [0-9]+ (([a-z0-9_]+,)+) .*"
      (builtins.readFile _modulesFile);
  videoModules =
    let
      data = lib.optionals
        (_moduleMatch != null)
        (builtins.split "," (builtins.head _moduleMatch));
    in
    builtins.trace "[NixGL] Detected Modules: ${builtins.toString data}" data;
  # i915           = intel module
  # nvidia_modeset = nvidia module
  intelPresent =
    let
      data = builtins.any (mod: mod == "i915") videoModules;
      strv = if data then "true" else "false";
    in
    builtins.trace "[NixGL] Intel Present: ${strv}" data;
  nvidiaPresent =
    let
      data = builtins.any (mod: mod == "nvidia_modeset") videoModules;
      strv = if data then "true" else "false";
    in
    builtins.trace "[NixGL] NVIDIA Present: ${strv}" data;
  packages =
    lib.optional intelPresent nixgl.nixGLIntel
    ++ lib.optional nvidiaPresent nixgl.auto.nixGLNvidia;


in
rec {
  inherit intelPresent;
  inherit nvidiaPresent;
  package =
    if (builtins.length packages) > 1
    then
      writeExecutable
        {
          name = "nixGLCompose";
          text = ''
            #!${runtimeShell}
            exec ${
              builtins.toString (
                builtins.map
                  (pkg: lib.getExe' (nixgl.nixGLCommon pkg) "nixGL")
                  packages
              )
            } "$@"
          '';
        }
    else nixgl.auto.nixGLDefault;
  wrap =
    if (builtins.length packages) > 1
    then guiWrapFactory package "nixGLCompose"
    else guiWrapFactory package "nixGL";
}
