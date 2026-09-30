{
  config,
  lib,
  pkgs,
  ...
}:

let
  baseAgentDef = {
    pkg = pkgs.claude-code;
    name = "claude";
    env = {
      DISABLE_ERROR_REPORTING = 1;
      DISABLE_EXTRA_USAGE_COMMAND = 1;
      DISABLE_FEEDBACK_COMMAND = 1;
      DISABLE_TELEMETRY = 1;
      DISABLE_UPDATES = 1;
      CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY = 1;
    };
  };
  localAgentDef = baseAgentDef // {
    name = "claude-local";
    pkgBin = "claude"; # Binary name in wrapped package
    proxy = {
      url = {
        var = "ANTHROPIC_BASE_URL";
        value = "https://ai.internal.nvsh.net/api/v1";
      };
      auth = {
        var = "ANTHROPIC_AUTH_TOKEN";
        file = "~/.llm-auth-key";
      };
    };
  };

in
{
  config = lib.mkIf config.agents.enable {
    home = {
      file = {
        ".local/bin/claude-session-info" = {
          executable = true;
          source = ../contrib/claude-session-info.py;
        };
      };

      packages = [
        (pkgs.mkAgentWrapper localAgentDef)
      ];
    };

    programs.claude-code = {
      enable = true;
      package = pkgs.mkAgentWrapper baseAgentDef;
      marketplaces = {
        novasharper = pkgs.novasharper-claude-plugins;
      };
      settings = {
        autoMemoryEnabled = true;
        # Autocompact when context size reaches 500k
        autoCompactWindow = 500000;
        model = "opus";
        theme = "auto";
        tui = "fullscreen";
        includeCoAuthoredBy = false;
        attribution = {
          commit = "";
          pr = "";
        };
        statusLine = {
          type = "command";
          command = ../contrib/claude-session-info.py;
        };
        enabledPlugins = {
          "gopls-lsp@claude-plugins-official" = true;
          "agent-loop@novasharper" = true;
        };
        # Sandbox/Permissions
        permissions = {
          defaultMode = "default";
          disableBypassPermissionsMode = "disable";
          deny = [
            "Bash(rm -rf *)"
            "Bash(rm -fr *)"
            "Bash(sudo *)"
            "Bash(mkfs *)"
            "Bash(dd *)"
            "Bash(wget *|bash*)"
            "Bash(wget *| bash*)"
            "Bash(git push --force*)"
            "Bash(git push *--force*)"
            "Bash(git reset --hard*)"
          ];
        };
        sandbox = {
          enabled = true;
          failIfUnavailable = true;
          filesystem = {
            denyRead = [
              ".env"
              "./secrets"
              # External Files
              "~/.llm-auth-key"
              "~/.netrc"
              "~/.npmrc"
              # External Paths
              "~/.gnupg/**"
              "~/.config/gh/**"
              "~/.docker/config.json"
              "~/.kube/**"
              "~/.npm/**"
              "~/.ssh/**"
              "~/Library/Keychains/**"
            ];
            denyWrite = [
              ".env"
              # External Files
              "~/.bashrc"
              "~/.zshrc"
              "~/.ssh/**"
            ];
          };
        };
      };
    };
  };
}
