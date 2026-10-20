# Jump Attack · 弹跳训练系统

把弹跳训练做成闭环：**计划 → 执行 → 记录 → 评估 → 调整 → 回到计划**。

- 系统方案：[docs/system-design.md](docs/system-design.md)（在线版：[Claude Doc](https://claude.ai/code/artifact/e1b76539-6d87-478f-bd59-049a55b56144)）
- UI 设计稿：[claude.ai 设计画布](https://claude.ai/artifact/TdA5bEMuYhctBQhrrQeKv9)，源文件导出在 [design/](design/)（`.dc.html` 每个文件是一个页面，`canvas.json` 是页面索引）

## 目录

| 路径 | 内容 |
|---|---|
| `docs/` | 系统设计、数据模型、开源选型 |
| `design/` | UI 设计稿源文件（13 个页面） |
| `mobile/` | 手机 App（Expo + React Native），运行方法见 [mobile/README.md](mobile/README.md) |

## 状态

MVP 开发中，闭环已经能在本地跑通：跳跃、速度、VBT、灵活度、恢复、体能耐力六个测试板块，历史趋势，训练计划和今日训练，以及评估后的自动调整（CMJ 或 HRV 显示疲劳时当天减量、连续疲劳插入减量周、按 VBT 估算 1RM 推荐深蹲重量）。技术栈：React Native + Expo，iOS 优先，本地 SQLite。不用 Xcode 也能装到 iPhone 上试（Expo Go），步骤见 [mobile/README.md](mobile/README.md)。
