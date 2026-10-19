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

### 用 Mac 装到 iPhone 上

1. 装好 Xcode（App Store），打开一次让它装完组件；装 Node.js 20 以上。
2. 在 Xcode → Settings → Accounts 登录你的 Apple ID（免费账号就行，装到手机上的 App 7 天后要重新装一次）。
3. iPhone 用数据线连 Mac，在手机上点「信任此电脑」；然后打开 设置 → 隐私与安全性 → 开发者模式。
4. 拉代码并运行：

   ```sh
   git clone https://github.com/Sam18069272581/jump-attack.git
   cd jump-attack/mobile
   npm install
   npx expo run:ios --device
   ```

   选你的 iPhone。第一次编译要几分钟；如果提示安装 CocoaPods，按提示装（或 `brew install cocoapods`）。
5. 如果报签名错误：打开 `ios/` 里的 `.xcworkspace`，选中 App 目标 → Signing & Capabilities → Team 选你的 Apple ID，再运行一次第 4 步最后一条命令。
6. 手机上第一次打开前：设置 → 通用 → VPN 与设备管理 → 信任你的开发者账号。

装好之后改 JS 代码只需 `npx expo start`，手机上打开 App 会自动连上。模拟器没有摄像头，只能测导入视频之后的流程。

### 没有 Mac

```sh
npx eas-cli@latest build --profile development --platform ios
```


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
