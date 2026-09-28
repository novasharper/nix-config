{
  config,
  lib,
  pkgs,
  ...
}:

let
  homeDir = config.home.homeDirectory;
in
{
  config = lib.mkIf config.agents.enable {
    programs.antigravity-cli = {
      enable = true;

      settings = {
        # Terminal Sandbox
        enableTerminalSandbox = true;
        toolPermission = "proceed-in-sandbox";

        # Telemetry & Feedback
        enableTelemetry = false;
        showFeedbackSurvey = false;
      };

      permissions = {
        allow = [
          "command(git)"
        ];

        deny = [
          # Destructive commands
          "command(rm -rf)"
          "command(rm -rf *)"
          "command(rm -fr)"
          "command(rm -fr *)"
          "command(sudo)"
          "command(sudo *)"
          "command(mkfs)"
          "command(mkfs *)"
          "command(dd)"
          "command(dd *)"
          "command(wget *|bash*)"
          "command(wget *| bash*)"
          "command(curl *|bash*)"
          "command(curl *| bash*)"
          "command(curl *|sh*)"
          "command(curl *| sh*)"
          "command(git push --force*)"
          "command(git push *--force*)"
          "command(git reset --hard*)"

          # Safeguard Git history and secrets in workspace
          "write_file(.git/)"
          "write_file(.env)"
          "read_file(.env)"
          "read_file(./secrets)"

          # External Files
          "read_file(${homeDir}/.llm-auth-key)"
          "read_file(${homeDir}/.netrc)"
          "read_file(${homeDir}/.npmrc)"
          "read_file(~/.llm-auth-key)"
          "read_file(~/.netrc)"
          "read_file(~/.npmrc)"

          # External Paths
          "read_file(${homeDir}/.gnupg)"
          "read_file(${homeDir}/.config/gh)"
          "read_file(${homeDir}/.docker/config.json)"
          "read_file(${homeDir}/.kube)"
          "read_file(${homeDir}/.npm)"
          "read_file(${homeDir}/.ssh)"
          "read_file(~/.gnupg)"
          "read_file(~/.config/gh)"
          "read_file(~/.docker/config.json)"
          "read_file(~/.kube)"
          "read_file(~/.npm)"
          "read_file(~/.ssh)"

          # Deny write to sensitive files and shell configs
          "write_file(${homeDir}/.bashrc)"
          "write_file(${homeDir}/.zshrc)"
          "write_file(${homeDir}/.ssh)"
          "write_file(~/.bashrc)"
          "write_file(~/.zshrc)"
          "write_file(~/.ssh)"
        ]
        ++ lib.optionals pkgs.stdenv.hostPlatform.isDarwin [
          "read_file(${homeDir}/Library/Keychains)"
          "read_file(~/Library/Keychains)"
        ];
      };
    };
  };
}
