import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { resolveFeishuApp } from "./feishuApp.js";

let statusItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  statusItem.command = "feishu.open";
  statusItem.name = "飞书";
  syncStatusBar();
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("feishu.open", () => openFeishu()),
  );
}

export function deactivate(): void {}

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

function unavailableReason(): string | undefined {
  if (process.platform !== "darwin") {
    return "打开本机飞书目前只支持 macOS。";
  }
  if (!resolveFeishuApp()) {
    return "未找到飞书。请先安装到 /Applications/Lark.app 或 /Applications/Feishu.app。";
  }
  return undefined;
}
