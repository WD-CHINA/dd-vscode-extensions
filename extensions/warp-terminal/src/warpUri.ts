export type WarpOpenMode = "tab" | "window";

export const WARP_APP_PATH = "/Applications/Warp.app";

export function buildWarpUri(
  cwd: string,
  mode: WarpOpenMode,
  scheme: "warp" | "warppreview" = "warp",
): string {
  if (!cwd.startsWith("/")) {
    throw new Error("Warp 只能打开本机绝对路径。");
  }

  const action = mode === "window" ? "new_window" : "new_tab";
  return `${scheme}://action/${action}?path=${encodeURIComponent(cwd)}`;
}
