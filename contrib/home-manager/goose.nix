# Home Manager module for goose-cli — https://github.com/aaif-goose/goose
#
# home-manager has no upstream goose module, so this provides
# `programs.goose-cli` in the shape of the upstream agent modules
# (`programs.codex`, `programs.opencode`).
#
# goose rewrites config.yaml itself (`goose configure`, in-session model/mode
# changes, newly bundled extensions), so by default the settings declared here
# are merged into the existing file at activation with yq — the same approach
# `programs.zed-editor` uses with jq. Declared values win; anything goose added
# on its own is preserved.
{
  config,
  lib,
  pkgs,
  ...
}:

let
  inherit (lib)
    literalExpression
    mkEnableOption
    mkIf
    mkMerge
    mkOption
    mkPackageOption
    types
    ;

  cfg = config.programs.goose-cli;
  yamlFormat = pkgs.formats.yaml { };
  configDir = "${config.xdg.configHome}/goose";

  # Deep-merge `staticSettings` into the (mutable) YAML file at `path`,
  # letting the declared settings overwrite what is already there.
  impureConfigMerger =
    path: staticSettings:
    let
      pathArg = lib.escapeShellArg path;
      staticArg = lib.escapeShellArg staticSettings;
      dirArg = lib.escapeShellArg (builtins.dirOf path);
    in
    ''
      if [[ -v DRY_RUN ]] ; then
        echo "merge ${staticSettings} into ${path}"
      else
        mkdir -p ${dirArg}
        # Switching mutableSettings from false leaves a read-only store symlink
        # here, and writing through it would abort the activation.
        if [ -L ${pathArg} ]; then
          rm ${pathArg}
        fi
        if [ ! -e ${pathArg} ]; then
          : > ${pathArg}
        fi
        # config.yaml can hold provider API keys, so it is never world-readable.
        chmod 0600 ${pathArg}
        merge_tmp="$(mktemp ${pathArg}.XXXXXX)"
        chmod 0600 "$merge_tmp"
        if ${lib.getExe pkgs.yq-go} eval-all '. as $item ireduce ({}; . * $item)' \
          ${pathArg} ${staticArg} > "$merge_tmp" ; then
          mv "$merge_tmp" ${pathArg}
        else
          # The file may be hand-edited and hold the only copy of something, so
          # keep it rather than overwriting it with the declared settings.
          rm -f "$merge_tmp"
          mv ${pathArg} ${pathArg}.bak
          install -m 0600 ${staticArg} ${pathArg}
          warnEcho "goose: ${path} is not valid YAML; kept it as ${path}.bak and wrote the declared settings"
        fi
        unset merge_tmp
      fi
    '';

in
{
  options.programs.goose-cli = {
    enable = mkEnableOption "goose, an extensible open source AI agent";

    package = mkPackageOption pkgs "goose-cli" { nullable = true; };

    mutableSettings = mkOption {
      type = types.bool;
      default = true;
      example = false;
      description = ''
        Whether goose may keep updating {file}`config.yaml` itself. When true
        the declared {option}`settings` are merged into the existing file on
        activation; when false the file becomes a read-only symlink into the
        Nix store and `goose configure` can no longer write to it.
      '';
    };

    mutablePermissions = mkOption {
      type = types.bool;
      default = true;
      example = false;
      description = ''
        Whether goose may keep updating {file}`permission.yaml` itself, with
        the same merge-versus-symlink semantics as {option}`mutableSettings`.
      '';
    };

    settings = mkOption {
      inherit (yamlFormat) type;
      default = { };
      example = literalExpression ''
        {
          GOOSE_PROVIDER = "openrouter";
          GOOSE_MODEL = "openai/gpt-5.6-terra";
          GOOSE_MODE = "smart_approve";
          extensions.developer = {
            enabled = true;
            type = "platform";
            name = "developer";
            bundled = true;
            available_tools = [ ];
          };
        }
      '';
      description = ''
        Configuration for {file}`$XDG_CONFIG_HOME/goose/config.yaml`. Keys
        declared here overwrite the ones in the existing file; keys goose added
        on its own are kept unless {option}`mutableSettings` is false. Lists are
        replaced wholesale rather than concatenated.
      '';
    };

    permissions = mkOption {
      inherit (yamlFormat) type;
      default = { };
      example = literalExpression ''
        {
          smart_approve = {
            always_allow = [ ];
            ask_before = [ "developer__shell" ];
            never_allow = [ ];
          };
        }
      '';
      description = ''
        Per-tool approval levels for {file}`$XDG_CONFIG_HOME/goose/permission.yaml`,
        keyed by goose mode. Merged the same way as {option}`settings`, so a
        declared list replaces the one goose wrote. Runtime "always allow"
        decisions live in {file}`permissions/tool_permissions.json` and are
        untouched.
      '';
    };

    context = mkOption {
      type = types.either types.lines types.path;
      default = "";
      example = "Prefer small, reviewable diffs.";
      description = ''
        Global context for goose, applied to every session in addition to any
        project-level {file}`.goosehints`.

        The value is either inline content as a string or a path to a file
        containing the content. It is written to
        {file}`$XDG_CONFIG_HOME/goose/.goosehints`.
      '';
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = !(lib.hm.strings.isPathLike cfg.context && lib.pathIsDirectory cfg.context);
        message = "`programs.goose-cli.context` must be a file when set to a path";
      }
    ];

    home.packages = mkIf (cfg.package != null) [ cfg.package ];

    home.activation = mkMerge [
      (mkIf (cfg.mutableSettings && cfg.settings != { }) {
        gooseSettingsActivation = lib.hm.dag.entryAfter [ "linkGeneration" ] (
          impureConfigMerger "${configDir}/config.yaml" (yamlFormat.generate "goose-config.yaml" cfg.settings)
        );
      })
      (mkIf (cfg.mutablePermissions && cfg.permissions != { }) {
        goosePermissionsActivation = lib.hm.dag.entryAfter [ "linkGeneration" ] (
          impureConfigMerger "${configDir}/permission.yaml" (
            yamlFormat.generate "goose-permission.yaml" cfg.permissions
          )
        );
      })
    ];

    xdg.configFile = mkMerge [
      (mkIf (!cfg.mutableSettings && cfg.settings != { }) {
        "goose/config.yaml".source = yamlFormat.generate "goose-config.yaml" cfg.settings;
      })
      (mkIf (!cfg.mutablePermissions && cfg.permissions != { }) {
        "goose/permission.yaml".source = yamlFormat.generate "goose-permission.yaml" cfg.permissions;
      })
      (
        if lib.hm.strings.isPathLike cfg.context then
          { "goose/.goosehints".source = cfg.context; }
        else
          mkIf (cfg.context != "") { "goose/.goosehints".text = cfg.context; }
      )
    ];
  };
}
