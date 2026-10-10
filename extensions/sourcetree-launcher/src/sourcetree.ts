import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** macOS 上 SourceTree 的常见安装路径。默认卷不区分大小写，两个名字指向同一应用。 */
export const SOURCETREE_APP_CANDIDATES = [
  "/Applications/SourceTree.app",
  "/Applications/Sourcetree.app",
] as const;

export const GIT_BIN = "/usr/bin/git";

export function resolveSourceTreeApp(
  candidates: readonly string[] = SOURCETREE_APP_CANDIDATES,
  exists: (candidate: string) => boolean = (candidate) => fs.existsSync(candidate),
): string | undefined {
  return candidates.find((candidate) => exists(candidate));
}

export function resolveStreeCli(appPath: string): string {
  return path.join(appPath, "Contents", "Resources", "stree");
}

export function parseGitRoot(stdout: string): string | undefined {
  const root = stdout.trim();
  return root.startsWith("/") ? root : undefined;
}

export function findGitRoot(start: string, gitBin = GIT_BIN): Promise<string | undefined> {
  if (!start.startsWith("/")) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    execFile(
      gitBin,
      ["-C", start, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
      (error, stdout) => {
        resolve(error ? undefined : parseGitRoot(String(stdout)));
      },
    );
  });
}
