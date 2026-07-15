import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchesKey, Key } from "@earendil-works/pi-tui";
import { getGitStatus, addFile, addAllUntracked, unstageFile, commit, push, getRemotes } from "./state.js";
import { GitViewer, BorderFrame } from "./viewer.js";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("git-tui", {
    description: "Git operations TUI",
    handler: async (args, ctx) => {
      const diffCache = new Map<string, string>();
      const runTui = async (): Promise<"commit" | "push" | "commitpush" | "remotes" | null> => {
        let files = await getGitStatus(ctx.cwd).catch((err) => {
          ctx.ui.notify(err.message, "error");
          return [] as Awaited<ReturnType<typeof getGitStatus>>;
        });

        return ctx.ui.custom<"commit" | "push" | "commitpush" | "remotes" | null>(
          (tui, theme, _kb, done) => {
            const viewer = new GitViewer(
              files,
              ctx.cwd,
              diffCache,
              { requestRender: () => tui.requestRender() },
              theme,
              async (path, status) => {
                try {
                  if (status === "staged") {
                    await unstageFile(ctx.cwd, path);
                    ctx.ui.notify(`Unstaged: ${path}`, "info");
                  } else {
                    await addFile(ctx.cwd, path);
                    ctx.ui.notify(`Staged: ${path}`, "info");
                  }
                } catch (err) {
                  const m = err instanceof Error ? err.message : String(err);
                  ctx.ui.notify(`${status === "staged" ? "Unstage" : "Stage"} failed: ${m}`, "error");
                }
              },
              // c — commit (opens input)
              () => done("commit"),
              // C — commit + push
              () => done("commitpush"),
              // p — push
              () => done("push"),
              // r — show remotes and close
              () => {
                getRemotes(ctx.cwd).then(remotes => {
                  pi.sendMessage({
                    customType: "git-remotes",
                    content: `**Remotes:**\n\n\`\`\`\n${remotes}\n\`\`\``,
                    display: true,
                  });
                });
                done("remotes");
              },
            );
            const framed = new BorderFrame(viewer, (text) =>
              theme.fg("accent", text),
            );

            if (files.length > 0)
              viewer.loadDiff(files[0].path, files[0].status);

            return {
              render: (width: number) => framed.render(width),
              invalidate: () => framed.invalidate(),
              handleInput: (data: string) => {
                viewer.handleInput(data);
                if (matchesKey(data, Key.escape)) {
                  done(null);
                }
              },
            };
          },
          {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              width: "90%",
              maxHeight: "90%",
              margin: 1,
            },
          },
        );
      };

      // Loop: run TUI, handle actions, reopen
      let action: "commit" | "push" | "commitpush" | "remotes" | null;
      while ((action = await runTui()) !== null) {
        if (action === "commit") {
          const msg = await ctx.ui.input("Enter commit message:", "");
          if (msg) {
            try {
              await commit(ctx.cwd, msg);
              ctx.ui.notify("Commit created", "info");
            } catch (err) {
              const m = err instanceof Error ? err.message : String(err);
              ctx.ui.notify(`Commit failed: ${m}`, "error");
            }
          }
        } else if (action === "push") {
          try {
            await push(ctx.cwd);
            ctx.ui.notify("Pushed to remote", "info");
          } catch (err) {
            const m = err instanceof Error ? err.message : String(err);
            ctx.ui.notify(`Push failed: ${m}`, "error");
          }
        } else if (action === "commitpush") {
          const msg = await ctx.ui.input("Enter commit message:", "");
          if (msg) {
            try {
              await commit(ctx.cwd, msg);
              await push(ctx.cwd);
              ctx.ui.notify("Committed and pushed", "info");
            } catch (err) {
              const m = err instanceof Error ? err.message : String(err);
              ctx.ui.notify(`Failed: ${m}`, "error");
            }
          }
          break;
        } else {
          // remotes or anything else — don't reopen
          break;
        }
        // Clear diff cache — file statuses may have changed
        diffCache.clear();
      }
    },
  });
}