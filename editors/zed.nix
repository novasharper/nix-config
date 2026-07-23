{ pkgs, lib, ... }:

{
  programs.zed-editor = {
    enable = true;
    userSettings = {
      language_models = {
        openai_compatible = {
          LLAMA-SERVER = {
            api_url = "https://ai.internal.nvsh.net/api";
            available_models = [
              {
                name = "mistral-small-4";
                max_tokens = 200000;
                max_output_tokens = 32000;
                max_completion_tokens = 200000;
                capabilities = {
                  tools = true;
                  images = false;
                  parallel_tool_calls = true;
                  prompt_cache_key = true;
                  chat_completions = true;
                };
              }
            ];
          };
        };
        open_router = {
          api_url = "https://openrouter.ai/api/v1";
          available_models = [
            {
              name = "openrouter/auto";
              display_name = "Auto Router";
              max_tokens = 2000000;
              supports_tools = true;
              provider = {
                order = [
                  "mistralai"
                  "openai"
                  "anthropic"
                ];
                allow_fallbacks = true;
                require_parameters = true;
                data_collection = "disallow";
              };
            }
          ];
        };
      };
      agent = {
        default_model = {
          provider = "open_router";
          model = "openai/gpt-5.6-terra";
          enable_thinking = true;
        };
        dock = "right";
      };
      git_panel = {
        dock = "left";
      };
      agent_servers = {
        gemini = {
          type = "registry";
        };
        claude-acp = {
          type = "registry";
        };
      };
      telemetry = {
        diagnostics = false;
        metrics = false;
      };
      ui_font_size = 16;
      buffer_font_size = 15;
      theme = {
        mode = "system";
        light = "One Light";
        dark = "One Dark";
      };
    };
  };
}
