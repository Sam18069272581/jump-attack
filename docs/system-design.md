# 弹跳训练系统 · 闭环设计与开源选型

> 2026-10-19。在线可编辑版本：https://claude.ai/code/artifact/e1b76539-6d87-478f-bd59-049a55b56144

## 一句话结论

现有设计稿已经把「测」和「看」做得很完整（跳跃/冲刺/VBT/灵活度/恢复的测试与历史趋势），闭环还缺三块：**计划**、**今日训练执行**、**评估后的自动调整**。建议用 React Native（Expo）做 iOS 优先的本地优先 App，计划层借鉴 Liftosaur 的「可编程计划」思路，视频测量自研（逐帧 + 后续姿态识别自动打点），恢复数据走 Apple 健康。

## 设计稿现状

13 个页面，深色主题，主色 `#D4FF3F`，字体 Barlow Condensed + Noto Sans SC。源文件见 [`../design/`](../design/)。

| 模块 | 页面 | 已有能力 |
|---|---|---|
| 首页 | `Main` | 五大分类入口；「切换测试对象」（多运动员 / 教练模式） |
| 跳跃测试 | `Jumps` → `Capture` → `Record` → `Result`；`Pogo` | 120/240 fps 录像、拍摄自检、逐帧标起跳/落地帧，h = g·t²/8；Pogo 10 跳算 RSI、触地 CV、疲劳衰减 |
| 速度训练 | `Speed` | 10/30/50/100 m 冲刺 |
| VBT 训练 | `VBT` | 深蹲、高翻、高拉、深蹲跳的平均/峰值速度，分起始位置 |
| 灵活度 | `Mobility` | 7 项左右侧测量，左右差 ≥10% 标橙 |
| 恢复 | `Recovery` | HRV、静息心率、睡眠、呼吸频率（Apple 健康） |
| 历史 | `History` / `HistoryCat` / `HistoryDetail` | 19 个指标趋势和逐次记录，区分「越低越好」 |

**缺口：** 「我的」页面；训练计划、今日训练、训练日志（组 × 次 × 重量 × RPE）；测试结果没有反馈回计划。

## 闭环怎么转

1. **计划**：周期（如 4 周积累 + 1 周减量）→ 周 → 训练课 → 动作处方。处方写规则而非死重量：「深蹲 目标速度 0.60–0.70 m/s，速度损失 20% 停组」「CMJ 每周一测」。
2. **执行（今日训练）**：先看「今日准备度」，再按清单完成。VBT 每组记录速度，掉到阈值提示停组；跳跃/冲刺直接调用现有测试流程。
3. **记录**：现有测试页面 + 新增训练日志，统一时间线。
4. **评估**
   - 准备度：HRV 对比个人 7 天/28 天基线；CMJ 对比基线（下降 >5% 视为疲劳信号）。
   - 进步：最小有意义变化 SWC = 0.2 × 个人标准差，超过才算真进步。
   - 风险：灵活度左右差、Pogo 疲劳衰减、急慢性负荷比（ACWR）。
5. **调整**：规则引擎改下一次训练并记录原因。例：准备度低 → 当天总量 −30%、去掉最大强度；载荷-速度曲线估当天 1RM → 自动算各组重量；连续 2 次测试超过 SWC → 进下一阶段；疲劳信号连续 3 天 → 建议减量周。

## 需要新增的页面

- **今日**：准备度卡片 + 今日训练清单。
- **计划**：周期 / 周视图，可从模板创建。
- **训练执行页**：单动作组记录，VBT 实时速度和停组提示。
- **训练报告**：课后总结 + 系统做了哪些调整、原因。
- **我的**：运动员档案（身高、体重、站立摸高）、测试对象管理、Apple 健康授权、数据导出。

## 数据模型（核心表）

| 表 | 关键字段 |
|---|---|
| `athlete` | 姓名、体重、站立摸高、所属教练 |
| `metric` | 代码（cmj、s30…）、单位、越高/越低越好、分类 |
| `test_result` | 运动员、指标、数值、原始数据（视频、fps、起跳帧、落地帧、每跳触地/滞空）、时间 |
| `plan` / `block` / `session` / `prescription` | 周期、阶段、训练课、动作处方（规则表达式） |
| `session_log` / `set_log` | 重量、次数、平均/峰值速度、RPE |
| `recovery_daily` | HRV、静息心率、睡眠，按天 |
| `adjustment` | 触发规则、修改内容、原因 |

测试结果保存原始帧号，改算法后可重算历史。

## 技术方案

**推荐：React Native + Expo，iOS 优先，本地优先，后期可选云同步。**

- 相机 240 fps：`react-native-vision-camera`
- 逐帧标记：`expo-video` / AVFoundation 逐帧 seek
- 自动打点（第二阶段）：Apple Vision 人体姿态或 MediaPipe Pose
- Apple 健康：`@kingstinct/react-native-healthkit`
- 本地存储：SQLite（`expo-sqlite` + Drizzle ORM）；规则引擎为纯 TypeScript 模块
- 云同步 / 教练端（可选）：Supabase

只做 iOS 且追求极致相机性能，也可选 Swift + SwiftUI，代价是以后做安卓/网页要重写。

## 开源项目推荐

| 项目 | 可借鉴 | 用法 |
|---|---|---|
| [Liftosaur](https://github.com/astashov/liftosaur) | 用 Liftoscript 写计划与自动进阶，TypeScript | 「计划 + 调整」层的主要参考 |
| [wger](https://wger.readthedocs.io/) | 动作库、计划、日志，Django + Flutter，有 REST API | 参考数据模型；也可自托管当后端 |
| [workout-cool](https://github.com/Snouzy/workout-cool) | Next.js 健身平台，动作库与课程编排 | 参考网页 / 教练端 |
| [GoldenCheetah](https://github.com/GoldenCheetah/GoldenCheetah) | ATL/CTL/TSB 负荷-疲劳模型 | 参考「评估」层算法 |
| [Kinovea](https://www.kinovea.org/) | 开源运动视频逐帧分析 | 参考交互；做算法对照 |
| [BarbellTrackingCode](https://github.com/NeythonLecStreitz/BarbellTrackingCode) | OpenCV 视频追踪杠铃速度 | 手机摄像头测 VBT 的参考 |
| [OpenBarbell](https://hackaday.io/project/3706-openbarbell) | 开源硬件 VBT 传感器 | 硬件方案参考 |

闭源对标：My Jump、Metric VBT、Photo Finish 类冲刺计时。冲刺计时无成熟开源项目，建议自研（双机起终点越线检测，或单机手动起跑）。

## 分阶段路线

1. **MVP**：CMJ 测试（手动逐帧）+ 历史 + Apple 健康恢复数据 + 简单周计划 + 「准备度低就降量」一条规则。
2. **训练执行**：今日训练、组记录、VBT 手动录入、训练报告。
3. **评估与调整**：SWC、载荷-速度曲线估 1RM、进阶和减量规则、调整记录。
4. **自动化**：姿态识别自动打点、Pogo 自动分跳、冲刺相机计时。
5. **多人与云端**：多运动员、教练端、Supabase 同步。

## 待确认

- 平台：只做 iOS，还是将来也要安卓？（默认 iOS 优先、React Native）
- 使用者：只给自己用，还是支持教练带多个运动员？（数据模型按多人设计，MVP 先做单人）
