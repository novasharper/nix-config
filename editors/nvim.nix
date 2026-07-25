{ pkgs, ... }:

let
  # nvim-treesitter tracks its `main` branch in nixpkgs, which keeps queries
  # under `runtime/queries` rather than `queries`. Grammars ship as separate
  # plugins carrying only `parser/<lang>.so`, so the query tree has to be put
  # on the runtimepath by hand.
  treesitterRuntime = "${pkgs.vimPlugins.nvim-treesitter}/runtime";

  # Add more from `pkgs.vimPlugins.nvim-treesitter-parsers`.
  treesitterParsers = with pkgs.vimPlugins.nvim-treesitter-parsers; [
    bash
    c
    cmake
    cpp
    css
    diff
    dhall
    dockerfile
    gitcommit
    go
    groovy
    haskell
    hcl
    html
    javascript
    json
    lua
    make
    markdown
    markdown_inline
    nix
    python
    query
    regex
    rust
    toml
    typescript
    vim
    vimdoc
    yaml
  ];

in
{
  programs.neovim = {
    enable = true;
    defaultEditor = true;

    # `vim` stays the real vim — see ./vim.nix.
    viAlias = false;
    vimAlias = false;
    vimdiffAlias = false;

    # No plugin here uses the remote-plugin hosts.
    withPython3 = false;
    withRuby = false;

    # Put language-server executables and editor tools on nvim's own PATH.
    # Project toolchains such as Go and Rust still come from `home.packages`.
    extraPackages = with pkgs; [
      clang-tools # clangd
      fd
      gopls
      gotools # goimports
      lua-language-server
      nixd
      nixfmt
      python3Packages.python-lsp-server
      python3Packages.yapf
      ripgrep
      rust-analyzer
    ];

    plugins =
      with pkgs.vimPlugins;
      [
        # LSP definitions for `vim.lsp.enable` (nvim ships the client itself).
        nvim-lspconfig

        # UI
        lualine-nvim
        nvim-tree-lua
        nvim-web-devicons
        gitsigns-nvim
        tokyonight-nvim
        vim-fugitive

        # Syntax
        nvim-treesitter

        # Find
        plenary-nvim
        telescope-nvim
        telescope-fzf-native-nvim
      ]
      ++ treesitterParsers;

    initLua = ''
      vim.opt.runtimepath:append("${treesitterRuntime}")

      vim.g.mapleader = "\\"
      vim.g.maplocalleader = "\\"

      local config_group = vim.api.nvim_create_augroup("NixConfig", { clear = true })

      -- === options ===
      vim.o.mouse = "a"
      vim.o.hlsearch = true
      vim.o.number = true
      vim.o.signcolumn = "yes"
      vim.o.termguicolors = true
      vim.o.updatetime = 250
      vim.o.splitbelow = true
      vim.o.splitright = true
      vim.o.completeopt = "menuone,noselect,popup"
      vim.o.undofile = true

      -- Transparent background, matching the vim setup.
      local function clear_bg()
        for _, group in ipairs({ "Normal", "NormalNC", "NonText", "SignColumn" }) do
          vim.api.nvim_set_hl(0, group, { bg = "none" })
        end
      end
      clear_bg()
      vim.api.nvim_create_autocmd("ColorScheme", {
        group = config_group,
        callback = clear_bg,
      })

      require("tokyonight").setup({
        style = "storm",
        transparent = true,
        terminal_colors = true,
        styles = {
          comments = { italic = true },
          functions = { bold = true },
          keywords = { italic = true },
        },
        on_highlights = function(hl, colors)
          hl.CursorLine = { bg = colors.bg_highlight }
          hl.CursorColumn = { bg = colors.bg_highlight }
          hl.Visual = { bg = colors.bg_visual }
        end,
      })
      vim.cmd.colorscheme("tokyonight")

      -- === command aliases ===
      for from, to in pairs({ W = "w", Q = "q", X = "x" }) do
        vim.cmd.cnoreabbrev({
          args = { "<expr>", from, ([[(getcmdtype() is# ":" && getcmdline() is# "%s") ? "%s" : "%s"]]):format(from, to, from) },
        })
      end

      -- === per-filetype indentation ===
      -- Widths and expandtab behavior carried over from the vim config. Make is
      -- the sole exception because its recipes require hard tabs.
      local tabstops = {
        dhall = { width = 4 },
        go = { width = 6 },
        groovy = { width = 4 },
        haskell = { width = 4 },
        json = { width = 3 },
        lua = { width = 2 },
        make = { width = 4, expandtab = false },
        nix = { width = 2 },
        python = { width = 4 },
        rust = { width = 4 },
        sh = { width = 3 },
        yaml = { width = 2 },
      }
      vim.api.nvim_create_autocmd("FileType", {
        group = config_group,
        callback = function(ev)
          local ts = tabstops[ev.match]
          if not ts then
            return
          end
          vim.bo[ev.buf].tabstop = ts.width
          vim.bo[ev.buf].softtabstop = ts.width
          vim.bo[ev.buf].shiftwidth = ts.width
          vim.bo[ev.buf].expandtab = ts.expandtab ~= false
        end,
      })

      -- === language-specific Vim behavior ===
      local function filter_buffer(command)
        local buffer = vim.api.nvim_get_current_buf()
        local lines = vim.api.nvim_buf_get_lines(buffer, 0, -1, false)
        local result = vim.system({ command }, {
          stdin = table.concat(lines, "\n") .. "\n",
          text = true,
        }):wait()

        if result.code ~= 0 then
          vim.notify(
            ("%s failed: %s"):format(command, vim.trim(result.stderr or "")),
            vim.log.levels.ERROR
          )
          return
        end

        local formatted = vim.split(result.stdout or "", "\n", { plain = true })
        if formatted[#formatted] == "" then
          table.remove(formatted)
        end
        vim.api.nvim_buf_set_lines(buffer, 0, -1, false, formatted)
      end

      vim.api.nvim_create_autocmd("FileType", {
        group = config_group,
        pattern = "python",
        callback = function(ev)
          vim.fn.matchadd("Special", [[\<\(self\|cls\)\>]])
          vim.keymap.set("n", "<leader>y", function()
            local view = vim.fn.winsaveview()
            filter_buffer("yapf")
            vim.fn.winrestview(view)
          end, { buffer = ev.buf, desc = "Format buffer with yapf" })
        end,
      })

      vim.api.nvim_create_autocmd("BufWritePre", {
        group = config_group,
        pattern = "*.go",
        callback = function()
          local view = vim.fn.winsaveview()
          filter_buffer("goimports")
          vim.fn.winrestview(view)
        end,
      })

      -- === treesitter ===
      vim.api.nvim_create_autocmd("FileType", {
        group = config_group,
        callback = function(ev)
          local lang = vim.treesitter.language.get_lang(ev.match)
          if not lang or not pcall(vim.treesitter.start, ev.buf, lang) then
            return
          end
          vim.bo[ev.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
        end,
      })

      -- === diagnostics ===
      -- ALE opened the location list on every problem; keep that behavior while
      -- also showing diagnostics inline.
      vim.diagnostic.config({
        virtual_text = { spacing = 2, prefix = "●" },
        severity_sort = true,
        signs = {
          text = {
            [vim.diagnostic.severity.ERROR] = "✘",
            [vim.diagnostic.severity.WARN] = "▲",
            [vim.diagnostic.severity.HINT] = "⚑",
            [vim.diagnostic.severity.INFO] = "»",
          },
        },
      })

      vim.api.nvim_create_autocmd("DiagnosticChanged", {
        group = config_group,
        callback = function(ev)
          vim.schedule(function()
            if ev.buf ~= vim.api.nvim_get_current_buf() then
              return
            end

            local editing_window = vim.api.nvim_get_current_win()
            if vim.tbl_isempty(vim.diagnostic.get(ev.buf)) then
              vim.cmd("silent! lclose")
            else
              vim.diagnostic.setloclist({ open = false })
              vim.cmd("silent! lopen")
            end

            if vim.api.nvim_win_is_valid(editing_window) then
              vim.api.nvim_set_current_win(editing_window)
            end
          end)
        end,
      })

      -- === lsp ===
      vim.lsp.config("lua_ls", {
        settings = {
          Lua = {
            runtime = { version = "LuaJIT" },
            diagnostics = { globals = { "vim" } },
            workspace = { checkThirdParty = false },
            telemetry = { enable = false },
          },
        },
      })

      vim.lsp.config("nixd", {
        settings = {
          nixd = {
            formatting = { command = { "nixfmt" } },
          },
        },
      })

      vim.lsp.enable({
        "clangd",
        "gopls",
        "lua_ls",
        "nixd",
        "pylsp",
        "rust_analyzer",
      })

      vim.api.nvim_create_autocmd("LspAttach", {
        group = config_group,
        callback = function(ev)
          local client = vim.lsp.get_client_by_id(ev.data.client_id)
          local function map(lhs, rhs, desc)
            vim.keymap.set("n", lhs, rhs, { buffer = ev.buf, desc = desc })
          end

          -- nvim 0.11+ already provides grn/gra/grr/gri/gO/K by default.
          map("gd", vim.lsp.buf.definition, "Go to definition")
          map("gD", vim.lsp.buf.declaration, "Go to declaration")
          map("gy", vim.lsp.buf.type_definition, "Go to type definition")
          map("<leader>f", function()
            vim.lsp.buf.format({ timeout_ms = 3000 })
          end, "Format buffer")

          if client and client:supports_method("textDocument/completion") then
            vim.lsp.completion.enable(true, client.id, ev.buf, { autotrigger = true })
          end
        end,
      })

      vim.keymap.set("n", "<leader>q", vim.diagnostic.setloclist, { desc = "Diagnostics to loclist" })

      -- === plugin setup ===
      require("gitsigns").setup()

      require("lualine").setup({
        options = {
          theme = "tokyonight",
          globalstatus = true,
        },
        sections = {
          lualine_b = { "branch", "diff", "diagnostics" },
          lualine_c = { { "filename", path = 1 } },
          lualine_x = { "encoding", "fileformat", "filetype" },
        },
      })

      require("nvim-tree").setup({
        view = { width = 34 },
        renderer = { group_empty = true },
      })

      local telescope = require("telescope")
      telescope.setup({
        extensions = {
          fzf = { fuzzy = true, override_generic_sorter = true, override_file_sorter = true },
        },
      })
      pcall(telescope.load_extension, "fzf")

      -- === keymaps ===
      local builtin = require("telescope.builtin")
      vim.keymap.set("n", "<leader>ff", builtin.find_files, { desc = "Find files" })
      vim.keymap.set("n", "<leader>fg", builtin.live_grep, { desc = "Live grep" })
      vim.keymap.set("n", "<leader>fb", builtin.buffers, { desc = "Buffers" })
      vim.keymap.set("n", "<leader>fh", builtin.help_tags, { desc = "Help tags" })

      vim.keymap.set("n", "<leader>e", "<cmd>NvimTreeToggle<cr>", { desc = "Toggle file tree" })
      vim.keymap.set("n", "<C-n>", "<cmd>NvimTreeToggle<cr>", { desc = "Toggle file tree" })

      vim.keymap.set("n", "h", function()
        vim.wo.cursorline = not vim.wo.cursorline
        vim.wo.cursorcolumn = not vim.wo.cursorcolumn
      end, { desc = "Toggle cursor crosshair" })

      vim.keymap.set("n", "<F7>", "mzgg=G`z", { desc = "Reindent buffer" })
    '';
  };
}
