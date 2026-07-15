import { matchesKey, Key, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getFileDiff, getStagedDiff, getGitStatus } from "./state.js";
import type { GitFile } from "./state.js";

const VISIBLE_LINES = 30;

function getDisplayPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? "~" + path.slice(home.length) : path;
}

export class BorderFrame implements Component {
  constructor(
    private readonly child: Component,
    private readonly borderColor: (text: string) => string,
  ) {}

  invalidate(): void {
    this.child.invalidate();
  }

  render(width: number): string[] {
    if (width <= 4) return this.child.render(width);

    const innerWidth = Math.max(1, width - 2);
    const top = this.borderColor(`┌${"─".repeat(innerWidth)}┐`);
    const bottom = this.borderColor(`└${"─".repeat(innerWidth)}┘`);
    const childLines = this.child.render(innerWidth);
    const body = childLines.map((line) => {
      const safe = truncateToWidth(line, innerWidth, "", true);
      return this.borderColor("│") + safe + this.borderColor("│");
    });

    return [top, ...body, bottom];
  }
}

export class GitViewer {
  private selected = 0;
  private fileScrollOffset = 0;
  private contentScrollOffset = 0;
  private focusedPane: 'left' | 'right' = 'left';
  private splitRatio = 0.4;
  private lastLines?: string[];
  private lastWidth?: number;

  constructor(
    private files: GitFile[],
    private cwd: string,
    private diffCache: Map<string, string>,
    private tui: { requestRender: () => void },
    private theme: Theme,
    private onToggleFile: (path: string, status: GitFile["status"]) => Promise<void>,
    private onCommit: () => void,
    private onCommitPush: () => void,
    private onPush: () => void,
    private onRemotes: () => void,
  ) {}

  invalidate(): void {
    this.lastLines = undefined;
    this.lastWidth = undefined;
  }

  async loadDiff(path: string, status: GitFile["status"]): Promise<void> {
    const cacheKey = status === "staged" ? `staged:${path}` : status === "untracked" ? `content:${path}` : `unstaged:${path}`;
    if (this.diffCache.has(cacheKey)) return;
    try {
      let content: string;
      if (status === "staged") {
        content = await getStagedDiff(this.cwd, path);
      } else if (status === "untracked") {
        const { getFileContent } = await import("./state.js");
        content = await getFileContent(this.cwd, path);
      } else {
        content = await getFileDiff(this.cwd, path);
      }
      this.diffCache.set(cacheKey, content);
    } catch {
      this.diffCache.set(cacheKey, "[Error reading content]");
    }
    this.invalidate();
    this.tui.requestRender();
  }

  private async toggleAndRefresh(file: GitFile): Promise<void> {
    if (!file) return;

    // Clear stale cache entries for this file
    const oldKeys = [...this.diffCache.keys()].filter(k => k.endsWith(file.path));
    for (const k of oldKeys) this.diffCache.delete(k);

    await this.onToggleFile(file.path, file.status);

    // Refresh file list
    this.files = await getGitStatus(this.cwd, true);
    this.adjustFileScroll();
    this.invalidate();

    // Re-load diff for selected file (status may have changed)
    const cur = this.files[this.selected];
    if (cur) {
      const stale = [...this.diffCache.keys()].filter(k => k.endsWith(cur.path));
      for (const k of stale) this.diffCache.delete(k);
      await this.loadDiff(cur.path, cur.status);
    }

    this.tui.requestRender();
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, Key.ctrl("left"))) {
      this.splitRatio = Math.max(0.15, this.splitRatio - 0.05);
      this.invalidate();
      this.tui.requestRender();
      return true;
    }
    if (matchesKey(data, Key.ctrl("right"))) {
      this.splitRatio = Math.min(0.75, this.splitRatio + 0.05);
      this.invalidate();
      this.tui.requestRender();
      return true;
    }
    if (matchesKey(data, Key.left) || data === "h") {
      this.focusedPane = 'left';
      this.invalidate();
      this.tui.requestRender();
      return true;
    }
    if (matchesKey(data, Key.right) || data === "l") {
      this.focusedPane = 'right';
      this.invalidate();
      this.tui.requestRender();
      return true;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      if (this.focusedPane === 'left') {
        this.move(-1);
      } else {
        this.scrollContent(-1);
      }
      return true;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      if (this.focusedPane === 'left') {
        this.move(1);
      } else {
        this.scrollContent(1);
      }
      return true;
    }
    if (data === "a") {
      const file = this.files[this.selected];
      if (file) this.toggleAndRefresh(file);
      return true;
    }
    if (data === "A") {
      const staged = this.files.filter(f => f.status === "staged");
      const unstaged = this.files.filter(f => f.status !== "staged");
      (async () => {
        // Batch: unstage + stage in parallel, then single refresh
        const promises = [
          ...staged.map(f => this.onToggleFile(f.path, f.status)),
          ...unstaged.map(f => this.onToggleFile(f.path, f.status)),
        ];
        await Promise.all(promises);
        // Single refresh after all operations
        this.files = await getGitStatus(this.cwd, true);
        this.adjustFileScroll();
        // Clear all diff cache — statuses changed
        this.diffCache.clear();
        this.invalidate();
        const cur = this.files[this.selected];
        if (cur) await this.loadDiff(cur.path, cur.status);
        this.tui.requestRender();
      })();
      return true;
    }
    if (data === "c") {
      this.onCommit();
      return true;
    }
    if (data === "C") {
      this.onCommitPush();
      return true;
    }
    if (data === "p") {
      this.onPush();
      return true;
    }
    if (data === "P") {
      // unused
      return true;
    }
    if (data === "r") {
      this.onRemotes();
      return true;
    }
    if (data === "\x1b[5~") {
      if (this.focusedPane === 'left') {
        this.move(-20);
      } else {
        this.scrollContent(-20);
      }
      return true;
    }
    if (data === "\x1b[6~") {
      if (this.focusedPane === 'left') {
        this.move(20);
      } else {
        this.scrollContent(20);
      }
      return true;
    }
    return false;
  }

  getSelectedFile(): GitFile | null {
    return this.files[this.selected] ?? null;
  }

  private move(delta: number): void {
    const next = this.selected + delta;
    if (next >= 0 && next < this.files.length) {
      this.selected = next;
      this.adjustFileScroll();
      this.contentScrollOffset = 0;
      this.invalidate();
      const file = this.files[this.selected];
      if (file) {
        this.loadDiff(file.path, file.status);
      }
    }
  }

  private scrollContent(delta: number): void {
    const file = this.files[this.selected];
    if (!file) return;
    const cacheKey = file.status === "staged" ? `staged:${file.path}` : file.status === "untracked" ? `content:${file.path}` : `unstaged:${file.path}`;
    const content = this.diffCache.get(cacheKey) ?? "";
    const lines = content.split("\n");
    const next = this.contentScrollOffset + delta;
    if (next >= 0 && next < lines.length) {
      this.contentScrollOffset = next;
      this.invalidate();
      this.tui.requestRender();
    }
  }

  private adjustFileScroll(): void {
    if (this.selected < this.fileScrollOffset) {
      this.fileScrollOffset = this.selected;
    } else if (this.selected >= this.fileScrollOffset + VISIBLE_LINES) {
      this.fileScrollOffset = this.selected - (VISIBLE_LINES - 1);
    }
  }

  render(width: number): string[] {
    if (this.lastLines && this.lastWidth === width) return this.lastLines;

    const lines: string[] = [];
    const current = this.files.length > 0 ? this.files[this.selected] : null;
    const t = this.theme;

    const gutter = t.fg("borderMuted", " │ ");
    const gutterW = 3;
    const listW = Math.floor((width - gutterW) * this.splitRatio);
    const contentW = width - gutterW - listW;

    const leftLabel = this.focusedPane === 'left' ? t.bold(t.fg("accent", "> Files")) : t.bold(t.fg("muted", "  Files"));
    const rightText = current?.status === "untracked" ? "Content" : "Diff";
    const rightLabel = this.focusedPane === 'right' ? t.bold(t.fg("accent", `> ${rightText}`)) : t.bold(t.fg("muted", `  ${rightText}`));
    const lh = truncateToWidth(leftLabel, listW, "", true);
    const rh = truncateToWidth(rightLabel, contentW, "", true);
    const div = t.fg("borderMuted", `${"─".repeat(listW)}─┼─${"─".repeat(contentW)}`);
    lines.push(lh + gutter + rh);
    lines.push(div);

    let cacheKey = "";
    if (current) {
      if (current.status === "staged") cacheKey = `staged:${current.path}`;
      else if (current.status === "untracked") cacheKey = `content:${current.path}`;
      else cacheKey = `unstaged:${current.path}`;
    }
    const content = current ? (this.diffCache.get(cacheKey) ?? "[Loading...]") : "";
    const allContentLines = wrapTextWithAnsi(content, contentW);
    const contentLines = allContentLines.slice(this.contentScrollOffset, this.contentScrollOffset + VISIBLE_LINES);

    const leftFocused = this.focusedPane === 'left';
    const max = VISIBLE_LINES;

    for (let i = 0; i < max; i++) {
      let left = " ".repeat(listW);
      const fileIdx = this.fileScrollOffset + i;
      if (fileIdx < this.files.length) {
        const f = this.files[fileIdx];
        const sel = fileIdx === this.selected;

        let statusColor: string;
        let pathColor: string;
        switch (f.status) {
          case "untracked":
            statusColor = t.fg("error", "??");
            pathColor = t.fg("error", f.path);
            break;
          case "staged":
            statusColor = t.fg("success", "A ");
            pathColor = t.fg("success", f.path);
            break;
          case "modified":
            statusColor = t.fg("warning", " M");
            pathColor = t.fg("warning", f.path);
            break;
          default:
            statusColor = "  ";
            pathColor = f.path;
        }

        const displayPath = getDisplayPath(pathColor);
        const selMarker = sel ? t.bold("▶ ") : "  ";
        const coloredLine = statusColor + " " + selMarker + displayPath;
        left = truncateToWidth(coloredLine, listW, " ", true);
      }

      let right = "";
      if (i < contentLines.length) {
        const contentText = `  ${contentLines[i]}`;
        right = truncateToWidth(contentText, contentW, " ", true);
      }

      lines.push(left + gutter + right);
    }

    lines.push("─".repeat(width));
    lines.push(t.fg("dim", "↑/↓ navigate • ->/<- switch pane • Ctrl+←/→ resize • a add/toggle • A add all • C commit+push • p push • r remotes • Esc close"));

    this.lastLines = lines;
    this.lastWidth = width;
    return lines;
  }
}
