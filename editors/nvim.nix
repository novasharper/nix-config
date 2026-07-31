{ pkgs, ... }:

{
  programs.nixvim =
    { lib, ... }:
    let
      raw = lib.nixvim.mkRaw;

    in
    {
      enable = true;
      defaultEditor = true;

      extraPackages = with pkgs; [
        fd
        gotools # goimports
        nixfmt
        python3Packages.black
        ripgrep
      ];

      globals = {
        mapleader = "\\";
        maplocalleader = "\\";
      };

      opts = {
        mouse = "a";
        hlsearch = true;
        number = true;
        signcolumn = "yes";
        termguicolors = true;
        updatetime = 250;
        splitbelow = true;
        splitright = true;
        completeopt = "menuone,noselect,popup";
        undofile = true;
      };

      colorschemes.catppuccin = {
        enable = true;
        settings = {
          integrations = {
            lualine = true;
          };
          styles = {
            comments = [ "italic" ];
            functions = [ "bold" ];
            keywords = [ "italic" ];
          };
          transparent = true;
          terminal_colors = true;
        };
      };

      diagnostic.settings = {
        loclist.open = false;
        virtual_text = {
          spacing = 2;
          prefix = "●";
        };
        severity_sort = true;
        signs.text = raw ''
          {
             [vim.diagnostic.severity.ERROR] = "✘",
             [vim.diagnostic.severity.WARN] = "▲",
             [vim.diagnostic.severity.HINT] = "⚑",
             [vim.diagnostic.severity.INFO] = "»",
           }
        '';
      };

      plugins = {
        fugitive.enable = true;
        gitsigns.enable = true;
        lspconfig.enable = true;
        web-devicons.enable = true;

        lualine = {
          enable = true;
          settings = {
            options = {
              globalstatus = true;
            };
            sections = {
              lualine_b = [
                "branch"
                "diff"
                "diagnostics"
              ];
              lualine_c = [
                {
                  __unkeyed-1 = "filename";
                  path = 1;
                }
              ];
              lualine_x = [
                "encoding"
                "fileformat"
                "filetype"
              ];
            };
          };
        };

        nvim-tree = {
          enable = true;
          settings = {
            view.width = 34;
            renderer.group_empty = true;
          };
        };

        telescope = {
          enable = true;
          keymaps = {
            "<leader>ff" = {
              action = "find_files";
              options.desc = "Find files";
            };
            "<leader>fg" = {
              action = "live grep";
              options.desc = "Live grep";
            };
            "<leader>fb" = {
              action = "buffers";
              options.desc = "Buffers";
            };
            "<leader>fh" = {
              action = "help_tags";
              options.desc = "Help tags";
            };
          };
          extensions.fzf-native = {
            enable = true;
            settings = {
              fuzzy = true;
              override_generic_sorter = true;
              override_file_sorter = true;
            };
          };
        };

        treesitter = {
          enable = true;
          highlight.enable = true;
          indent.enable = true;
        };
      };

      lsp = {
        servers = {
          clangd.enable = true;
          gopls.enable = true;
          lua_ls = {
            enable = true;
            config.settings.Lua = {
              runtime.version = "LuaJIT";
              diagnostics.globals = [ "vim" ];
              workspace.checkThirdParty = false;
              telemetry.enable = false;
            };
          };
          nixd = {
            enable = true;
            config.settings.nixd.formatting.command = [ "nixfmt" ];
          };
          pylsp.enable = true;
          rust_analyzer.enable = true;
        };
        keymaps = [
          {
            mode = "n";
            key = "gd";
            lspBufAction = "definition";
            options.desc = "Go to definition";
          }
          {
            mode = "n";
            key = "gD";
            lspBufAction = "declaration";
            options.desc = "Go to declaration";
          }
          {
            mode = "n";
            key = "gy";
            lspBufAction = "type_definition";
            options.desc = "Go to type definition";
          }
          {
            mode = "n";
            key = "<leader>f";
            action = raw ''
              function()
                vim.lsp.buf.format({ timeout_ms = 3000 })
              end
            '';
            options.desc = "Format buffer";
          }
        ];
        onAttach = ''
          if client:supports_method("textDocument/completion") then
            vim.lsp.completion.enable(true, client.id, bufnr, { autotrigger = true })
          end
        '';
      };

      keymaps = [
        {
          mode = "n";
          key = "<leader>q";
          action = raw "vim.diagnostic.setloclist";
          options.desc = "Diagnostics to loclist";
        }
        {
          mode = "n";
          key = "<leader>e";
          action = "<cmd>NvimTreeToggle<cr>";
          options.desc = "Toggle file tree";
        }
        {
          mode = "n";
          key = "<C-n>";
          action = "<cmd>NvimTreeToggle<cr>";
          options.desc = "Toggle file tree";
        }
        {
          mode = "n";
          key = "h";
          action = raw ''
            function()
              vim.wo.cursorline = not vim.wo.cursorline
              vim.wo.cursorcolumn = not vim.wo.cursorcolumn
            end
          '';
          options.desc = "Toggle cursor crosshair";
        }
        {
          mode = "n";
          key = "<F7>";
          action = "mzgg=G`z";
          options.desc = "Reindent buffer";
        }
      ];

      autoGroups.NixConfig.clear = true;

      autoCmd = [
        {
          event = "FileType";
          group = "NixConfig";
          callback = raw ''
            function(event)
              local tabstops = {
                dhall = { width = 4 },
                go = { width = 6 },
                groovy = { width = 4 },
                haskell = { width = 4 },
                json = { width = 2 },
                lua = { width = 2 },
                make = { width = 4, expandtab = false },
                nix = { width = 2 },
                python = { width = 4 },
                rust = { width = 4 },
                sh = { width = 2 },
                yaml = { width = 2 },
              }
              local settings = tabstops[event.match]
              if settings then
                vim.bo[event.buf].tabstop = settings.width
                vim.bo[event.buf].softtabstop = settings.width
                vim.bo[event.buf].shiftwidth = settings.width
                vim.bo[event.buf].expandtab = settings.expandtab ~= false
              end
            end
          '';
        }
        {
          event = "FileType";
          pattern = "python";
          group = "NixConfig";
          callback = raw ''
            function(event)
              vim.fn.matchadd("Special", [[\<\(self\|cls\)\>]])
              vim.keymap.set("n", "<leader>y", function()
                local view = vim.fn.winsaveview()
                filter_buffer("black")
                vim.fn.winrestview(view)
              end, { buffer = event.buf, desc = "Format buffer with black" })
            end
          '';
        }
        {
          event = "BufWritePRe";
          pattern = "go";
          group = "NixConfig";
          callback = raw ''
            function()
              local view = vim.fn.winsaveview()
              filter_buffer("goimports")
              vim.fn.winrestview(view)
            end
          '';
        }
      ];

      extraConfigLuaPre = ''
        -- Keep using the site confuration when it is available. These files
        -- are Vimscript owned by the system, so source them explicitly.
        local function source_if_readable(path)
          if vim.fn.filereadable(path) == 1 then
            vim.cmd.source(path)
          end
        end

        source_if_readable("/etc/vimrc")
      '';

      extraConfigLuaPost = ''
        -- Only replace a command-line abbreviation when it is the entire
        -- command, so paths and arguments containing these letters are safe.
        for from, to in pairs({ W = "w", Q = "q", Qa = "qa", X = "x" }) do
          vim.cmd.cnoreabbrev({
            args = { "<expr>", from, ([[(getcmdtype() is # ":" && getcmdline() is# "%s") ? "%s" : "%s"]]):format(from, to,from) },
          })
        end

        function filter_buffer(command)
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
      '';
    };
}
