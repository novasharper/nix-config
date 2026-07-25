{
  config,
  lib,
  pkgs,
  ...
}:

{
  config = lib.mkIf config.agents.enable {
    programs.pi-coding-agent = {
      enable = true;
      package = pkgs.mkAgentWrapper {
        pkg = pkgs.pi-coding-agent;
        name = "pi";
        env = {
          PI_SKIP_VERSION_CHECK = 1;
          PI_TELEMETRY = 0;
        };
      };
      context = ./context.md;
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

        # Local, reviewed extension. Third-party packages are intentionally
        # omitted because pi packages execute with full user permissions.
        packages = [
          "${./security.ts}"
        ];
      };
    };
  };
}
