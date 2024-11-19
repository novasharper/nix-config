{ config, pkgs, lib, ... }:

with import <nixpkgs> { };
let
  nixgl = import ./nixgl-package.nix { inherit config pkgs lib; };
  fenix = import <fenix> { };
  enable = x: x // { enable = true; };
  username = "pllong";
  homedir = if stdenv.isDarwin then "/Users/${username}" else "/home/${username}";
  confdir = "${homedir}/.config";
  localConf = "${confdir}/nix-local/default.nix";

  # package wrappers
  pyradioWrapper = pkgs.pyradio.overrideAttrs (self: super: {
    propagatedBuildInputs = super.propagatedBuildInputs ++ [ pkgs.mpv ];
  });

  pythonEnv = python312.withPackages (ps: [
    ps.pylint
    ps.setuptools
    ps.tox
    ps.virtualenv
  ]);

  linuxPkgs = with pkgs; [
    mypaint
    ncdu
    (nixgl.wrap celluloid)
    (nixgl.wrap cemu)
    (nixgl.wrap obs-studio)
    (nixgl.wrap vlc)
  ];

  darwinPkgs = with pkgs; [
    ffmpeg
    gnupg
    keepassxc
    libreoffice-bin
    wget
  ];

  vscode-local = with pkgs; {
    Misode.vscode-nbt = vscode-utils.buildVscodeMarketplaceExtension {
      mktplcRef = {
        name = "vscode-nbt";
        publisher = "Misodee";
        version = "0.9.1";
        sha256 = "6hl3TQLTjJwpF/oV+syVvxVxCNFKawBci3loyKiVJTY=";
      };
    };
    Lencerf.beancount = vscode-utils.buildVscodeMarketplaceExtension {
      mktplcRef = {
        name = "beancount";
        publisher = "Lencerf";
        version = "0.10.0";
        sha256 = "xsGYr9Aqfoe16U9lACyGkTfknwMf0n2oOog498SS26Y=";
      };
    };
  };

in
{
  home = {
    username = username;
    homeDirectory = homedir;

    packages = with pkgs;
      [
        # === languages ===
        # --- build ---
        meson
        ninja
        # --- c++ ---
        clang-tools
        # --- go ---
        golangci-lint
        gopls
        gotools
        # --- python ---
        pythonEnv
        pipenv
        # --- nix ---
        nixpkgs-fmt
        nixpkgs-lint
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
        exiv2
        exiftool
        qpdf
        fava # BeanCount Web UI
        gpxsee
        htop
        httpie
        jq
        kubernetes-helm
        mosh
        fastfetch
        ripgrep
        rsync
        tmux
        tree
        yt-dlp
        # --- Art ---
        gimp
        inkscape
        # --- AV ---
        pyradioWrapper
        # --- fonts ---
        office-code-pro
      ] ++ lib.optionals stdenv.isLinux  linuxPkgs
        ++ lib.optionals stdenv.isDarwin darwinPkgs;
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
    };
    sessionPath = [
      "$HOME/.local/bin"
      "$HOME/bin"
      "$HOME/go/bin"
      "$HOME/.nix-profile/bin"
      "/nix/var/nix/profiles/default/bin"
    ];
    sessionVariables =
      let
        rootChannelDir = "/nix/var/nix/profiles/per-user/root/channels";
        globalChannelDir = "/nix/var/nix/profiles/per-user/${username}/channels";
        localChannelDir = "${homedir}/.local/state/nix/profiles/channels";
      in with lib.strings; {
        NIX_PATH = concatStringsSep ":" (
          [ "$HOME/.nix-defexpr/channels" ]
          ++ lib.optional (builtins.pathExists rootChannelDir) rootChannelDir
          ++ lib.optional (builtins.pathExists globalChannelDir) globalChannelDir
          ++ lib.optional (builtins.pathExists localChannelDir) localChannelDir
        );
        EDITOR = "${lib.getExe pkgs.vim}";
      };
    shellAliases = {
      e = "\${EDITOR:-emacs -nw}";
      code = "codium";
      "rm~" = "find . -type f -name \\*~ -delete";
      rmTilda = "find . -type f -name \\*~ -delete";
      path = "echo -e \${PATH//:\\\\n}";
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
    stateVersion = "23.11";
  };

  news.display = "silent";

  nix = {
    package = pkgs.nix;

    settings = {
      experimental-features = [ "nix-command" "flakes" ];
    };
  };

  programs = {
    dircolors.enable = true;
    home-manager.enable = true;

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

    mpv = enable {
      config = {
        script-opts = with lib.strings; concatStringsSep "," [
          "ytdl_hook-ytdl_path=${lib.getExe pkgs.yt-dlp}"
        ];
      } // (
        # Vulkan API seems to be broken on Wayland
        if stdenv.isLinux
        then {
          gpu-api = "opengl";
          hwdec = "no";
        }
        else {}
      );
    } // (
      if stdenv.isLinux
      then {
        package =
          let
            inhibit-gnome = import ./contrib/inhibit-gnome.nix {
              inherit lib stdenv fetchFromGitHub;
              inherit (pkgs) pkg-config dbus mpv-unwrapped;
            };

          in
            nixgl.wrap (
              pkgs.wrapMpv pkgs.mpv-unwrapped {
                scripts = [ inhibit-gnome ];
              }
            );
      }
      else {}
    );

    tmux = enable {
      plugins = with pkgs.tmuxPlugins; [
        pain-control
        prefix-highlight
      ];
      shell = "${pkgs.zsh}/bin/zsh";
      shortcut = "a";
      terminal = "screen-256color";
      extraConfig = ''
        # Left Status
        set -g status-left '[ #h:#S ] '
        set -g status-left-length 30

        # Right Status
        set -g status-right ' #{prefix_highlight} %A %m/%d | %H:%M '
        set -g status-right-length 60

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
      extensions = with pkgs.vscode-extensions; [
        bbenoist.nix
        golang.go
        ms-python.python
        ms-python.vscode-pylance
        redhat.java
        redhat.vscode-yaml
        rust-lang.rust-analyzer
        tamasfe.even-better-toml
        vscode-local.Lencerf.beancount
        vscode-local.Misode.vscode-nbt
      ];
      enableExtensionUpdateCheck = false;
      enableUpdateCheck = false;
      mutableExtensionsDir = false;
      userSettings = {
        "files.autoSave" = "off";
        "extensions.autoUpdate" = false;
        "[nix]"."editor.tabSize" = 2;
      };
    };
  };

  imports = [
    ./git.nix
    ./shells.nix
    ./vim.nix
  ] ++ lib.optional stdenv.isLinux  ./linux.nix
    ++ lib.optional stdenv.isDarwin ./darwin.nix
    ++ lib.optional (builtins.pathExists localConf) localConf;
}
