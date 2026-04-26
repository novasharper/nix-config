{
  pkgs,
  lib,
  ...
}:

let
  enable = x: x // { enable = true; };
  flattenSettings =
    prefix: attrs:
    lib.concatMapAttrs
      (
        name: value:
        let
          key = if prefix == "" then name else "${prefix}.${name}";
          # Detect language-specific keys like python
          isLanguageKey = lib.hasPrefix "[" name;
        in
        if builtins.isAttrs value && !lib.isDerivation value then
          if isLanguageKey then
            { "${key}" = flattenSettings "" value; }
          else
            value
        else
          { "${key}" = value; }
      )
      attrs;

in
{
  programs.vscode = enable {
    profiles.default = {
      extensions = with pkgs.nix-vscode-extensions.vscode-marketplace; [
        anthropic.claude-code
        bbenoist.nix
        golang.go
        lencerf.beancount
        misodee.vscode-nbt
        ms-python.debugpy
        ms-python.python
        ms-python.vscode-pylance
        ms-python.vscode-python-envs
        ms-vscode.cpp-devtools
        ms-vscode.cpptools-themes
        ms-vscode-remote.remote-containers
        ms-vscode-remote.remote-ssh
        ms-vscode-remote.remote-ssh-edit
        redhat.java
        redhat.vscode-yaml
        rust-lang.rust-analyzer
        tamasfe.even-better-toml
        # Raspberry Pi Pico
        # Disabling until supports system toolchain
        raspberry-pi.raspberry-pi-pico
        paulober.pico-w-go
        marus25.cortex-debug
        mcu-debug.debug-tracker-vscode
        mcu-debug.memory-view
        mcu-debug.rtos-views
        mcu-debug.peripheral-viewer
        # Local
        pkgs.vscode-local.ms-vscode.cpptools
      ];
      enableExtensionUpdateCheck = false;
      enableUpdateCheck = false;
      userSettings = flattenSettings "" {
        chat = {
          agent.enabled = false;
          disableAIFeatures = true;
          useAgentSkills = false;
        };
        claudeCode = {
          preferredLcation = "sidebar";
          environmentVariables = [
            "ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-6"
            "ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-4-6"
            "CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1"
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"
          ];
        };
        containers = {
          containerClient = "com.microsoft.visualstudio.containers.podman";
          orchestratorClient = "com.microsoft.visualstudio.containers.podmancompose";
        };
        dev.containers.dockerpath = "podman";
        files = {
          autoSave = "off";
          insertFinalNewline = true;
          trimFinalNewlines = true;
        };
        git.blame = {
          editorDecoration.enabled = true;
          statusBarItem.enabled = true;
        };
        window.autoDetectColorScheme = true;
        "[nix]" = {
          editor.tabSize = 2;
        };
        github.copilot.chat.reviewAgent.enabled = false;
        redhat.telemetry.enabled = false;
      };
    };
    mutableExtensionsDir = false;
  };
}
