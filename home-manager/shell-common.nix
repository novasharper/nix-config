{
  initExtra = ''
    # $1 = type; 0 - both, 1 - tab, 2 - title
    # rest = text
    setTerminalText() {
      # echo works in bash & zsh
      local mode=$1 ; shift
      echo -ne "\033]$mode;$@\007"
    }
    stt_both  () { setTerminalText 0 $@; }
    stt_tab   () { setTerminalText 1 $@; }
    stt_title () { setTerminalText 2 $@; }
    # git
    function _get_gitroot {
      for _start in main master m/master origin/HEAD ; do
        if git rev-parse -q --verify $_start &>/dev/null ; then
          echo $_start
          return
        fi
      done
      echo "Could not detect correct root ref for log" >&2
      echo main
    }
    function glm {
      git log --graph --oneline --branches $(_get_gitroot)~1..HEAD "$@"
    }
    function glm1 {
      git log --graph --oneline $(_get_gitroot)~1..HEAD "$@"
    }
    # golang
    function list_imports {
      go list -f '{{ join .Imports "\n" }}' $@ | grep -v vendor | sort | uniq
    }
    # kubernetes
    function k8ls {
      kubectl get pods | grep "$1"
    }
    alias kls='k8ls'
    function k8ll {
      kubectl get pods -o wide | grep "$1"
    }
    alias kll='k8ll'
    function k8ssh {
      kubectl exec -ti "$1" -- bash
    }
    alias ksh='k8ssh'
    function k8scale {
      kubectl scale "$1" --replicas="$2"
    }
    function k8ctx {
        opt="current delete get set use"
        if [ $# -eq 0 ] ; then
            echo "No action specified"
            echo "Valid actions: $opt"
            return 1
        fi
        case "$1" in
            current|delete|set|use)
                ctx_action="$1-context"
                ;;
            get)
                ctx_action="$1-contexts"
            ;;
            *)
                echo "Invalid action specified ($1)"
                echo "Valid actions: $opt"
                return 1
                ;;
        esac
        shift
        kubectl config "$ctx_action" $@
    }
    alias kctx='k8ctx'
    k8yaml() {
      _yaml_cmd="vi -c ':set ft=yaml' -"
      if hash bat 2>/dev/null ; then
          _yaml_cmd="bat -l yaml"
      fi
      kubectl get -o yaml "$@" | eval "$_yaml_cmd"
    }
    # get server fingerprint
    fingerprint() {
      if [[ " $@ " == *" -h "* ]] ; then
          echo "fingerprint [-p PORT] HOST"
          return
      fi
      ssh-keyscan "$@" 2>/dev/null | ssh-keygen -l -f -
    }
    # remote shell
    function msh {
      SERVER="${"\${1:-$MAIN_SERVER}"}"
      if [[ "$SERVER" == "--" ]]; then
          SERVER="$MAIN_SERVER"
      fi
      if [[ -z "$SERVER" ]]; then
          echo "MAIN_SERVER is not set, must provide server"
          return 1
      fi
      if [[ "$SERVER" != *.* ]] && [[ -n "$DOMAIN" ]]; then
        SERVER="$SERVER.$DOMAIN"
      fi
      REMOTE_SERVER='$HOME/mosh/$(uname -p)/bin/mosh-server'
      echo "+ mosh $SERVER -- ${"\${@:2}"}"
      stt_tab "mosh $(echo $SERVER | cut -f1 -d.)"
      eval "mosh $SERVER -- ${"\${@:2}"}"
    }
    function tsh {
      SERVER="${"\${1:-$MAIN_SERVER}"}"
      msh $SERVER bash -l -c '"
        if tmux has-session &> /dev/null ; then
          tmux attach-session
        else
          tmux
        fi
      "'
    }
  '';
}
