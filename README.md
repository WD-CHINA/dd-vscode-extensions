# dd-vscode-extensions

在 Cursor / VS Code 里启动本机应用的扩展集合。扩展只负责唤起应用，不把应用嵌进编辑器，平时几乎不占内存和 CPU。

目前只支持 macOS。

| 扩展 | 目录 | 作用 |
| --- | --- | --- |
| Warp 终端 | `extensions/warp-terminal` | 在当前项目根目录打开 Warp |
| 飞书 | `extensions/feishu-launcher` | 启动本机飞书 |
| SourceTree | `extensions/sourcetree-launcher` | 打开 SourceTree，并加载当前 Git 仓库 |

各扩展自己的 `README.md` 只写给使用者。开发、调试和打包见 [开发文档](docs/开发文档.md)，约定见 [开发规范](docs/开发规范.md)。给自动化代理的简要约束在 [AGENTS.md](AGENTS.md)。

## 准备

需要 Node.js 22 以上和 pnpm 10。

```bash
pnpm install
pnpm test
pnpm run compile
```

在 Cursor 里按 F5，选择「运行 Warp 扩展」「运行飞书扩展」或「运行 SourceTree 扩展」。启动前会先编译整个工作区。

## 许可证

[MIT](LICENSE)
