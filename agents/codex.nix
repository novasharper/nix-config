{
  config,
  lib,
  pkgs,
  ...
}:

{
  config = lib.mkIf config.agents.enable {
    programs.codex = {
      enable = true;
      package = pkgs.mkAgentWrapper {
        pkg = pkgs.codex;
        name = "codex";
        # proxy.auth = {
        #   file = "~/.llm-auth-key";
        #   var = "LLM_AUTH_KEY";
        # };
        extraArgs = [
          "--profile"
          "local"
        ];
      };
      settings = {
        # Sandbox
        approval_policy = "on-request";
        sandbox_mode = "workspace-write";
        allow_login_shell = false;
        sandbox_workspace_write.network_access = true;

        # Analytics
        analytics.enabled = false;
        feedback.enabled = false;
      };
      profiles = {
        internal = {
          model_providers.ai-internal = {
            name = "ai-internal";
            # TODO
            base_url = "http://ai.internal.nvsh.net:8080/v1";
            request_max_retries = 4;
            stream_max_retries = 5;
            stream_idle_timeout_ms = 60000;
          };

          # Codex special-cases 'gpt-5.x' names for some features; other
          # model ids are passed through to the provider verbatim.
          model = "unsloth/Laguna-S-2.1";
          model_context_window = 128 * 1024;
          model_provider = "ai-internal";

          # qwen3-coder-next doesn't honor OpenAI's web_search tool schema.
          web_search = "disabled";

          # No reasoning output expected from this model.
          hide_agent_reasoning = false;
        };
      };
    };
  };
}
