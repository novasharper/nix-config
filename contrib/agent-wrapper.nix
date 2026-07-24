{ pkgs, ... }:

let
  inherit (pkgs) lib;

in
{ pkg
, name
, pkgBin ? ""
, proxy ? { }
, env ? { }
, extraArgs ? [ ]
, strictAuthPermissions ? false
,
}:

# The auth permission check is only emitted as part of the proxy setup, so
# strictAuthPermissions without a proxy would silently do nothing.
assert lib.assertMsg (!strictAuthPermissions || proxy != { })
  "mkAgentWrapper (${name}): strictAuthPermissions requires proxy.auth to be set";

let
  authPermissionsPart =
    if strictAuthPermissions then
      ''
        auth_permissions="$(
          stat -f '%Lp' ${proxy.auth.file} 2>/dev/null \
            || stat -c '%a' ${proxy.auth.file} 2>/dev/null
        )"
        if [[ "$auth_permissions" != "400" && "$auth_permissions" != "600" ]] ; then
          echo "${proxy.auth.file} must have permissions 400 or 600 (currently $auth_permissions)"
          exit 1
        fi
      ''
    else
      "";

  proxyPart =
    if proxy != { } then
      ''
        if [[ ! -f ${proxy.auth.file} ]] ; then
          echo "Could not find ${proxy.auth.file}"
          exit 1
        fi

        ${authPermissionsPart}

        ${
          # codex (and possibly others define proxies in config file)
          if (lib.hasAttr "url" proxy) && (proxy.url != { }) then
            "export ${proxy.url.var}=\"${proxy.url.value}\""
          else
            ""
        }
        export ${proxy.auth.var}="$(cat ${proxy.auth.file})"
      ''
    else
      "";

in
pkgs.writeTextFile
  {
    inherit name;

    text = ''
      #!${lib.getExe pkgs.bash}

      ${proxyPart}
      ${builtins.concatStringsSep "\n" (
        lib.mapAttrsToList (k: v: "export ${k}=\"\${${k}:-${toString v}}\"") env
      )}

      exec ${
        lib.getExe' pkg (if pkgBin == "" then name else pkgBin)
      } ${
        builtins.concatStringsSep " " (lib.map (v: "\"${toString v}\"") extraArgs)
      } "$@"
    '';
    executable = true;
    destination = "/bin/${name}";
  }
  // {
  inherit (pkg) version;
}
