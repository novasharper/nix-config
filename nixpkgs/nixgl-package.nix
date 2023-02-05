{ config, pkgs, lib, ... }:

with import <nixpkgs> {};
let
  nixgl = import <nixgl> {};
  _modulesFile =
    runCommand "impure-loaded-modules-file" {
      time = builtins.currentTime;
      preferLocalBuild = true;
      allowSubstitues = false;
    } "cp /proc/modules $out 2> /dev/null || touch $out";
  _driverMatch =
    builtins.match
    ".*video [0-9]+ [0-9]+ (([a-z0-9_]+,)+) .*"
    (builtins.readFile _modulesFile);
  videoDrivers =
    let
      data =
        if _driverMatch != null
        then builtins.split "," (builtins.head _driverMatch)
        else [];
    in
      builtins.trace "[NixGL] Detected Drivers: ${builtins.toString data}" data;
  # i915           = intel driver
  # nvidia_modeset = nvidia driver
  intelPresent =
    let
      data = builtins.any (drv: drv == "i915") videoDrivers;
      strv = if data then "true" else "false";
    in
      builtins.trace "[NixGL] Intel Present: ${strv}" data;

in {
  inherit intelPresent;
  package =
    if intelPresent
    then nixgl.nixGLCommon nixgl.nixGLIntel
    else nixgl.nixGLCommon nixgl.auto.nixGLNvidia;
}