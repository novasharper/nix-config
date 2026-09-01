{
  config,
  lib,
  pkgs,
  ...
}:

let
  xdgConfigHome = lib.removePrefix config.home.homeDirectory config.xdg.configHome;
  configDir = if config.home.preferXdgDirectories then "${xdgConfigHome}/codex" else ".codex";
  configPath = "${configDir}/config.toml";
  nixConfig = config.home.file.${configPath}.source;

in
{
  config = lib.mkIf config.agents.enable {
    home = {
      activation = lib.mkIf config.programs.codex.enable {
        mergeCodexConfig = lib.hm.dag.entryAfter [ "linkGeneration" ] ''
          configPath="$HOME"/${lib.escapeShellArg configPath}
          nixConfig=${lib.escapeShellArg nixConfig}

          run mkdir -p "$(dirname "$configPath")"
          if [[ -e "$configPath" ]]; then
            mergedConfig="$(mktemp)"
            ${lib.getExe pkgs.yq-go} \
              eval-all \
              --input-format=toml \
              --output-format=toml \
              '(select(fileIndex == 0) // {}) * select(fileIndex == 1)' \
              "$configPath" \
              "$nixConfig" \
              > "$mergedConfig"
            run install -D -m 644 "$mergedConfig" "$configPath"
          else
            run install -D -m 644 "$nixConfig" "$configPath"
          fi
        '';
      };

      file = {
        "${configPath}".enable = false;
      };
    };

    programs.codex = {
      enable = true;
      package = pkgs.mkAgentWrapper {
        pkg = pkgs.codex;
        name = "codex";
        # proxy.auth = {
        #   file = "~/.llm-auth-key";
        #   var = "LLM_AUTH_KEY";
        # };
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
