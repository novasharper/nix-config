{ inputs
, config
, pkgs
, lib
, nixVersion ? "unstable"
, ...
}:

let
  stdenv = pkgs.stdenv;
  enable = x: x // { enable = true; };
  username = "pllong";
  homedir = if stdenv.isDarwin then "/Users/${username}" else "/home/${username}";
  confdir = "${homedir}/.config";
  localConf = "${confdir}/nix-local/default.nix";

  # package wrappers
  pyradioWrapper = pkgs.pyradio.overrideAttrs (self: super: {
    propagatedBuildInputs = super.propagatedBuildInputs ++ [ pkgs.mpv ];
  });

  pythonEnv = pkgs.python314.withPackages (ps: [
    ps.pylint
    ps.setuptools
    ps.tox
    ps.virtualenv
  ]);

in
{
  home = {
    username = username;
    homeDirectory = homedir;

    packages = with pkgs; [
      # === languages ===
      # --- build ---
      cmake
      meson
      ninja
      # --- c++ ---
      clang-tools
      # --- go ---
      golangci-lint
      gotools
      # --- python ---
      pythonEnv
      pipenv
      # --- nix ---
      hydra-check
      nixpkgs-fmt
      # --- rust-lang ---
      # cargo
      # cargo-binutils
      # cargo-edit
      # rustc
      # rustfmt
      # rust-analyzer
      fenix.stable.completeToolchain
      cargo-expand

      # === general ===
      bat
      beancount # Text-based ledger
      catt # Cast ALL the things
      colordiff
      exiftool
      exiv2
      fastfetch
      fava # BeanCount Web UI
      fusee-interfacee-tk
      gpxsee
      htop
      httpie
      jq
      kubernetes-helm
      mosh
      qpdf
      ripgrep
      rsync
      tmux
      tree
      # --- Raspberry Pi Pico ---
      pico-sdk
      probe-rs-tools
      # --- Art ---
      #gimp
      inkscape
      # --- AV ---
      # Disabling because I don't really seem to be using this
      #pyradioWrapper
      # --- fonts ---
      office-code-pro
    ];

    file = {
      ".local/bin/home-generations" = {
        executable = true;
        text = ''
          #!/usr/bin/env nix-shell
          #!nix-shell <home-manager> -i bash -p home-manager
          home-manager generations
        '';
      };
      ".local/bin/home-generations-gc" = {
        executable = true;
        text = ''
          #!/usr/bin/env nix-shell
          #!nix-shell <home-manager> -i bash -p home-manager
          set -e
          home-manager expire-generations "${"\${1:--7 days}"}"
          nix-store --gc
          nix-collect-garbage -d
        '';
      };
      ".local/bin/update-channel" = {
        executable = true;
        text =
          let
            chPfx = if stdenv.isDarwin then "nixpkgs" else "nixos";
            chSfx =
              if (stdenv.isDarwin && nixVersion != "unstable")
              then "-darwin"
              else "";
            nixCh = "${chPfx}-${nixVersion}${chSfx}";

          in
          ''
            #!/usr/bin/env bash
            set -e

            _nix_version="${nixVersion}"
            if [[ $_nix_version == unstable ]] ; then
              _home_mgr_channel=master.tar.gz
            else
              _home_mgr_channel=release-$_nix_version.tar.gz
            fi
            nix-channel --add https://nixos.org/channels/${nixCh} nixpkgs

            echo "Updating channel"
            nix-channel --update
          '';
      };
      ".local/bin/update-home" = {
        executable = true;
        text = ''
          #!/usr/bin/env bash
          set -e
          nix flake update --flake ~/.config/home-manager
          nix upgrade-nix
          home-manager switch
          if test -x update-desktop-database ; then
            update-desktop-database
          fi
        '';
      };
    };
    sessionPath = [
      "$HOME/.local/bin"
      "$HOME/bin"
      "$HOME/go/bin"
      "$HOME/.nix-profile/bin"
      "/nix/var/nix/profiles/default/bin"
    ];
    sessionVariables = {
      EDITOR = "${lib.getExe pkgs.vim}";
    };
    shellAliases = {
      e = "\${EDITOR:-emacs -nw}";
      code = "codium";
      "rm~" = "find . -type f -name \\*~ -delete";
      rmTilda = "find . -type f -name \\*~ -delete";
      path = "echo -e $PATH | sed 's/:/\\n/g'";
      nix-path = "echo -e $NIX_PATH | sed 's/:/\\n/g'";
      rsync-progress = "rsync -azp --info=progress2";
      ls = "ls --color=auto";
      l = "ls -lAh";
      ltr = "ls -ltrAh";
      view = "vim -R";
      less = "less -r";
      grep = "grep --color=auto";
      # git
      g = "git";
      gb = "git branch";
      gc = "git commit";
      gca = "git commit --amend";
      gcan = "git commit --amend --no-edit";
      gcs = "git show";
      gd = "git diff";
      co = "git checkout";
      gl = "git log --graph --oneline --branches";
      gl1 = "git log --graph --oneline";
      gprr = "git pull --rebase";
      gr = "git rebase";
      agri = "GIT_EDITOR=true git rebase --interactive --autosquash --autostash";
      gp = "git push";
      gs = "git status -sb";
      ff = "git pull --ff-only";
      gg = "git pull --ff-only";
      Gtrack = "git branch -r | grep -v \"\\->\" | while read remote; do git branch --track \"\${remote#origin/}\" \"$remote\"; done";
      Gretract = "git branch | grep -v '*' | xargs -n 1 -I '{}' git branch -f '{}' origin/'{}'";
      wd = "git diff --word-diff";
      # kubernetes
      k8 = "kubectl";
      k8lint = "kubectl create --dry-run -f";
      k8get = "kubectl get";
      k8watch = "kubectl get -o wide -w";
      kcat = "kubectl describe po";
      krm = "kubectl delete";
      kns = "kubectl config set-context --current --namespace";
    };
    stateVersion = "25.11";
  };

  news.display = "silent";

  nix = {
    package = pkgs.nixVersions.latest;

    channels = {
      inherit (inputs) nixpkgs home-manager fenix nixgl;
    };
    keepOldNixPath = false;

    registry =
      let
        items = [ "nixpkgs" "home-manager" "fenix" "nixgl" ];
        entries = map
          (item: {
            name = item;
            value = {
              from = {
                type = "indirect";
                id = item;
              };
              flake = inputs.${item};
            };
          })
          items;

      in
      builtins.listToAttrs entries;

    settings = {
      experimental-features = [ "nix-command" "flakes" ];
    };
  };

  programs = {
    dircolors.enable = true;
    home-manager.enable = true;

    # TODO: Figure out which settings to use
    gemini-cli = enable { };

    gh = enable {
      settings = {
        git_protocol = "https";
        prompt = "enabled";
        aliases = {
          co = "pr checkout";
          pv = "pr view";
        };
      };
    };


    go.enable = true;

    tmux = enable {
      plugins = with pkgs.tmuxPlugins; [
        pain-control
        {
          plugin = prefix-highlight;
          # This is needed so that the config is defined _before_ the plugin
          # is enabled.
          extraConfig = ''
            # Right Status
            set -g status-right ' #{prefix_highlight} %A %m/%d | %H:%M '
            set -g status-right-length 60
          '';
        }
      ];
      shell = "${pkgs.zsh}/bin/zsh";
      shortcut = "a";
      terminal = "screen-256color";
      extraConfig = ''
        # Left Status
        set -g status-left '[ #h:#S ] '
        set -g status-left-length 30

        # Window title options
        set-window-option -g window-status-style bright
        set-window-option -g window-status-current-style bright

        # Active window title colors
        set -g window-status-format ' #I:#W#F '
        set -g window-status-current-format '#[bg=white,fg=black] #I:#W#F '
      '';
    };

    vscode = enable {
      package = pkgs.vscodium;
      profiles.default = {
        extensions = with pkgs.nix-vscode-extensions.vscode-marketplace; [
          bbenoist.nix
          golang.go
          lencerf.beancount
          misodee.vscode-nbt
          ms-python.python
          ms-python.vscode-pylance
          ms-vscode-remote.remote-containers
          ms-vscode-remote.remote-ssh
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
        ];
        enableExtensionUpdateCheck = false;
        enableUpdateCheck = false;
        userSettings = {
          "dev.containers.dockerPath" = "podman";
          "extensions.autoUpdate" = false;
          "files.autoSave" = "off";
          "[nix]"."editor.tabSize" = 2;
        };
      };
      mutableExtensionsDir = false;
    };

    yt-dlp = enable {
      extraConfig = ''
        --alias --yt "-f \"bv*[vcodec^=avc]+ba[ext~='(m4a|mp4)']/b[ext=mp4]/b\" --sleep-requests 1.5 --min-sleep-interval 30 --max-sleep-interval 60"
        --alias --subdl '--embed-subs --sub-langs all,-llive_chat --convert-subs srt'
      '';
    };
  };

  imports = [
    ./git.nix
    ./shells.nix
    ./vim.nix
  ] ++ lib.optional (builtins.pathExists localConf) localConf
  ++ lib.optional stdenv.isLinux ./linux.nix
  ++ lib.optional stdenv.isDarwin ./darwin.nix;
}
