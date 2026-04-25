{
  config,
  pkgs,
  lib,
  ...
}:

let
  enable = x: x // { enable = true; };
  shellCommon = import ./shell-common.nix;
  profileExtra = lib.optionalString (config.home.sessionPath != [ ]) ''
    # TODO: Get rid of this after https://github.com/nix-community/home-manager/issues/3324
    #       is addressed
    export PATH="${lib.concatStringsSep ":" config.home.sessionPath}''${PATH:+:}$PATH"
  '';

in
{
  home = {
    shell = {
      enableBashIntegration = true;
      enableZshIntegration = true;
    };
    shellAliases = {
      e = "\${EDITOR:-emacs -nw}";
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
  };

  programs = {
    zsh = enable {
      dotDir = "${config.xdg.configHome}/zsh";
      enableCompletion = true;
      enableVteIntegration = true;
      historySubstringSearch.enable = true;
      initContent = lib.mkOrder 1000 shellCommon.initExtra;
      oh-my-zsh = {
        enable = true;
        theme = "ys";
      };
      profileExtra = profileExtra;
      syntaxHighlighting.enable = true;
    };

    bash = enable {
      bashrcExtra = profileExtra;
      enableVteIntegration = true;
      initExtra = ''
        if [ -f /etc/bashrc ] ; then
          . /etc/bashrc
        fi

        ${shellCommon.initExtra}
      '';
    };
  };
}
