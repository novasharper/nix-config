{ config, pkgs, lib, ... }:

{
  programs.vim = {
    enable = true;
    plugins = with pkgs.vimPlugins; [
      ale
      lightline-ale
      lightline-vim
      rust-vim
      vim-polyglot
      vim-sensible
    ];
    settings = {
      mouse = "a";
    };
    extraConfig = ''
      fun! SetupCommandAlias(from, to)
        exec 'cnoreabbrev <expr> '.a:from
                  \ .' ((getcmdtype() is# ":" && getcmdline() is# "'.a:from.'")'
                  \ .'? ("'.a:to.'") : ("'.a:from.'"))'
      endfun
      call SetupCommandAlias("W", "w")
      call SetupCommandAlias("Q", "q")
      call SetupCommandAlias("X", "x")

      fun! SetTabstop(n)
        let &l:tabstop = a:n
        let &l:softtabstop = a:n
        let &l:shiftwidth = a:n
        let &l:expandtab = 1
      endfun
      autocmd FileType python call SetTabstop(3)
      autocmd FileType groovy call SetTabstop(4)
      autocmd FileType sh call SetTabstop(3)
      autocmd FileType go call SetTabstop(6)
      autocmd FileType yaml call SetTabstop(2)
      autocmd FileType json call SetTabstop(3)
      autocmd FileType dhall call SetTabstop(4)
      autocmd FileType haskell call SetTabstop(4)

      augroup python
        autocmd!
        autocmd FileType python
                    \   syn keyword pythonSelf self
                    \ | highlight def link pythonSelf Special
                    \ | syn keyword pythonCls cls
                    \ | highlight def link pythonCls Special
                    \ | nnoremap <leader>y :0,$!yapf<Cr><C-o>
      augroup end

      map <F7> mzgg=G`z

      syntax enable
      filetype plugin indent on
      set hlsearch
      hi Normal guibg=NONE ctermbg=NONE

      let g:go_version_warning = 0
      let g:go_fmt_command = "goimports"
      let g:lightline = {
              \ 'colorscheme': 'wombat',
              \ 'active': {
              \   'left': [ [ 'mode', 'paste' ],
              \             [ 'gitbranch', 'readonly', 'filename', 'modified' ] ],
              \   'right': [ [ 'linter_checking', 'linter_errors', 'linter_warnings', 'linter_ok' ],
              \              [ 'lineinfo' ],
              \              [ 'percent' ],
              \              [ 'fileformat', 'fileencoding', 'filetype' ] ]
              \ },
              \ 'component_function': {
              \   'gitbranch': 'fugitive#head',
              \ },
              \ 'component_expand': {
              \   'linter_checking': 'lightline#ale#checking',
              \   'linter_warnings': 'lightline#ale#warnings',
              \   'linter_errors': 'lightline#ale#errors',
              \   'linter_ok': 'lightline#ale#ok',
              \ },
              \ 'component_type': {
              \   'linter_checking': 'left',
              \   'linter_warnings': 'warning',
              \   'linter_errors': 'error',
              \   'linter_ok': 'left',
              \ },
              \ }

      " Write this in your vimrc file
      let g:ale_lint_on_text_changed = 'never'
      let g:ale_lint_on_insert_leace = 0

      " Open error list when there are errors/warnings
      let g:ale_open_list = 1
    '';
  };
}
