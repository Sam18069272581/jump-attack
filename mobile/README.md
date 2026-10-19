# Jump Attack · 手机端

Expo（SDK 57）+ React Native，iOS 优先。数据存在手机本地 SQLite。

用 SDK 57 是为了和 iPhone 上 Expo Go 支持的版本一致（2026-10 实测）。Expo Go 每个版本只支持一个 SDK；它更新后如果提示版本不匹配，要把项目一起升级。

## 现在能做什么

- **跳跃测试**：CMJ、SJ、单腿 CMJ。用 120/240 fps 视频（App 内录像，或用 iPhone 慢动作拍好后导入），逐帧标出起跳帧和落地帧，按 h = g·t²/8 算跳高；每次测试可做多次，取最好成绩。
- **评估**：和自己的历史比较，超过「最小有意义变化」（0.2 × 个人标准差）才算真进步；CMJ 比近期基线低 5% 以上提示疲劳。
- **历史**：每个指标的趋势图和逐次记录。
- **我的**：测试对象切换和档案（体重、站立摸高）。

速度、VBT、灵活度、恢复、训练计划在首页显示为「即将上线」。

## 装到 iPhone 上（不用 Xcode）

用 **Expo Go** 运行：Intel Mac、Apple 芯片 Mac、Windows 电脑都行，不用 Xcode，也不用付费的开发者账号。

1. iPhone 上从 App Store 安装 **Expo Go**。
2. 电脑上安装 **Node.js**：[nodejs.org](https://nodejs.org) 下载 LTS 安装包。Mac 系统版本较旧、装不上时，改装 22 版本。
3. 下载代码：在 GitHub 打开本仓库，切到 `feat/mobile-mvp` 分支，点 Code → Download ZIP 并解压。会用 git 的话：

   ```sh
   git clone -b feat/mobile-mvp https://github.com/Sam18069272581/jump-attack.git
   ```

4. 打开「终端」（Windows 用 PowerShell），输入 `cd `（后面带一个空格），把代码里的 `mobile` 文件夹拖进窗口，回车。然后：

   ```sh
   npm install
   npm start
   ```

5. 终端里会出现二维码。手机和电脑连同一个 Wi-Fi，用 iPhone 自带相机扫码，点弹出的提示，App 就在 Expo Go 里打开了。扫码后连不上（比如网络有隔离）时，按 Ctrl+C 停掉，改用 `npx expo start --go --tunnel`。

用的时候电脑上的终端要开着。测试记录存在手机上，下次 `npm start` 再扫码打开还在。

### 在 Expo Go 里怎么测

Expo Go 不带高帧率相机模块，所以先用 iPhone 自带相机的慢动作拍，再导入 App：

1. 设置 → 相机 → 录制慢动作，选「1080p，240 fps」。
2. 手机放稳在地面或三脚架上，镜头对准脚踝，距离约 1.5 米。相机切到「慢动作」，起跳前 2 秒开拍，落地站稳 2 秒后再停。
3. App 里：跳跃测试 → 选项目 → 从相册导入视频 → 逐帧标记起跳帧和落地帧。
4. 如果逐帧页显示视频只有 30 fps，把「拍摄帧率」选成 240。慢动作导出后每一帧仍然是 1/240 秒，App 会按 240 计算。

### 以后：在 App 里直接录 240 fps

需要装开发版 App（含 react-native-vision-camera），二选一：

- **不用 Mac**：加入 Apple Developer Program（每年 99 美元），用 EAS 云端编译后装到手机上，之后用 `npm run start:dev` 连接：

  ```sh
  npx eas-cli@latest build --profile development --platform ios
  ```

- **有能装最新 Xcode 的 Apple 芯片 Mac**：iPhone 打开开发者模式，用数据线连上后运行 `npx expo run:ios --device`（免费 Apple ID 即可，7 天后要重新装一次）。

开发版和 Expo Go 用的是同一套代码：App 发现自己在 Expo Go 里，就显示「慢动作拍 → 导入」页面，否则打开 App 内相机。

## 开发

```sh
npm test            # 单元测试（计算公式、评估、数据库、Expo Go 兼容）
npm run typecheck
npm run lint
```

目录：

| 路径 | 内容 |
|---|---|
| `src/app/` | 页面（Expo Router，每个文件一个路由） |
| `src/domain/` | 纯计算：跳高、RSI、SWC、疲劳判断，带单元测试 |
| `src/db/` | SQLite 表结构迁移和查询 |
| `src/components/` | 图标、按钮、趋势图；`capture/` 是录像页（App 内相机和 Expo Go 的导入页） |
| `src/theme/` | 颜色和字体（取自设计稿） |
