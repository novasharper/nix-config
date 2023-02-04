{ config, pkgs, lib, ... }:

with import <nixpkgs> {};
let
  nixgl = import <nixgl> {};
  nixGLPackage = nixgl.nixGLIntel;
  nixGuiWrap = pkg: pkgs.runCommand "${pkg.name}-nixgui-wrapper" {
    preferLocalBuild = true;
  } ''
    mkdir $out
    ln -s ${pkg}/* $out
    rm $out/bin
    mkdir $out/bin
    # nixGL/Home Manager issue; https://github.com/guibou/nixGL/issues/44
    # nixGL/Home Manager issue; https://github.com/guibou/nixGL/issues/114
    # nixGL causes all software ran under it to gain nixGL status; https://github.com/guibou/nixGL/issues/116
    # we wrap packages with nixGL; it customizes LD_LIBRARY_PATH and related
    # envs so that nixpkgs find a compatible OpenGL driver
    nixgl_bin="${lib.getExe nixGLPackage}"
    # Similar to OpenGL, the executables installed by nix cannot find the GTK modules
    # required by the environment. The workaround is to unset the GTK_MODULES and
    # GTK3_MODULES so that it does not reach for system GTK modules.
    # We also need to modify the GTK_PATH to point to libcanberra-gtk3 installed via Nix
    gtk_path="${lib.getLib pkgs.libcanberra-gtk3}/lib/gtk-3.0"
    for bin in ${pkg}/bin/*; do
      wrapped_bin=$out/bin/$(basename $bin)
      echo "exec env GTK_MODULES= GTK3_MODULES= GTK_PATH=\"$gtk_path\" $nixgl_bin  $bin \"\$@\"" > $wrapped_bin
      chmod +x $wrapped_bin
    done
  '';

in {
  home = {
    username = "pllong";
    homeDirectory = "/home/pllong";
    packages = with pkgs;
      [
        # nixgl
        nixGLPackage

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
        # --- AV ---
        (nixGuiWrap mpv)
        (nixGuiWrap obs-studio)
        vlc
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
        /*
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
        */
      };
    shellAliases = {
      e = "\${EDITOR:-emacs -nw}";
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
    stateVersion = "22.11";
  };

  programs = {
    dircolors.enable = true;
    home-manager.enable = true;

    vscode = {
      enable = true;
      extensions = with pkgs.vscode-extensions; [
        bbenoist.nix
      ];
    };
  };

  imports = [
    ./git.nix
    ./vim.nix
    ./zsh.nix
  ];
}
