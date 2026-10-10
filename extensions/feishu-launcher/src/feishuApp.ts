import fs from "node:fs";

/** macOS 上常见的飞书 / Lark 安装路径（国内版常显示为「飞书」，包名仍可能是 Lark.app）。 */
export const FEISHU_APP_CANDIDATES = [
  "/Applications/Lark.app",
  "/Applications/Feishu.app",
] as const;

export function resolveFeishuApp(
  candidates: readonly string[] = FEISHU_APP_CANDIDATES,
  exists: (path: string) => boolean = (path) => fs.existsSync(path),
): string | undefined {
  return candidates.find((candidate) => exists(candidate));
}
