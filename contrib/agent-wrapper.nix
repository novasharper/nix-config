{ pkgs, ... }:

let
  inherit (pkgs) lib;

in
{
  pkg,
  name,
  proxy ? { },
  env ? { },
}:

let
  proxyPart =
    if proxy != { } then
      ''
        if [[ ! -f ${proxy.auth.file} ]] ; then
          echo "Could not fine ${proxy.auth.file}"
          exit
        fi

        ${
          # codex (and possibly others define proxies in config file)
          if (lib.hasAttr "url" proxy) && (proxy.url != { })
          then "export \${proxy.url.var}=\"\${proxy.url.value}\""
          else ""
        }
        export ${proxy.auth.var}="$(cat ${proxy.auth.file})"
      ''
    else
      "";

in
pkgs.writeTextFile {
  inherit name;

  text = ''
    #!${lib.getExe pkgs.bash}

    ${proxyPart}
    ${builtins.concatStringsSep "\n" (
      lib.mapAttrsToList (k: v: "export ${k}=\"\${${k}:-${toString v}}\"") env
    )}

    exec ${lib.getExe' pkg "${name}"} "$@"
  '';
  executable = true;
  destination = "/bin/${name}";
} // {
  inherit (pkg) version;
}
