{ config, pkgs, lib, ... }:

{
  programs.git = {
    enable = true;
    settings = {
      color = {
        branch = {
          current = "yellow reverse";
          local = "yellow";
          remote = "green";
        };
        diff = {
          meta = "yellow bold";
          frag = "magenta bold";
          old = "red bold";
          new = "green bold";
        };
        status = {
          added = "yellow";
          changed = "green";
          untraced = "cyan";
        };
        ui = "auto";
      };
      core = {
        whitespace = "space-before-tab,indent-with-non-tab,trailing-space";
        pager = "less -F -X";
        editor = "vim";
      };
      http = {
        sslVerify = "true";
      };
      init = {
        defaultBranch = "main";
      };
      pull = {
        ff = "only";
      };
      rebase = {
        autosquash = "true";
      };
      user = {
        name = "Pat Long";
        email = "pat@novasharper.net";
      };
    };
    ignores = [
      # Some sensible files to ignore
      "!.gitignore"
      # Folder view configuration files
      ".DS_Store"
      "Desktop.ini"
      # Thumbnail cache files
      "._*"
      "Thumbs.db"
      # Files that might appear on external disks
      ".Spotlight-V100"
      ".Trashes"
      "*.sublime-*"
      # VSCode
      ".vscode"
      # IntelliJ
      ".idea"
      # Other
      "*.pyc"
      "autom4te.cache"
      ".qt"
      "Makefile.in"
      "aclocal.m4"
      "**/autogen/**"
      "**/smashes/**"
      "config.h.in"
      "configure"
      "version.m4"
      "*.swp"
      "*~"
      "*#"
      "ID"
      "tags"
      ".pytest_cache"
      "flycheck_*.py"
    ];
    includes = [
      { path = "~/.config/git/gpg.config"; }
    ];
    lfs = {
      enable = true;
    };
  };
}
