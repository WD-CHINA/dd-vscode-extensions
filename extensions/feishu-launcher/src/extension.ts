import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { resolveFeishuApp } from "./feishuApp.js";

const VIEW_ID = "feishu.sidebar";
const REVEALED_KEY = "feishu.revealedActivityBar";

let statusItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sidebar = new FeishuSidebarProvider();
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  statusItem.command = "feishu.open";
  statusItem.name = "飞书";
  syncStatusBar();
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.window.registerWebviewViewProvider(VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("feishu.open", () => openFeishu()),
    vscode.commands.registerCommand("feishu.revealSidebar", () => revealSidebar()),
  );

  if (!context.globalState.get<boolean>(REVEALED_KEY, false)) {
    await context.globalState.update(REVEALED_KEY, true);
    await revealSidebar();
  }
}

export function deactivate(): void {}

class FeishuSidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage((message: unknown) => {
      if (message && typeof message === "object" && (message as { type?: unknown }).type === "open") {
        openFeishu();
      }
    });
    this.refresh();
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = renderSidebar();
    }
  }
}

function openFeishu(): void {
  const reason = unavailableReason();
  if (reason) {
    void vscode.window.showErrorMessage(reason);
    return;
  }

  const appPath = resolveFeishuApp();
  if (!appPath) {
    void vscode.window.showErrorMessage("未找到飞书。请先安装到 /Applications/Lark.app 或 /Applications/Feishu.app。");
    return;
  }

  if (statusItem) {
    statusItem.text = "$(loading~spin) 飞书";
  }

  execFile("/usr/bin/open", ["-a", appPath], (error) => {
    if (error) {
      void vscode.window.showErrorMessage(`无法打开飞书：${error.message}`);
    }
    syncStatusBar();
  }).unref();
}

function syncStatusBar(): void {
  if (!statusItem) {
    return;
  }
  statusItem.text = "$(comment-discussion) 飞书";
  statusItem.tooltip = unavailableReason() ?? "打开本机飞书";
}

async function revealSidebar(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.feishu");
}

function unavailableReason(): string | undefined {
  if (process.platform !== "darwin") {
    return "打开本机飞书目前只支持 macOS。";
  }
  if (!resolveFeishuApp()) {
    return "未找到飞书。请先安装到 /Applications/Lark.app 或 /Applications/Feishu.app。";
  }
  return undefined;
}

function renderSidebar(): string {
  const nonce = randomBytes(16).toString("hex");
  const reason = unavailableReason();
  const body = reason
    ? `<p class="empty">${escapeHtml(reason)}</p>`
    : `<button type="button" class="open" id="open">打开飞书</button>
       <p class="hint">已安装时可直接唤起本机应用。</p>`;

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
    .open {
      width: 100%;
      border: 0;
      border-radius: 8px;
      padding: 10px 12px;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      transition: background-color 160ms ease;
    }
    .open:hover {
      background: var(--vscode-button-hoverBackground);
    }
    button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    .hint {
      margin: 12px 0 0;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.5;
    }
    .empty {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
    }
    @media (prefers-reduced-motion: reduce) {
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
        <path fill="currentColor" d="M2.5 3.2c0-.39.31-.7.7-.7h6.1c.39 0 .7.31.7.7v4.9c0 .39-.31.7-.7.7H6.1L4.2 10.5c-.22.2-.55.04-.55-.26V9.1H3.2c-.39 0-.7-.31-.7-.7V3.2Zm8.6 1.3h1.1c.39 0 .7.31.7.7v4.9c0 .39-.31.7-.7.7h-.75v1.35c0 .3-.33.46-.55.26l-1.45-1.25h-.35c-.2 0-.37-.13-.43-.32.35-.24.58-.64.58-1.1V6c0-.39.31-.7.7-.7h1.15Z"/>
      </svg>
    </div>
    <div>
      <p class="title">飞书</p>
      <p class="subtitle">启动本机应用</p>
    </div>
  </header>
  ${body}
  <p class="hint">点状态栏的飞书也可以打开。</p>
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    const open = document.getElementById("open");
    if (open) {
      open.addEventListener("click", () => {
        vscodeApi.postMessage({ type: "open" });
      });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
