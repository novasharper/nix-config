{ config, pkgs, lib, ... }:

with import <nixpkgs> {};
{
  home = {
    username = "pllong";
    homeDirectory = "/home/pllong";
    packages = with pkgs;
      [
        # === languages ===
        # --- go ---
        golangci-lint
        gopls
        # --- rust-lang ---
        cargo
        rustc
        rust-analyzer
        # === general ===
        bat
        colordiff
        gh                   # github cli - https://github.com/cli/cli
        htop
        httpie
        jq
        kubernetes-helm
        mosh
        ncdu
        yt-dlp
        # --- fonts ---
        office-code-pro
      ];
    file = {
      ".local/bin/update-channel" = {
        executable = true;
        text = ''
        #!/usr/bin/env bash

        _nix_version_file="$HOME/.config/nixpkgs/VERSION"
        if [ -f $_nix_version_file ] ; then
          _nix_version=$(cat $_nix_version_file)
          _nix_channel=nixos-$_nix_version
          nix-channel --add https://nixos.org/channels/$_nix_channel
        fi

        nix-channel --update
        nix-env -iA nixpkgs.nix
        '';
      };
      ".local/bin/update-home" = {
        executable = true;
        text = ''
        #!/usr/bin/env nix-shell
        #!nix-shell -i bash -p home-manager
        home-manager switch
        '';
      };
      ".local/bin/home-generations" = {
        executable = true;
        text = ''
        #!/usr/bin/env nix-shell
        #!nix-shell -i bash -p home-manager
        home-manager generations
        '';
      };
      ".local/bin/home-generations-gc" = {
        executable = true;
        text = ''
        #!/usr/bin/env nix-shell
        #!nix-shell -i bash -p home-manager
        home-manager expire-generations "${"\${1:--7 days}"}"
        nix-store --gc
        '';
      };
    };
    # Re-enable this after there is a method for pre-pending PATH
    # https://github.com/nix-community/home-manager/issues/3324
    /*
    sessionPath = [
      "$HOME/.local/bin"
      "$HOME/bin"
      "$HOME/go/bin"
      "$HOME/.nix-profile/bin"
    ];
    */
    sessionVariables = 
      let nixProfDir = "/nix/var/nix/profiles/per-user/$USER";
      in with lib.strings; {
        NIX_PATH = concatStringsSep ":" [
          "$HOME/.nix-defexpr/channels"
          "${nixProfDir}/channels"
        ];
        PKG_CONFIG_PATH = concatStringsSep ":" [
          "$HOME/.nix-profile/lib/pkgconfig"
          "${nixProfDir}/profile/lib/pkgconfig"
          #"/usr/share/pkgconfig"
          #"/usr/lib64/pkgconfig"
          #"/usr/local/lib/pkgconfig"
        ];
        LD_LIBRARY_PATH = concatStringsSep ":" [
          "$HOME/.nix-profile/lib"
          "${nixProfDir}/profile/lib/pkgconfig"
          #"/usr/lib64"
          #"/usr/lib"
          #"/usr/local/lib64"
          #"/usr/local/lib"
        ];
      };
    shellAliases = {
      e = "\${EDITOR:-emacs -nw}";
      "rm~" = "find . -type f -name \*~ -delete";
      rmTilda = "find . -type f -name \*~ -delete";
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
    stateVersion = "22.11";
  };

  programs.dircolors = {
    enable = true;
  };

  programs.home-manager = {
    enable = true;
  };

  imports = [
    ./git.nix
    ./vim.nix
    ./zsh.nix
  ];
}
