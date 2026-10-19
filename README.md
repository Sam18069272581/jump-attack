# Jump Attack · 弹跳训练系统

把弹跳训练做成闭环：**计划 → 执行 → 记录 → 评估 → 调整 → 回到计划**。

- 系统方案：[docs/system-design.md](docs/system-design.md)（在线版：[Claude Doc](https://claude.ai/code/artifact/e1b76539-6d87-478f-bd59-049a55b56144)）
- UI 设计稿：[claude.ai 设计画布](https://claude.ai/artifact/TdA5bEMuYhctBQhrrQeKv9)，源文件导出在 [design/](design/)（`.dc.html` 每个文件是一个页面，`canvas.json` 是页面索引）

## 目录

| 路径 | 内容 |
|---|---|
| `docs/` | 系统设计、数据模型、开源选型 |
| `design/` | UI 设计稿源文件（13 个页面） |

## 状态

方案阶段。默认技术栈（待确认）：React Native + Expo，iOS 优先，本地 SQLite。
