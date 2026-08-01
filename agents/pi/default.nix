{
  config,
  lib,
  pkgs,
  ...
}:

let
  piPackage = pkgs.pi-coding-agent-bun;
  # Built from contrib/pi-shell-sandbox by contrib's overlay, so `nix flake
  # check` builds the same derivation — and with it the extension's type check
  # and test suite.
  shellSandboxPackage = pkgs.pi-shell-sandbox;
  # pi.nix generates the same subcommand-first guard, but its case list is
  # install|remove|uninstall|update|list|config — `auth` is missing, and pi
  # tests `args[0] === "auth"` literally, so upstream's wrapper turns `pi auth`
  # into `pi --append-system-prompt … auth` and pi rejects it. Carrying the
  # resource flags here instead keeps `pi auth` working: with rules/extensions
  # left unset below, pi.nix's wrapper adds no arguments of its own and just
  # execs this script.
  #
  # The cost is that pi.nix's finalRules and finalArgs stay empty, so anything
  # deriving from them sees an agent with no system prompt and no extension —
  # jail.enable builds its bwrap permissions that way, hence the assertion
  # below. Drop all of this once upstream's case list covers auth.
  # See UPSTREAM.md §3.3.
  piPackageWithResources = pkgs.writeShellScriptBin "pi" ''
    case "''${1-}" in
      auth|install|remove|uninstall|update|list|config)
        exec ${lib.escapeShellArg (lib.getExe piPackage)} "$@"
        ;;
      *)
        exec ${lib.escapeShellArg (lib.getExe piPackage)} \
          --append-system-prompt ${lib.escapeShellArg "${./context.md}"} \
          --extension ${lib.escapeShellArg "${shellSandboxPackage}"} \
          "$@"
        ;;
    esac
  '';
  shellRuntimePackages = [
    pkgs.ripgrep
    pkgs.which
  ]
  ++ lib.optionals pkgs.stdenv.isLinux [
    pkgs.bubblewrap
    pkgs.socat
  ];
in
{
  config = lib.mkIf config.agents.enable {
    home.packages = shellRuntimePackages;

    assertions = [
      {
        assertion = !config.programs.pi.coding-agent.jail.enable;
        message = ''
          agents/pi carries --append-system-prompt and --extension in its own
          wrapper, so programs.pi.coding-agent.finalArgs is empty and a jail
          built from it would confine an agent with neither. Move the flags to
          the rules/extensions options before enabling jail — which also means
          giving up `pi auth`, or waiting for upstream to add it to the wrapper's
          subcommand list.
        '';
      }
    ];

    programs.pi.coding-agent = {
      enable = true;
      # Carries --append-system-prompt and --extension itself; see above.
      package = piPackageWithResources;
      environment = {
        PI_SKIP_VERSION_CHECK.value = "1";
        PI_TELEMETRY.value = "0";
      };
      settings = {
        defaultProvider = "openrouter";
        defaultThinkingLevel = "medium";
        enableInstallTelemetry = false;
        theme = "dark";

        enabledModels = [
          "anthropic/claude-*"
          "google/gemini-*"
          "openai/gpt-*"
          "moonshotai/kimi-*"
          "minimax/minimax-*"
        ];

        compaction = {
          enabled = true;
          keepRecentTokens = 20000;
          reserveTokens = 16384;
        };

        retry = {
          enabled = true;
          baseDelayMs = 2000;
          maxRetries = 3;
        };
      };
    };
  };
}
