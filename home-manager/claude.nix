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
      statusLine = {
        type = "command";
        command = ./contrib/claude-session-info.py;
      };
    };
  };
}
