#!/usr/bin/env python3
"""Show useful information about the current Claude Code session."""

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude"

# -- ANSI colours -------------------------------------------------------------

RESET  = "\033[0m"
CYAN   = "\033[36m"
GREEN  = "\033[32m"
YELLOW = "\033[33m"
RED    = "\033[31m"


def bar_color(pct: float) -> str:
    """Return an ANSI color code for a usage bar based on thresholds."""
    if pct >= 90:
        return RED
    if pct >= 70:
        return YELLOW
    return GREEN


def osc8_link(url: str, text: str) -> str:
    """Wrap text in an OSC 8 hyperlink (supported by iTerm2, Kitty, WezTerm)."""
    return f"\033]8;;{url}\a{text}\033]8;;\a"


# -- helpers ------------------------------------------------------------------

def fmt_tokens(n: int) -> str:
    if n >= 1_000_000:
        return f"{n / 1_000_000:.2f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


def fmt_duration(ms: float) -> str:
    s = ms / 1000
    if s < 60:
        return f"{s:.0f}s"
    if s < 3600:
        return f"{s/60:.0f}m {s%60:.0f}s"
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    return f"{h}h {m}m"


def fmt_ts(ts_str: str) -> str:
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ts_str


def short_model(model: str) -> str:
    return model.replace("claude-", "").replace("-20", " (20") + (")" if "20" in model else "")


_PATH_DISPLAY_MAX = 30


def fmt_path(path_str: str) -> str:
    """Format a path for display, abbreviating intermediary components only if too long.

    Short paths are shown as-is (with ~ for home):
      /Users/pllong/nix-config => ~/nix-config

    Long paths have intermediary components replaced with their first character:
      ~/git-repos/nix-config => ~/g/nix-config   (if over limit)
      /home/user/foo/bar/baz => /h/u/f/b/baz     (if over limit)
    """
    p = Path(path_str)
    try:
        display = "~/" + str(p.relative_to(Path.home()))
    except ValueError:
        display = path_str

    if len(display) <= _PATH_DISPLAY_MAX:
        return display

    # Abbreviate intermediary components to their first character
    try:
        rel    = p.relative_to(Path.home())
        anchor = "~"
        parts  = list(rel.parts)
    except ValueError:
        anchor = ""
        parts  = list(p.parts)  # parts[0] is '/' on Unix

    if not anchor:
        anchor = parts[0]  # leading '/'
        parts  = parts[1:]

    if len(parts) <= 1:
        return (anchor + "/".join(parts)) if parts else anchor

    abbreviated = [c[0] for c in parts[:-1]] + [parts[-1]]
    sep = "" if anchor in ("/", "") else "/"
    return anchor + sep + "/".join(abbreviated)


# -- git ----------------------------------------------------------------------

def git_run(*args, cwd=None):
    result = subprocess.run(
        ["git"] + list(args),
        capture_output=True, text=True,
        cwd=cwd or os.getcwd(),
    )
    return result.stdout.strip() if result.returncode == 0 else None


def get_git_info():
    root   = git_run("rev-parse", "--show-toplevel")
    branch = git_run("branch", "--show-current")
    status = git_run("status", "--short")
    log    = git_run("log", "--oneline", "-5")
    # staged and modified counted separately for colour-coded display
    staged_out   = git_run("diff", "--cached", "--numstat") or ""
    modified_out = git_run("diff", "--numstat") or ""
    remote       = git_run("remote", "get-url", "origin")
    return {
        "root":     root,
        "branch":   branch,
        "status":   [l for l in (status or "").splitlines() if l],
        "commits":  [l for l in (log or "").splitlines() if l],
        "staged":   len([l for l in staged_out.splitlines() if l]),
        "modified": len([l for l in modified_out.splitlines() if l]),
        "remote":   remote,
    }


# -- project dir --------------------------------------------------------------

def project_dir_for(path: str) -> Path | None:
    encoded = path.replace("/", "-")
    d = CLAUDE_DIR / "projects" / encoded
    return d if d.exists() else None


# -- session JSONL parsing ----------------------------------------------------

def parse_jsonl(path: Path) -> list[dict]:
    lines = []
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        lines.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    except OSError:
        pass
    return lines


def summarise_session(path: Path) -> dict | None:
    records = parse_jsonl(path)
    if not records:
        return None

    cost = 0.0
    input_tok = output_tok = cache_read = cache_write = 0
    user_msgs = assistant_msgs = tool_calls = 0
    models: set[str] = set()
    first_ts = last_ts = None
    cwd = branch = version = None

    for r in records:
        ts = r.get("timestamp")
        if ts:
            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if first_ts is None or dt < first_ts:
                    first_ts = dt
                if last_ts is None or dt > last_ts:
                    last_ts = dt
            except Exception:
                pass

        cost += r.get("costUSD", 0) or 0

        msg = r.get("message", {})
        usage = msg.get("usage", {})
        if usage:
            input_tok   += usage.get("input_tokens", 0) or 0
            output_tok  += usage.get("output_tokens", 0) or 0
            cache_read  += usage.get("cache_read_input_tokens", 0) or 0
            cache_write += usage.get("cache_creation_input_tokens", 0) or 0

        model = msg.get("model")
        if model:
            models.add(model)

        rtype = r.get("type", "")
        if rtype == "user":
            # count tool results as tool calls, plain content as user msgs
            content = msg.get("content", "")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        tool_calls += 1
                    else:
                        user_msgs += 1
            else:
                user_msgs += 1
        elif rtype == "assistant":
            assistant_msgs += 1
            content = msg.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        tool_calls += 1

        if cwd is None:
            cwd = r.get("cwd")
        if branch is None:
            branch = r.get("gitBranch")
        if version is None:
            version = r.get("version")

    duration_ms = None
    if first_ts and last_ts:
        duration_ms = (last_ts - first_ts).total_seconds() * 1000

    return {
        "file":          path.name,
        "mtime":         path.stat().st_mtime,
        "cost":          cost,
        "input_tok":     input_tok,
        "output_tok":    output_tok,
        "cache_read":    cache_read,
        "cache_write":   cache_write,
        "user_msgs":     user_msgs,
        "assistant_msgs":assistant_msgs,
        "tool_calls":    tool_calls,
        "models":        sorted(models),
        "first_ts":      first_ts,
        "last_ts":       last_ts,
        "duration_ms":   duration_ms,
        "cwd":           cwd,
        "branch":        branch,
        "version":       version,
    }


def load_sessions(project_dir: Path) -> list[dict]:
    sessions = []
    for f in sorted(project_dir.glob("*.jsonl"), key=lambda x: x.stat().st_mtime, reverse=True):
        s = summarise_session(f)
        if s:
            sessions.append(s)
    return sessions


# -- global stats cache -------------------------------------------------------

def load_stats_cache() -> dict:
    path = CLAUDE_DIR / "stats-cache.json"
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


# -- display ------------------------------------------------------------------

W = 64

def ruler(char="-"):
    print(char * W)

def header(title):
    ruler("=")
    print(f"  {title}")
    ruler("=")

def section(title):
    ruler()
    print(f"  {title}")
    ruler()


def print_kv(label: str, value, width=20):
    print(f"  {label:<{width}} {value}")


def weekly_usage(stats: dict) -> dict:
    """Sum dailyActivity for the last 7 calendar days."""
    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=6)).isoformat()
    msgs = sessions = tools = 0
    for day in stats.get("dailyActivity", []):
        if day.get("date", "") >= cutoff:
            msgs     += day.get("messageCount", 0)
            sessions += day.get("sessionCount", 0)
            tools    += day.get("toolCallCount", 0)
    return {"msgs": msgs, "sessions": sessions, "tools": tools}


def get_project_sessions(git: dict) -> list[dict]:
    git_root = git.get("root")
    pdir     = project_dir_for(git_root) if git_root else None
    cwd_pdir = project_dir_for(os.getcwd())
    if cwd_pdir and cwd_pdir != pdir:
        all_sessions = (load_sessions(pdir) if pdir else []) + load_sessions(cwd_pdir)
        all_sessions.sort(key=lambda s: s["mtime"], reverse=True)
    else:
        all_sessions = load_sessions(pdir) if pdir else []
    return all_sessions


def pct_bar(pct: float, width: int = 8) -> str:
    filled = round(pct * width / 100)
    return "\u2588" * filled + "\u2591" * (width - filled)


def fmt_reset(ts: int) -> str:
    """Format a unix timestamp as 'Xh Ym' until reset."""
    delta = ts - datetime.now(timezone.utc).timestamp()
    if delta <= 0:
        return "now"
    h = int(delta // 3600)
    m = int((delta % 3600) // 60)
    return f"{h}h{m:02d}m"


def status_line(data: dict = None):
    """Output a two-line status bar for Claude Code.

    Line 1 — identity: model, session, agent, project dir, worktree, git branch
    Line 2 — usage:    quota bars, context bar, cost, duration, lines changed

    Claude Code pipes a JSON blob to stdin; fall back gracefully if not present.
    """
    if data is None:
        data = {}
        if not sys.stdin.isatty():
            try:
                data = json.load(sys.stdin)
            except Exception:
                pass

    SEP = "  \u2502  "  # U+2502 BOX DRAWINGS LIGHT VERTICAL, not ASCII pipe |

    # ── line 1: identity ──────────────────────────────────────────────────────
    line1 = []

    # model name in cyan so it stands out as the primary identifier
    model = (data.get("model") or {}).get("display_name", "")
    if model:
        line1.append(f"{CYAN}[{model}]{RESET}")

    # session name only when set via --name or /rename
    session_name = data.get("session_name")
    if session_name:
        line1.append(f"\u201c{session_name}\u201d")  # U+201C/U+201D curly quotes, not ASCII "

    # agent name only when running with --agent
    agent_name = (data.get("agent") or {}).get("name")
    if agent_name:
        line1.append(f"🤖 {agent_name}")

    # project dir  (📁 is unambiguously a folder)
    workspace   = data.get("workspace") or {}
    project_dir = workspace.get("project_dir") or data.get("cwd") or ""
    if project_dir:
        line1.append(f"📁 {fmt_path(project_dir)}")

    # worktree only present during --worktree sessions
    worktree = data.get("worktree") or {}
    if worktree:
        wt_label = worktree.get("name") or worktree.get("branch") or "worktree"
        orig     = worktree.get("original_branch")
        line1.append(f"🌿 {wt_label}" + (f" \u2190 {orig}" if orig else ""))  # U+2190 LEFTWARDS ARROW, not ASCII <-

    # git: ⎇ is the standard branch/fork glyph; staged=green, modified=yellow
    git    = get_git_info()
    root   = git.get("root")
    branch = git.get("branch")
    if root or branch:
        same_as_proj = root and project_dir and Path(root) == Path(project_dir)
        root_name    = "" if same_as_proj else (Path(root).name if root else "")

        # make the repo name a clickable OSC 8 hyperlink when a remote exists;
        # convert SCP-style SSH (git@HOST:PATH) → HTTPS for any host, which
        # covers GitHub, GitLab.com, and self-hosted GitLab instances alike
        remote = git.get("remote") or ""
        if remote and root_name:
            https = re.sub(r"^git@([^:]+):", r"https://\1/", remote)
            https = re.sub(r"\.git$", "", https)
            repo_display = osc8_link(https, root_name)
        else:
            repo_display = root_name

        staged   = git.get("staged", 0)
        modified = git.get("modified", 0)
        changes  = ""
        if staged:
            changes += f" {GREEN}+{staged}{RESET}"
        if modified:
            changes += f" {YELLOW}~{modified}{RESET}"

        if repo_display and branch:
            line1.append(f"⎇ {repo_display}/{branch}{changes}")
        elif branch:
            line1.append(f"⎇ {branch}{changes}")
        elif repo_display:
            line1.append(f"⎇ {repo_display}{changes}")

    # vim mode only when vim mode is active
    vim_mode = (data.get("vim") or {}).get("mode")
    if vim_mode:
        line1.append(f"vim:{vim_mode}")

    # ── line 2: usage ─────────────────────────────────────────────────────────
    line2 = []

    # quota windows: bar colour reflects consumption level; ↺ means "resets in"
    rate_limits = data.get("rate_limits") or {}
    for window, label in [("five_hour", "5h"), ("seven_day", "7d")]:
        rl  = rate_limits.get(window) or {}
        pct = rl.get("used_percentage")
        if pct is not None:
            resets_at = rl.get("resets_at")
            reset_str = f" \u21ba{fmt_reset(resets_at)}" if resets_at else ""  # U+21BA ANTICLOCKWISE OPEN CIRCLE ARROW
            color = bar_color(pct)
            line2.append(f"⏱ {label} {color}{pct_bar(pct)}{RESET}{pct:.0f}%{reset_str}")

    # context window; ◈ suggests a bounded/windowed resource; bar colour = threshold
    ctx = data.get("context_window") or {}
    ctx_pct = ctx.get("used_percentage")
    if ctx_pct is not None:
        over  = data.get("exceeds_200k_tokens")
        color = bar_color(ctx_pct)
        line2.append(f"◈ {color}{pct_bar(ctx_pct)}{RESET}{ctx_pct:.0f}%" + (" ⚠" if over else ""))

    # session cost + elapsed time + lines of code changed
    cost_data = data.get("cost") or {}
    cost   = cost_data.get("total_cost_usd")
    dur_ms = cost_data.get("total_duration_ms")
    la     = cost_data.get("total_lines_added")
    lr     = cost_data.get("total_lines_removed")
    if cost is not None or dur_ms is not None:
        sess_parts = []
        if cost is not None:
            sess_parts.append(f"💰${cost:.4f}")
        if dur_ms:
            sess_parts.append(fmt_duration(dur_ms))
        if la or lr:
            sess_parts.append(f"+{la or 0}/-{lr or 0} lines")
        line2.append("  ".join(sess_parts))

    if line1:
        print(SEP.join(line1))
    if line2:
        print(SEP.join(line2))
    if not line1 and not line2:
        print("no data")


_CLAUDE_STATUS_KEYS = frozenset(("model", "rate_limits", "context_window", "cost"))


def main():
    # Auto-detect Claude Code status JSON piped to stdin
    if not sys.stdin.isatty():
        try:
            data = json.load(sys.stdin)
            if isinstance(data, dict) and _CLAUDE_STATUS_KEYS & data.keys():
                status_line(data)
                return
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="Claude Code session info")
    parser.add_argument("--status-line", action="store_true",
                        help="Output a compact single line for the status bar")
    args = parser.parse_args()

    if args.status_line:
        status_line()
        return

    header("CLAUDE CODE SESSION INFO")

    # -- git
    git = get_git_info()
    section("GIT")
    if git["root"]:
        print_kv("Repo:",   git["root"])
        print_kv("Branch:", git["branch"] or "unknown")
        status = git["status"]
        if status:
            print_kv("Changed files:", len(status))
            for s in status[:6]:
                print(f"    {s}")
            if len(status) > 6:
                print(f"    ... and {len(status)-6} more")
        else:
            print_kv("Changed files:", "none")
        if git["commits"]:
            print_kv("Recent commits:", "")
            for c in git["commits"]:
                print(f"    {c}")
    else:
        print("  (not a git repo)")

    # -- global stats
    stats = load_stats_cache()
    if stats:
        section("LIFETIME STATS  (all projects)")
        print_kv("Total sessions:", stats.get("totalSessions", "?"))
        print_kv("Total messages:", stats.get("totalMessages", "?"))

        model_usage = stats.get("modelUsage", {})
        if model_usage:
            print_kv("Models used:", "")
            for model, u in model_usage.items():
                in_t  = fmt_tokens(u.get("inputTokens", 0))
                out_t = fmt_tokens(u.get("outputTokens", 0))
                cr    = fmt_tokens(u.get("cacheReadInputTokens", 0))
                cost  = u.get("costUSD", 0)
                label = short_model(model)
                print(f"    {label:<30} in={in_t:>7}  out={out_t:>7}  cache={cr:>7}  ${cost:.4f}")

        longest = stats.get("longestSession")
        if longest:
            lts = fmt_ts(longest.get("timestamp", ""))
            ldu = fmt_duration(longest.get("duration", 0))
            lmc = longest.get("messageCount", "?")
            print_kv("Longest session:", f"{ldu}, {lmc} msgs  ({lts})")

        daily = stats.get("dailyActivity", [])
        if daily:
            print_kv("Daily activity:", "")
            for day in sorted(daily, key=lambda d: d["date"], reverse=True)[:7]:
                print(f"    {day['date']}  msgs={day['messageCount']:>4}  "
                      f"sessions={day['sessionCount']}  tools={day['toolCallCount']}")

    # -- project sessions
    all_sessions = get_project_sessions(git)

    if all_sessions:
        section(f"PROJECT SESSIONS  ({len(all_sessions)} total)")

        total_cost = sum(s["cost"] for s in all_sessions)
        total_in   = sum(s["input_tok"] for s in all_sessions)
        total_out  = sum(s["output_tok"] for s in all_sessions)
        total_cr   = sum(s["cache_read"] for s in all_sessions)
        print_kv("Total cost:",          f"${total_cost:.4f}")
        print_kv("Total input tokens:",  fmt_tokens(total_in))
        print_kv("Total output tokens:", fmt_tokens(total_out))
        print_kv("Cache read tokens:",   fmt_tokens(total_cr))

        section("RECENT SESSIONS  (latest 5)")
        for i, s in enumerate(all_sessions[:5]):
            mtime_str = datetime.fromtimestamp(s["mtime"]).strftime("%Y-%m-%d %H:%M")
            sid = s["file"][:8]
            current = " <- current" if i == 0 else ""
            print(f"\n  [{i+1}] {mtime_str}  id={sid}...{current}")
            if s["models"]:
                print(f"       Model:    {', '.join(short_model(m) for m in s['models'])}")
            if s["version"]:
                print(f"       CC ver:   {s['version']}")
            print(f"       Cost:     ${s['cost']:.4f}")
            print(f"       Tokens:   in={fmt_tokens(s['input_tok'])}  out={fmt_tokens(s['output_tok'])}  "
                  f"cache_read={fmt_tokens(s['cache_read'])}")
            print(f"       Messages: user={s['user_msgs']}  assistant={s['assistant_msgs']}  tool_calls={s['tool_calls']}")
            if s["duration_ms"]:
                print(f"       Duration: {fmt_duration(s['duration_ms'])}")
            if s["branch"]:
                print(f"       Branch:   {s['branch']}")
    else:
        section("PROJECT SESSIONS")
        print("  No session data found for this project.")

    ruler("=")
    print()


if __name__ == "__main__":
    main()
