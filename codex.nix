{ pkgs, ... }:

{
  programs.codex = {
    enable = true;
    package = pkgs.mkAgentWrapper {
      pkg = pkgs.codex;
      name = "codex";
      proxy.auth = {
        file = "~/.llm-auth-key";
        var = "LLM_AUTH_KEY";
      };
    };
    settings = {
      model_providers.ai-internal = {
        name = "ai-internal";
        base_url = "https://ai.internal.nvsh.net/api/v1";
        env_key = "LLM_AUTH_KEY";
      };

      # Model doesn't really matter. Only 'gpt-5.x' model names
      # seem to do anything.
      model = "qwen3-coder-next";
      model_context_window = 131072;
      model_provider = "ai-internal";
      model_reasoning_effort = "medium";
      web_search = "disabled";
    };
  };
}
