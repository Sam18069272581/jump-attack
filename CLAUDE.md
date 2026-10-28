# Jump Attack

Expo SDK 58 + React Native，本地 SQLite，iOS 优先。代码都在 `mobile/`，命令都在 `mobile/` 下跑。
Expo 相关规则：@mobile/AGENTS.md

## 分层（改代码前先找对层）

- `src/domain/`：纯计算，不 import React 或 expo。用户输入有问题时返回 `{ ok: false, problem }`，只有编程错误才 throw。
- `src/db/`：SQL。迁移只追加，不改已有的。
- `src/app/`：页面，只负责组合 domain 和 db，不写计算逻辑。

## 测试

- domain：单元测试，公式和阈值要在测试里写出算例或出处。
- db：用 `openMemoryDb()` 跑真实 SQL，不 mock 数据库。
- 页面：改流程时，用内存库把整条流程驱动一遍（参考 `src/app/__tests__/training.test.tsx`）。
- 带原生代码的库在 Expo Go 里不能加载（参考 `capture/__tests__/expoGo.test.ts`）。

## 规则

1. 先写会失败的测试，再改代码。
2. 不许为了让测试通过去改已有测试的期望值。公式或阈值确实要改时，先说明理由，等我确认。
3. 只改和任务相关的文件，不顺手重构。
4. 加依赖用 `npx expo install`。
5. 数据本地优先：健康和训练数据先存本机，只在用户登录自己的云端账号后整库同步过去（Supabase，见 `mobile/src/sync/`）。不传给任何第三方，不加统计或分析上报。

## 完成标准

在 `mobile/` 下运行 `npm test && npm run typecheck && npm run lint`，全部通过并贴出结果。没跑过就不能说"完成"。

## 文档

md 文档保持精简：README 只写能做什么、怎么运行。实现细节写在代码注释和测试里，不往 README 里加长段落。
