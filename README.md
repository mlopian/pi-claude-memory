# pi-claude-memory

Give [pi](https://pi.dev) access to the memory that [Claude Code](https://code.claude.com) already keeps on your machine, so both agents share one source of truth.

The extension does three things:

1. Injects your global `~/.claude/CLAUDE.md`, the repository `CLAUDE.md`, and the project memory stored in `~/.claude/projects/<slug>/memory/` into every pi prompt.
2. Adds `/remember` and `/remember-globally` so pi can write memory back in the exact format Claude Code expects.
3. Optionally blocks the agent from editing `CLAUDE.md` files directly, so memory always goes through the commands.

## Install

```bash
pi install git:github.com/mlopian/pi-claude-memory@v0.1.1
```

Recommended companion step: symlink pi's global context file to your Claude Code rules, so the global rules still load if the extension is ever disabled.

```bash
ln -s ~/.claude/CLAUDE.md ~/.pi/agent/AGENTS.md
```

## Commands

```
/remember [--type=<type>] [text]
/remember-globally [text]
```

`/remember` writes a project memory to `~/.claude/projects/<slug>/memory/`, creating the memory file and adding an entry to `MEMORY.md`. `--type` accepts `feedback` (default), `project`, `user`, or `reference`. Memories of type `feedback` and `project` are expected to carry `**Why:**` and `**How to apply:**` lines.

`/remember-globally` appends a section to the global `CLAUDE.md`.

Both commands accept the memory text inline. Called without text, they ask the model to distill one memory from the recent transcript and show a preview for confirmation. That fallback needs an interactive session; in print or JSON mode, pass the text inline.

Writing the same memory twice updates the existing file instead of creating a duplicate, and keeps the original `originSessionId`.

## What gets injected

| Source | Injected |
|---|---|
| `~/.claude/CLAUDE.md` | in full |
| `<repo>/CLAUDE.md` | in full, even when pi already loaded an `AGENTS.md` from the same directory |
| `MEMORY.md` index | in full |
| memories of type `feedback` and `user` | body in full |
| memories of type `project` and `reference` | index entry only, the model reads the file when it needs it |

Files that pi already loaded natively are skipped, compared by real path, so a symlinked `AGENTS.md` does not produce a duplicate copy.

Memory directories are resolved from the current working directory, the repository root, and, inside a git worktree, the main repository. This matters because Claude Code stores memory per launch directory: a session started in `repo/apps/web` writes to a different slug than one started in `repo`.

Content is re-read whenever the underlying files change, so a memory written with `/remember` applies from the next prompt without `/reload`.

## Configuration

Optional, in `~/.pi/agent/claude-memory.json` (global) or `.pi/claude-memory.json` (project, loaded after the project is trusted). Project values override global ones. Defaults:

```json
{
  "claudeDir": "~/.claude",
  "scope": "gitRoot",
  "inject": {
    "full": ["feedback", "user"],
    "indexOnly": ["project", "reference"],
    "projectContextFile": true,
    "globalContextFile": true
  },
  "budget": {
    "maxBytes": 65536,
    "warnOnExceed": true
  },
  "guard": {
    "blockClaudeMdWrites": "project"
  }
}
```

- `claudeDir`: where Claude Code keeps its configuration. `CLAUDE_CONFIG_DIR` overrides the default and is itself overridden by this setting.
- `scope`: `gitRoot` writes project memory to the repository root slug, `cwd` writes to the exact working directory slug.
- `budget.maxBytes`: when the assembled block exceeds this, full bodies are dropped and only the index is injected. Nothing is truncated mid-file.
- `guard.blockClaudeMdWrites`: which `CLAUDE.md` files the agent may not write with its own tools.

| Value | `<repo>/CLAUDE.md` | global `CLAUDE.md` |
|---|---|---|
| `all` | blocked | blocked |
| `project` (default) | blocked | allowed |
| `global` | allowed | blocked |
| `none` | allowed | allowed |

The guard covers the `write` and `edit` tools plus shell redirects (`>`, `>>`, `tee`) in `bash`. The commands write through the filesystem directly, so they are never blocked.

## Limitations

- The layout of `~/.claude/projects/<slug>/memory/` is an implementation detail of Claude Code and can change. The parser preserves unknown frontmatter fields and the index is edited one section at a time, so a format change degrades rather than corrupts.
- Injected memory is part of the system prompt. It is strong context, not enforcement. Only the `tool_call` guard actually prevents an action.
- `pi --no-extensions` disables all of this. The `AGENTS.md` symlink above is the fallback for global rules.
- Memory files in subdirectories of a repository are not scanned. Only the directories listed above are read.

## Development

```bash
npm install
npm test
npm run typecheck
pi -e ./extensions/index.ts
```

## License

MIT
