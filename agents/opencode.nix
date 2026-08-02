{
  config,
  lib,
  ...
}:

{
  config = lib.mkIf config.agents.enable {
    programs.opencode = {
      enable = true;
      settings = {
        enabled_providers = [ "openrouter" ];

        # Nix manages the installed version.
        autoupdate = false;

        # Match the privacy posture of the other agents.
        share = "disabled";
        experimental.openTelemetry = false;

        permission = {
          bash = {
            "*" = "ask";

            "rm -rf *" = lib.hm.dag.entryAfter [ "*" ] "deny";
            "rm -fr *" = lib.hm.dag.entryAfter [ "*" ] "deny";
            "sudo *" = lib.hm.dag.entryAfter [ "*" ] "deny";
            "mkfs *" = lib.hm.dag.entryAfter [ "*" ] "deny";
            "dd *" = lib.hm.dag.entryAfter [ "*" ] "deny";
            "git push --force*" = lib.hm.dag.entryAfter [ "*" ] "deny";
            "git push *--force*" = lib.hm.dag.entryAfter [ "*" ] "deny";
            "git reset --hard*" = lib.hm.dag.entryAfter [ "*" ] "deny";
          };

          read = {
            "*.env" = "deny";
            "secrets/**" = "deny";
            "~/.llm-auth-key" = "deny";
            "~/.netrc" = "deny";
            "~/.npmrc" = "deny";
            "~/.gnupg/**" = "deny";
            "~/.config/gh/**" = "deny";
            "~/.docker/config.json" = "deny";
            "~/.kube/**" = "deny";
            "~/.npm/**" = "deny";
            "~/.ssh/**" = "deny";
            "~/Library/Keychains/**" = "deny";
          };

          edit = {
            "*.env" = "deny";
            "~/.bashrc" = "deny";
            "~/.zshrc" = "deny";
            "~/.ssh/**" = "deny";
          };
        };
      };
    };
  };
}
