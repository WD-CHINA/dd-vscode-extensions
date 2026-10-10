import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { buildWarpUri, WARP_APP_PATH, type WarpOpenMode } from "./warpUri.js";

const VIEW_ID = "warp.sidebar";
const MODE_KEY = "warp.openMode";
const REVEALED_KEY = "warp.revealedActivityBar";
const OWNED_DEFAULT_KEY = "warp.ownedDefaultProfile";
const PREVIOUS_DEFAULT_KEY = "warp.previousDefaultProfile";
const OWNED_AUTOMATION_KEY = "warp.ownedAutomationProfile";

let statusItem: vscode.StatusBarItem | undefined;
let sidebar: WarpSidebarProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await restoreIntegratedTerminal(context);

  sidebar = new WarpSidebarProvider(context, syncStatusBar);
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = "warp.openActive";
  statusItem.name = "Warp";
  syncStatusBar();
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.window.registerWebviewViewProvider(VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("warp.openActive", () => openActiveRoot()),
    vscode.commands.registerCommand("warp.openHere", (resource?: vscode.Uri) => {
      const target = directoryFor(resource) ?? activeRoot()?.path;
      if (!target) {
        void vscode.window.showWarningMessage("请先打开一个项目文件夹。");
        return;
      }
      openWarp(target);
    }),
    vscode.commands.registerCommand("warp.revealSidebar", () => revealSidebar()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      sidebar?.refresh();
      syncStatusBar();
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      if (localFolders().length > 1) {
        sidebar?.refresh();
      }
      syncStatusBar();
    }),
  );

  if (!context.globalState.get<boolean>(REVEALED_KEY, false)) {
    await context.globalState.update(REVEALED_KEY, true);
    await revealSidebar();
  }
}

export function deactivate(): void {}

class WarpSidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onModeChanged: () => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      void this.onMessage(message);
    });
    this.refresh();
  }

  mode(): WarpOpenMode {
    return this.context.globalState.get<string>(MODE_KEY) === "window" ? "window" : "tab";
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = renderSidebar(this.mode());
    }
  }

  private async onMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") {
      return;
    }

    const request = message as { type?: unknown; index?: unknown; mode?: unknown };
    if (request.type === "mode" && (request.mode === "tab" || request.mode === "window")) {
      await this.context.globalState.update(MODE_KEY, request.mode);
      this.refresh();
      this.onModeChanged();
      return;
    }

    if (request.type !== "open" || typeof request.index !== "number" || !Number.isInteger(request.index)) {
      return;
    }

    const folder = localFolders()[request.index];
    if (folder) {
      openWarp(folder.uri.fsPath);
    }
  }
}

function openActiveRoot(): void {
  const folders = localFolders();
  const current = activeRoot();
  if (current) {
    openWarp(current.path);
    return;
  }
  if (folders.length === 0) {
    void vscode.window.showWarningMessage("请先打开一个项目文件夹。");
    return;
  }

  void vscode.window
    .showQuickPick(
      folders.map((folder) => ({
        label: folder.name,
        description: folder.uri.fsPath,
        path: folder.uri.fsPath,
      })),
      { placeHolder: "选择要在 Warp 中打开的项目" },
    )
    .then((picked) => {
      if (picked) {
        openWarp(picked.path);
      }
    });
}

function openWarp(cwd: string): void {
  const reason = unavailableReason();
  if (reason) {
    void vscode.window.showErrorMessage(reason);
    return;
  }

  const mode = sidebar?.mode() ?? "tab";
  let uri: string;
  try {
    uri = buildWarpUri(cwd, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(message);
    return;
  }

  if (statusItem) {
    statusItem.text = "$(loading~spin) Warp";
  }

  execFile("/usr/bin/open", [uri], (error) => {
    if (error) {
      void vscode.window.showErrorMessage(`无法打开 Warp：${error.message}`);
    }
    syncStatusBar();
  }).unref();
}

function syncStatusBar(): void {
  if (!statusItem) {
    return;
  }
  const root = activeRoot();
  const mode = sidebar?.mode() === "window" ? "新窗口" : "新标签页";
  statusItem.text = "$(terminal) Warp";
  statusItem.tooltip = root
    ? `用${mode}打开 ${root.path}`
    : "打开一个项目文件夹后，可在其根目录启动 Warp";
}

async function revealSidebar(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.warp");
}

function localFolders(): readonly vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file");
}

function activeRoot(): { name: string; path: string; index: number } | undefined {
  const folders = localFolders();
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === "file") {
    const match = vscode.workspace.getWorkspaceFolder(active);
    const index = folders.findIndex((folder) => folder === match);
    if (match && index >= 0) {
      return { name: match.name, path: match.uri.fsPath, index };
    }
  }
  if (folders.length === 1) {
    return { name: folders[0].name, path: folders[0].uri.fsPath, index: 0 };
  }
  return undefined;
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
    return "打开本机 Warp 目前只支持 macOS。";
  }
  if (vscode.env.remoteName) {
    return "当前是远程窗口，Warp 只能打开本机项目。";
  }
  if (!fs.existsSync(WARP_APP_PATH)) {
    return "未找到 Warp。请先安装到 /Applications/Warp.app。";
  }
  return undefined;
}

function renderSidebar(mode: WarpOpenMode): string {
  const nonce = randomBytes(16).toString("hex");
  const reason = unavailableReason();
  const folders = localFolders();
  const current = activeRoot()?.index ?? 0;
  const body = reason
    ? `<p class="empty">${escapeHtml(reason)}</p>`
    : folders.length === 0
      ? `<p class="empty">请先用「文件 &gt; 打开文件夹」打开一个项目。</p>`
      : `${renderModeSwitch(mode)}${renderProjects(folders, current)}`;

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
      color: var(--vscode-terminal-ansiGreen, var(--vscode-charts-green, var(--vscode-button-foreground)));
      background: color-mix(in srgb, var(--vscode-terminal-ansiGreen, var(--vscode-charts-green, var(--vscode-button-background))) 16%, var(--vscode-input-background));
      border: 1px solid color-mix(in srgb, var(--vscode-terminal-ansiGreen, var(--vscode-charts-green, var(--vscode-widget-border))) 45%, transparent);
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
    .switch {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2px;
      margin: 0 0 12px;
      padding: 2px;
      border-radius: 8px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    }
    .switch button,
    .open {
      border: 0;
      font: inherit;
      cursor: pointer;
      transition: background-color 160ms ease, color 160ms ease;
    }
    .switch button {
      border-radius: 6px;
      padding: 6px 0;
      color: var(--vscode-foreground);
      background: transparent;
    }
    .switch button[aria-pressed="true"] {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .switch button:hover:not([aria-pressed="true"]) {
      background: color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    }
    .card {
      margin: 0 0 10px;
      padding: 12px;
      border-radius: 8px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--vscode-foreground) 8%, transparent);
    }
    .card.current {
      border-color: color-mix(in srgb, var(--vscode-terminal-ansiGreen, var(--vscode-charts-green, var(--vscode-focusBorder))) 55%, var(--vscode-widget-border, transparent));
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
      color: var(--vscode-terminal-ansiGreen, var(--vscode-charts-green, var(--vscode-button-foreground)));
      background: color-mix(in srgb, var(--vscode-terminal-ansiGreen, var(--vscode-charts-green, var(--vscode-button-background))) 16%, transparent);
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
      border-radius: 8px;
      padding: 8px 12px;
      font-weight: 650;
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
    .hint {
      margin: 4px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .empty {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }
    @media (prefers-reduced-motion: reduce) {
      .switch button,
      .open {
        transition: none;
      }
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16">
        <path fill="currentColor" d="M2.2 3.2 6.4 8 2.2 12.8l1.2 1.1L8.8 8 3.4 2.1 2.2 3.2Zm6.6 8.1h5v1.5h-5v-1.5Z"/>
      </svg>
    </div>
    <div>
      <p class="title">Warp</p>
      <p class="subtitle">在项目根目录打开</p>
    </div>
  </header>
  ${body}
  <p class="hint">点状态栏的 Warp 也可以打开。</p>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    for (const button of document.querySelectorAll(".switch button")) {
      button.addEventListener("click", () => {
        vscodeApi.postMessage({ type: "mode", mode: button.dataset.mode });
      });
    }
    for (const button of document.querySelectorAll(".open")) {
      button.addEventListener("click", () => {
        vscodeApi.postMessage({ type: "open", index: Number(button.dataset.open) });
      });
    }
  </script>
</body>
</html>`;
}

function renderModeSwitch(mode: WarpOpenMode): string {
  return `<div class="switch" role="group" aria-label="打开方式">
    <button type="button" data-mode="tab" aria-pressed="${mode === "tab" ? "true" : "false"}">新标签页</button>
    <button type="button" data-mode="window" aria-pressed="${mode === "window" ? "true" : "false"}">新窗口</button>
  </div>`;
}

function renderProjects(folders: readonly vscode.WorkspaceFolder[], current: number): string {
  const order = folders.map((_, index) => index).sort((left, right) => {
    if (left === current) {
      return -1;
    }
    if (right === current) {
      return 1;
    }
    return left - right;
  });

  return order
    .map((index) => {
      const folder = folders[index];
      const currentClass = folders.length > 1 && index === current ? " current" : "";
      const badge = folders.length > 1 && index === current ? `<span class="badge">当前</span>` : "";
      return `<section class="card${currentClass}">
        <div class="name-row">
          <p class="name">${escapeHtml(folder.name)}</p>
          ${badge}
        </div>
        <p class="path">${escapeHtml(folder.uri.fsPath)}</p>
        <button type="button" class="open" data-open="${index}">在 Warp 中打开</button>
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

async function restoreIntegratedTerminal(context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration("terminal.integrated");

  if (context.globalState.get<boolean>(OWNED_DEFAULT_KEY, false)) {
    if (config.get<string>("defaultProfile.osx") === "Warp") {
      const previous = context.globalState.get<string | null>(PREVIOUS_DEFAULT_KEY, null);
      await config.update("defaultProfile.osx", previous ?? undefined, vscode.ConfigurationTarget.Global);
    }
    await context.globalState.update(OWNED_DEFAULT_KEY, false);
  }

  if (context.globalState.get<boolean>(OWNED_AUTOMATION_KEY, false)) {
    await config.update("automationProfile.osx", undefined, vscode.ConfigurationTarget.Global);
    await context.globalState.update(OWNED_AUTOMATION_KEY, false);
  }
}
