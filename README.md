# pi-git-tui

Git operations TUI extension for pi-coding-agent. Split-pane file browser with colored status indicators.

## Features

- Browse untracked (red), staged (green), modified (yellow) files in split-pane view
- Diff preview in right pane
- Stage/unstage individual files with toggle (`a`)
- Stage all / unstage all (`A`)
- Commit (`c`), commit + push (`C`), push (`p`)
- Stage-all + commit + push macro (`P`)
- View remotes (`r`)

## Usage

```
/pi git-tui
```

## Keyboard

| Key | Action |
|-----|--------|
| `↑/↓` or `k/j` | Navigate files |
| `h/l` | Switch focus between file list and diff panes |
| `Ctrl+←/→` | Resize split ratio |
| `a` | Toggle stage/unstage for selected file |
| `A` | Stage all unstaged files / unstage all staged files |
| `c` | Commit (opens input prompt, closes TUI after) |
| `C` | Commit + push (opens input prompt, closes TUI) |
| `P` | Stage all + commit + push (macro, closes TUI) |
| `p` | Push to remote (reopens TUI) |
| `r` | Show remotes (closes TUI) |
| `Esc` | Close TUI |

## Color scheme

- `??` + path → red (untracked)
- `A ` + path → green (staged)
- ` M` + path → yellow (modified)