{
  config,
  lib,
  ...
}:

let
  # Bundled platform extensions. goose maintains these entries itself, so only
  # the fields worth pinning are spelled out; the rest of each entry is left as
  # goose wrote it.
  platformExtension =
    key: attrs:
    {
      type = "platform";
      name = key;
      bundled = true;
      available_tools = [ ];
    }
    // attrs;

in
{
  config = lib.mkIf config.agents.enable {
    programs.goose-cli = {
      enable = false;

      # GOOSE_PROVIDER and GOOSE_MODEL are deliberately left undeclared so that
      # `goose configure` and in-session model switches persist across
      # activations. Everything below is managed here.
      settings = {
        GOOSE_MODE = "smart_approve";
        GOOSE_TELEMETRY_ENABLED = false;
        OPENROUTER_HOST = "https://openrouter.ai";

        # Screen tool calls for prompt injection. Findings above the threshold
        # (default 0.8) hand the decision to the user; anything below is only
        # logged. The ML classifier is left off — it needs an endpoint.
        SECURITY_PROMPT_ENABLED = true;

        # goose defaults to 1000 consecutive turns without user input. In an
        # interactive session it asks whether to continue at the limit; in
        # `goose run` it stops there instead.
        GOOSE_MAX_TURNS = 50;

        # Show token cost estimates, since openrouter is metered.
        GOOSE_CLI_SHOW_COST = true;

        extensions = lib.mapAttrs platformExtension {
          analyze = {
            enabled = true;
            display_name = "Analyze";
            description = "Analyze code structure with tree-sitter: directory overviews, file details, symbol call graphs";
          };
          apps = {
            enabled = true;
            display_name = "Apps";
            description = "Create and manage custom Goose apps through chat. Apps are HTML/CSS/JavaScript and run in sandboxed windows.";
          };
          chatrecall = {
            enabled = false;
            display_name = "Chat Recall";
            description = "Search past conversations and load session summaries for contextual memory";
          };
          code_execution = {
            enabled = false;
            display_name = "Code Mode";
            description = "Goose will make extension calls through code execution, saving tokens";
          };
          developer = {
            enabled = true;
            display_name = "Developer";
            description = "Write and edit files, and execute shell commands";
          };
          extensionmanager = {
            enabled = true;
            display_name = "Extension Manager";
            description = "Enable extension management tools for discovering, enabling, and disabling extensions";
          };
          summarize = {
            enabled = false;
            display_name = "Summarize";
            description = "Load files/directories and get an LLM summary in a single call";
          };
          summon = {
            enabled = true;
            display_name = "Summon";
            description = "Load knowledge and delegate tasks to subagents";
          };
          todo = {
            enabled = true;
            display_name = "Todo";
            description = "Enable a todo list for goose so it can keep track of what it is doing";
          };
          tom = {
            enabled = true;
            display_name = "Top Of Mind";
            description = "Inject custom context into every turn via GOOSE_MOIM_MESSAGE_TEXT and GOOSE_MOIM_MESSAGE_FILE environment variables";
          };
        };
      };

      # Tools that must be confirmed before running under smart_approve. goose
      # writes this file itself via `goose configure`; declaring it keeps the
      # baseline identical across machines. Per-tool "always allow" answers
      # given during a session are recorded elsewhere and are not affected.
      permissions.smart_approve = {
        always_allow = [ ];
        ask_before = [
          "developer__shell"
          "edit"
          "extensionmanager__manage_extensions"
          "shell"
          "todo__todo_write"
          "write"
        ];
        never_allow = [ ];
      };
    };
  };
}
