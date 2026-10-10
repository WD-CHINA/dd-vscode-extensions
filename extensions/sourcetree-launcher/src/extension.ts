import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { findGitRoot, resolveSourceTreeApp, resolveStreeCli } from "./sourcetree.js";

const VIEW_ID = "sourcetree.sidebar";
const REVEALED_KEY = "sourcetree.revealedActivityBar";

interface Repo {
  name: string;
  path: string;
}

let statusItem: vscode.StatusBarItem | undefined;
let sidebar: SourceTreeSidebarProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  sidebar = new SourceTreeSidebarProvider();
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  statusItem.command = "sourcetree.open";
  statusItem.name = "SourceTree";
  syncStatusBar();
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.window.registerWebviewViewProvider(VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("sourcetree.open", () => {
      void openActiveRepo();
    }),
    vscode.commands.registerCommand("sourcetree.openHere", (resource?: vscode.Uri) => {
      void openResource(resource);
    }),
    vscode.commands.registerCommand("sourcetree.revealSidebar", () => revealSidebar()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void sidebar?.refresh();
      void refreshStatusBar();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      void sidebar?.refresh();
      void refreshStatusBar();
    }),
  );

  void refreshStatusBar();

  if (!context.globalState.get<boolean>(REVEALED_KEY, false)) {
    await context.globalState.update(REVEALED_KEY, true);
    await revealSidebar();
  }
}

export function deactivate(): void {}

class SourceTreeSidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private repos: readonly Repo[] = [];
  private refreshId = 0;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void this.onMessage(message);
    });
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const refreshId = ++this.refreshId;
    const repos = await listWorkspaceRepos();
    if (refreshId !== this.refreshId || !this.view) {
      return;
    }
    this.repos = repos;
    const current = await currentRepoPath(repos);
    this.view.webview.html = renderSidebar(repos, current);
  }

  private async onMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }
    const request = message as { type?: unknown; index?: unknown };
    if (request.type !== "open" || typeof request.index !== "number" || !Number.isInteger(request.index)) {
      return;
    }
    const repo = this.repos[request.index];
    if (repo) {
      openSourceTree(repo.path);
    }
  }
}

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

async function openResource(resource: vscode.Uri | undefined): Promise<void> {
  const start = directoryFor(resource) ?? activeFolderPath();
  if (!start) {
    void vscode.window.showWarningMessage("请先打开一个项目文件夹。");
    return;
  }
  const root = await findGitRoot(start);
  if (!root) {
    void vscode.window.showWarningMessage("这个位置不在 Git 仓库里。");
    return;
  }
  openSourceTree(root);
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

async function revealSidebar(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.sourcetree");
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

function directoryFor(resource: vscode.Uri | undefined): string | undefined {
  if (!resource || resource.scheme !== "file") {
    return undefined;
  }
  try {
    return fs.statSync(resource.fsPath).isDirectory() ? resource.fsPath : path.dirname(resource.fsPath);
  } catch {
    return undefined;
  }
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

function renderSidebar(repos: readonly Repo[], current: string | undefined): string {
  const nonce = randomBytes(16).toString("hex");
  const reason = unavailableReason();
  const body = reason
    ? `<p class="empty">${escapeHtml(reason)}</p>`
    : localFolders().length === 0
      ? `<p class="empty">请先用「文件 &gt; 打开文件夹」打开一个项目。</p>`
      : repos.length === 0
        ? `<p class="empty">当前工作区里没有 Git 仓库。</p>`
        : renderRepos(repos, current);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      margin: 0;
      padding: 14px 12px 18px;
      color: var(--vscode-foreground);
      background: transparent;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .header {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 14px;
    }
    .mark {
      width: 28px;
      height: 28px;
      flex: none;
      display: grid;
      place-items: center;
      border-radius: 8px;
      color: var(--vscode-charts-blue, var(--vscode-button-foreground));
      background: color-mix(in srgb, var(--vscode-charts-blue, var(--vscode-button-background)) 16%, var(--vscode-input-background));
      border: 1px solid color-mix(in srgb, var(--vscode-charts-blue, var(--vscode-widget-border)) 45%, transparent);
    }
    .title {
      margin: 0;
      font-size: 13px;
      font-weight: 650;
    }
    .subtitle {
      margin: 2px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .card {
      margin: 0 0 10px;
      padding: 12px;
      border-radius: 8px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    .card.current {
      border-color: color-mix(in srgb, var(--vscode-charts-blue, var(--vscode-focusBorder)) 55%, var(--vscode-widget-border, transparent));
    }
    .name-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .name {
      margin: 0;
      font-size: 13px;
      font-weight: 650;
    }
    .badge {
      flex: none;
      padding: 1px 6px;
      border-radius: 999px;
      color: var(--vscode-charts-blue, var(--vscode-button-foreground));
      background: color-mix(in srgb, var(--vscode-charts-blue, var(--vscode-button-background)) 16%, transparent);
      font-size: 10px;
    }
    .path {
      margin: 6px 0 0;
      color: var(--vscode-descriptionForeground);
      font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
      font-size: 11px;
      line-height: 1.45;
      word-break: break-all;
    }
    .open {
      width: 100%;
      margin-top: 10px;
      border: 0;
      border-radius: 8px;
      padding: 8px 12px;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .open:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    .hint, .empty {
      margin: 4px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.5;
    }
    .empty {
      margin: 0;
      font-size: inherit;
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path fill="currentColor" d="M4.2 2.2a1.7 1.7 0 1 0 .08 3.4 1.7 1.7 0 0 0-.08-3.4Zm0 1.15a.55.55 0 1 1 0 1.1.55.55 0 0 1 0-1.1ZM4.2 9.4a1.7 1.7 0 1 0 .08 3.4 1.7 1.7 0 0 0-.08-3.4Zm0 1.15a.55.55 0 1 1 0 1.1.55.55 0 0 1 0-1.1ZM11.3 5.6a1.7 1.7 0 1 0 .08 3.4 1.7 1.7 0 0 0-.08-3.4Zm0 1.15a.55.55 0 1 1 0 1.1.55.55 0 0 1 0-1.1ZM5.1 5.4v4.4c.9-.4 1.8-1.2 2.5-2 .6-.08 1.3-.28 1.9-.62-.14-.28-.2-.56-.2-.84 0-.14 0-.28.06-.42-.78.28-1.6.56-2.3.78-.62-.48-1.3-.76-2-.96Z"/>
      </svg>
    </div>
    <div>
      <p class="title">SourceTree</p>
      <p class="subtitle">打开当前 Git 仓库</p>
    </div>
  </header>
  ${body}
  <p class="hint">点状态栏的 SourceTree 也可以打开。</p>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    for (const button of document.querySelectorAll(".open")) {
      button.addEventListener("click", () => {
        vscodeApi.postMessage({ type: "open", index: Number(button.dataset.open) });
      });
    }
  </script>
</body>
</html>`;
}

function renderRepos(repos: readonly Repo[], current: string | undefined): string {
  const order = repos.map((_, index) => index).sort((left, right) => {
    if (repos[left].path === current) {
      return -1;
    }
    if (repos[right].path === current) {
      return 1;
    }
    return left - right;
  });

  return order
    .map((index) => {
      const repo = repos[index];
      const isCurrent = repos.length > 1 && repo.path === current;
      return `<section class="card${isCurrent ? " current" : ""}">
        <div class="name-row">
          <p class="name">${escapeHtml(repo.name)}</p>
          ${isCurrent ? `<span class="badge">当前</span>` : ""}
        </div>
        <p class="path">${escapeHtml(repo.path)}</p>
        <button type="button" class="open" data-open="${index}">在 SourceTree 中打开</button>
      </section>`;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
