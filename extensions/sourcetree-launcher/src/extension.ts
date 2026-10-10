import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { findGitRoot, resolveSourceTreeApp, resolveStreeCli } from "./sourcetree.js";

interface Repo {
  name: string;
  path: string;
}

let statusItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  statusItem.command = "sourcetree.open";
  statusItem.name = "SourceTree";
  syncStatusBar();
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("sourcetree.open", () => {
      void openActiveRepo();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshStatusBar();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void refreshStatusBar();
    }),
  );

  void refreshStatusBar();
}

export function deactivate(): void {}

async function openActiveRepo(): Promise<void> {
  const repos = await listWorkspaceRepos();
  const current = await currentRepoPath(repos);
  if (current) {
    openSourceTree(current);
    return;
  }
  if (repos.length === 0) {
    const folders = localFolders();
    void vscode.window.showWarningMessage(
      folders.length === 0 ? "请先打开一个项目文件夹。" : "当前工作区里没有 Git 仓库。",
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    repos.map((repo) => ({ label: repo.name, description: repo.path, path: repo.path })),
    { placeHolder: "选择要在 SourceTree 中打开的仓库" },
  );
  if (picked) {
    openSourceTree(picked.path);
  }
}

function openSourceTree(repoPath: string): void {
  const reason = unavailableReason();
  if (reason) {
    void vscode.window.showErrorMessage(reason);
    return;
  }

  const appPath = resolveSourceTreeApp();
  const stree = appPath ? resolveStreeCli(appPath) : undefined;
  if (!stree || !fs.existsSync(stree)) {
    void vscode.window.showErrorMessage("未找到 SourceTree 的 stree 命令。请重新安装 /Applications/SourceTree.app。");
    return;
  }

  if (statusItem) {
    statusItem.text = "$(loading~spin) SourceTree";
  }

  execFile(stree, [repoPath], (error) => {
    if (error) {
      void vscode.window.showErrorMessage(`无法打开 SourceTree：${error.message}`);
    }
    syncStatusBar();
  }).unref();
}

async function refreshStatusBar(): Promise<void> {
  const repos = await listWorkspaceRepos();
  const current = await currentRepoPath(repos);
  syncStatusBar(current);
}

function syncStatusBar(repoPath?: string): void {
  if (!statusItem) {
    return;
  }
  statusItem.text = "$(source-control) SourceTree";
  const reason = unavailableReason();
  statusItem.tooltip = reason ?? (repoPath ? `在 SourceTree 中打开 ${repoPath}` : "打开当前 Git 仓库");
}

function localFolders(): readonly vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file");
}

function activeFolderPath(): string | undefined {
  const folders = localFolders();
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === "file") {
    const match = vscode.workspace.getWorkspaceFolder(active);
    if (match && folders.includes(match)) {
      return match.uri.fsPath;
    }
    return path.dirname(active.fsPath);
  }
  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }
  return undefined;
}

async function listWorkspaceRepos(): Promise<Repo[]> {
  const seen = new Set<string>();
  const repos: Repo[] = [];
  for (const folder of localFolders()) {
    const root = await findGitRoot(folder.uri.fsPath);
    if (!root || seen.has(root)) {
      continue;
    }
    seen.add(root);
    repos.push({ name: path.basename(root), path: root });
  }
  return repos;
}

async function currentRepoPath(repos: readonly Repo[]): Promise<string | undefined> {
  const folder = activeFolderPath();
  const root = folder ? await findGitRoot(folder) : undefined;
  if (root) {
    return root;
  }
  return repos.length === 1 ? repos[0].path : undefined;
}

function unavailableReason(): string | undefined {
  if (process.platform !== "darwin") {
    return "打开本机 SourceTree 目前只支持 macOS。";
  }
  if (vscode.env.remoteName) {
    return "当前是远程窗口，SourceTree 只能打开本机仓库。";
  }
  const appPath = resolveSourceTreeApp();
  if (!appPath) {
    return "未找到 SourceTree。请先安装到 /Applications/SourceTree.app。";
  }
  if (!fs.existsSync(resolveStreeCli(appPath))) {
    return "未找到 SourceTree 的 stree 命令。请重新安装 /Applications/SourceTree.app。";
  }
  return undefined;
}
