import { execFile } from "node:child_process";
import fs from "node:fs";
import * as vscode from "vscode";
import { buildWarpUri, WARP_APP_PATH } from "./warpUri.js";

const OWNED_DEFAULT_KEY = "warp.ownedDefaultProfile";
const PREVIOUS_DEFAULT_KEY = "warp.previousDefaultProfile";
const OWNED_AUTOMATION_KEY = "warp.ownedAutomationProfile";

let statusItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await restoreIntegratedTerminal(context);

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = "warp.openActive";
  statusItem.name = "Warp";
  syncStatusBar();
  statusItem.show();

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand("warp.openActive", () => openActiveRoot()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => syncStatusBar()),
    vscode.window.onDidChangeActiveTextEditor(() => syncStatusBar()),
  );
}

export function deactivate(): void {}

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

  let uri: string;
  try {
    uri = buildWarpUri(cwd, "tab");
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
  statusItem.text = "$(terminal) Warp";
  statusItem.tooltip = root
    ? `用新标签页打开 ${root.path}`
    : "打开一个项目文件夹后，可在其根目录启动 Warp";
}

function localFolders(): readonly vscode.WorkspaceFolder[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file");
}

function activeRoot(): { name: string; path: string } | undefined {
  const folders = localFolders();
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === "file") {
    const match = vscode.workspace.getWorkspaceFolder(active);
    if (match && folders.includes(match)) {
      return { name: match.name, path: match.uri.fsPath };
    }
  }
  if (folders.length === 1) {
    return { name: folders[0].name, path: folders[0].uri.fsPath };
  }
  return undefined;
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
