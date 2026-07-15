import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

const execAsync = promisify(exec);

export interface GitFile {
  status: "untracked" | "staged" | "modified";
  path: string;
}

let cachedStatus: GitFile[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 500;

export async function getGitStatus(
  cwd: string,
  forceRefresh = false,
): Promise<GitFile[]> {
  const now = Date.now();
  if (!forceRefresh && cachedStatus && now - cacheTimestamp < CACHE_TTL) {
    return cachedStatus;
  }

  try {
    const { stdout } = await execAsync(
      "git status --porcelain --untracked-files=all",
      { cwd },
    );
    const files = parsePorcelain(stdout);
    cachedStatus = files;
    cacheTimestamp = now;
    return files;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (error.message.includes("not a git repository")) {
      throw new Error("Not a git repository");
    }
    throw error;
  }
}

function parsePorcelain(output: string): GitFile[] {
  const files: GitFile[] = [];
  for (const line of output.split("\n").filter(Boolean)) {
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    const path = line.slice(2).trimStart();

    if (x === "?") {
      files.push({ status: "untracked", path });
    } else if (x === "A" || x === "M") {
      files.push({ status: "staged", path });
    } else if (y === "M" || y === "D") {
      files.push({ status: "modified", path });
    }
  }
  return files;
}

export function clearCache(): void {
  cachedStatus = null;
  cacheTimestamp = 0;
}

export async function addFile(cwd: string, path: string): Promise<void> {
  await execAsync(`git add -- "${path}"`, { cwd });
  clearCache();
}

export async function unstageFile(cwd: string, path: string): Promise<void> {
  await execAsync(`git reset HEAD -- "${path}"`, { cwd });
  clearCache();
}

export async function addAllUntracked(cwd: string): Promise<void> {
  await execAsync("git add .", { cwd });
  clearCache();
}

export async function commit(cwd: string, message: string): Promise<void> {
  // Temp file avoids shell injection from user-supplied commit message
  const tmpFile = join(cwd, ".git", "COMMIT_EDITMSG.tmp");
  await writeFile(tmpFile, message, "utf-8");
  try {
    await execAsync(`git commit -F "${tmpFile}"`, { cwd });
    clearCache();
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

export async function push(cwd: string): Promise<void> {
  await execAsync("git push", { cwd });
}

export async function getRemotes(cwd: string): Promise<string> {
  try {
    const { stdout } = await execAsync("git remote -v", { cwd });
    return stdout.trim() || "No remotes configured";
  } catch {
    return "No remotes configured";
  }
}

export async function getFileDiff(
  cwd: string,
  path: string,
): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `git diff --color=always -- "${path}"`,
      { cwd },
    );
    return stdout || "No unstaged changes";
  } catch {
    return "[Error reading diff]";
  }
}

export async function getStagedDiff(
  cwd: string,
  path: string,
): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `git diff --cached --color=always -- "${path}"`,
      { cwd },
    );
    if (stdout) return stdout;
    const { stdout: content } = await execAsync(`git show :"${path}"`, {
      cwd,
    });
    return content || "(empty file)";
  } catch {
    return "[Error reading staged content]";
  }
}

export async function getFileContent(
  cwd: string,
  path: string,
): Promise<string> {
  try {
    const resolved = path.startsWith("/") ? path : join(cwd, path);
    const content = await readFile(resolved, "utf-8");
    return content || "(empty file)";
  } catch {
    return "[Error reading file]";
  }
}