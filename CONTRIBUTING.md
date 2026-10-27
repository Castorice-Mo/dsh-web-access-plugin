# 贡献指南

感谢愿意动手。本项目刻意保持**小而无依赖**，所以门槛不在规模，而在不破坏既有契约。

## 环境

| 项 | 要求 | 用途 |
|---|---|---|
| Node | ≥ 20 | 运行 Host/Client 代码；无构建步骤 |
| Python | ≥ 3.10 | 跑 `quick_validate.py`（仅标准库） |
| Microsoft Edge | 任意 Chromium 版 | 仅「渲染兜底」路径需要；没有 Edge 时检索仍可用 |

无需 `pnpm install`：`package.json` 没有 `dependencies`。

## 本地验证（提交前三条）

```bash
python quick_validate.py                 # 清单/契约/文档漂移，33 项
node --check index.js client.js          # 运行文件语法
for f in lib/*.js; do node --check "$f"; done
```

> 新增功能若引入第三条命令之外的构建或测试工具，请先在 issue 里讨论——本仓库倾向于**不引入新工具**。

## 改动前必读

[PLUG.md](PLUG.md) 的 §8 列出六条**必须保持的不变量**，每一条都对应本仓库真实发生过的故障：

1. 不注册 `ctx.web` 提供者（会让默认 `web_search` / `web_fetch` 变成歧义错误）。
2. 工具 `parameters` 必须是**根为 `type: "object"` 的 JSON Schema**（否则模型端整轮拒收）。
3. 开关关闭时必须由守卫拒绝并给出可照做的提示。
4. 抓取结果必须标注为外部、不可信。
5. Edge 只作兜底（冷启动约 8 秒），正常站点优先 HTTP。
6. 不静默采用与查询无关的结果（必须标 `lowConfidence`）。

## 提交信息

采用 Conventional Commits 前缀：`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`。正文用祈使句说明**为什么改**，能一句话说清就不写第二句。

## Pull Request 检查表

- [ ] `python quick_validate.py` 全绿
- [ ] JavaScript 通过 `node --check`
- [ ] 行为改动已在真实站点上验证，并在 PR 描述中附**站点 URL 与实际输出**
- [ ] 文档（README / PLUG.md）与新行为一致；若改了默认值，README 的配置表同步更新
- [ ] 没有新增第三方依赖，也没有把临时/备份文件带进仓库
- [ ] 若改了 Host 半部，PR 中注明「需重启 Harness 生效」

## 报告问题

- 功能异常 → [Bug 报告](https://github.com/Castorice-Mo/dsh-web-access-plugin/issues/new?template=bug_report.yml)
- 新功能想法 → [功能请求](https://github.com/Castorice-Mo/dsh-web-access-plugin/issues/new?template=feature_request.yml)
- 安全问题 → **不要开公开 issue**，见 [SECURITY.md](SECURITY.md)

报告抓取/检索问题时，请附上目标 URL、使用的 `engine` / `mode`、以及工具返回的原文（可脱敏）。「某站点抓不到」多半是站点反爬，附上返回文本能立刻区分是插件缺陷还是站点行为。

## 行为准则

讨论对事不对人。本仓库不设独立的行为准则文件：范围小、参与者少，上面这一句就够；若将来社区扩大再补。
