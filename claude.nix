{ pkgs, ... }:

{
  home.file = {
    ".local/bin/claude-session-info" = {
      executable = true;
      source = ./contrib/claude-session-info.py;
    };
  };

  programs.claude-code = {
    enable = true;
    package = pkgs.mkAgentWrapper {
      pkg = pkgs.claude-code;
      name = "claude";
      env = {
        CLAUDE_CODE_ATTRIBUTION_HEADER = 0;
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = 1;
      };
    };
    commands = {
      session-info = ''
        ---
        description: Show Claude Code session info for the current project
        allowed-tools: Bash
        ---
        Run `${./contrib/claude-session-info.py}` and output the result verbatim to the user. Do not summarize, truncate, reformat, or omit any part of the output.
      '';
    };
    settings = {
      autoMemoryEnabled = true;
      sandbox = {
        enabled = true;
      };
      permissions = {
        defaultMode = "default";
        disableBypassPermissionsMode = "disable";
      };
      includeCoAuthoredBy = false;
      attribution = {
        commit = "";
        pr = "";
      };
      statusLine = {
        type = "command";
        command = ./contrib/claude-session-info.py;
      };
    };
  };
}
