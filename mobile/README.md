# Jump Attack · 手机端

Expo（SDK 58）+ React Native，iOS 优先。数据存在手机本地 SQLite。

## 现在能做什么

- **跳跃测试**：CMJ、SJ、单腿 CMJ。用后置摄像头 120/240 fps 录像（或从相册导入），逐帧标出起跳帧和落地帧，按 h = g·t²/8 算跳高；每次测试可做多次，取最好成绩。
- **评估**：和自己的历史比较，超过「最小有意义变化」（0.2 × 个人标准差）才算真进步；CMJ 比近期基线低 5% 以上提示疲劳。
- **历史**：每个指标的趋势图和逐次记录。
- **我的**：测试对象切换和档案（体重、站立摸高）。

速度、VBT、灵活度、恢复、训练计划在首页显示为「即将上线」。

## 运行

相机和高帧率录像用到原生模块（react-native-vision-camera），**不能用 Expo Go**，需要开发版 App：

```sh
cd mobile
npm install
# 方式一：本地 Mac + Xcode，接上 iPhone（模拟器没有摄像头）
npx expo run:ios --device
# 方式二：EAS 云端构建，不需要 Mac
npx eas-cli@latest build --profile development --platform ios
```

装好开发版后，之后改 JS 代码只需 `npx expo start`。

## 开发

```sh
npm test            # 单元测试（计算公式、评估、数据库）
npm run typecheck
npm run lint
```

目录：

| 路径 | 内容 |
|---|---|
| `src/app/` | 页面（Expo Router，每个文件一个路由） |
| `src/domain/` | 纯计算：跳高、RSI、SWC、疲劳判断，带单元测试 |
| `src/db/` | SQLite 表结构迁移和查询 |
| `src/components/` | 图标、按钮、趋势图 |
| `src/theme/` | 颜色和字体（取自设计稿） |
