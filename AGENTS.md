# AGENTS.md

本仓库是 Cursor / VS Code 扩展的 pnpm 工作区。扩展只负责在 macOS 上唤起本机应用。更完整的步骤见 `docs/开发文档.md`，约定见 `docs/开发规范.md`。

## 改代码时

- 界面、错误提示、`displayName`、`description` 和扩展 README 使用简体中文。
- 不注册快捷键。用活动栏、状态栏，需要时再加上资源管理器右键。
- 唤起应用使用 `execFile(...).unref()`。不要嵌入外部应用，也不要留下常驻子进程。
- 只支持 macOS。其他平台和远程窗口直接报错。
- 应用路径放在 `/Applications` 的候选列表里，取第一个存在的路径。
- `publisher` 固定为 `dd-vscode-extensions`。命令和视图 id 用扩展前缀，例如 `feishu.open`、`feishu.sidebar`。
- 活动栏容器和 webview 视图都要写 `icon`，图标是 `media/*.svg`，单色 `fill="#000"`。
- webview 使用 `retainContextWhenHidden: true`。内容安全策略为 `default-src 'none'`，脚本带一次性 `nonce`。
- `extension.ts` 只做命令、界面和唤起。路径解析、Git 根目录这类逻辑放到可单测的模块，该模块不要 import `vscode`。

## TypeScript

继承根目录 `tsconfig.base.json`，保持 `module` 和 `moduleResolution` 为 `nodenext`。

- 实现文件的相对导入使用 `.js` 后缀。
- 测试文件的相对导入使用 `.ts` 后缀。
- 每个扩展保留两份配置：`tsconfig.json` 包含测试且 `noEmit`；`tsconfig.build.json` 排除 `src/**/*.test.ts` 并输出到 `out/`。
- 不要把测试排除出 `tsconfig.json`，否则编辑器会报找不到 `node:*` 类型。

## 验证

改完后在仓库根执行相关扩展的测试和编译：

```bash
pnpm --filter <扩展名> test
pnpm --filter <扩展名> run compile
```

新增扩展后还要 `pnpm install`，并在 `.vscode/launch.json` 加一条调试配置。

## 打包

只在用户要求时打包或安装。必须在扩展目录内执行，不要在仓库根目录执行 `vsce`：

```bash
cd extensions/<扩展目录>
pnpm dlx @vscode/vsce package --allow-missing-repository --no-dependencies
cursor --install-extension ./<name>-<version>.vsix --force
```

不要提交 `.vsix`、`out/` 或 `node_modules/`。扩展自己的 `README.md` 会打进 vsix，只写使用者怎么打开。
