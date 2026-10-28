# Jump Attack · 手机端

帮你扣篮的弹跳训练 App：测出离扣篮线还差多少、缺力量还是缺反应，按短板排 4 周训练块，每天按状态调整，块末复测再决定下一块。Expo SDK 58，在 iPhone 的 Expo Go 里运行。数据存在手机本地，登录后自动备份到自己的云端账号。

## 能做什么

- **扣篮诊断**（首页最上面）：扣篮线 = 篮筐 + 过筐余量（「我的」里改）。用助跑摸高（没有就用站立摸高 + CMJ）算还差多少，用深蹲 ÷ 体重、跳深 RSI 和触地时间判断练力量块、反应块还是转化块。
- **跳跃测试**：CMJ、SJ、单腿 CMJ、助跑摸高、跳深找最佳箱高、负重蹲跳力-速度曲线。慢动作视频逐帧标记，一段视频可以连续标几跳；CMJ、SJ、助跑摸高也能手填。录助跑摸高时顺手填墙上摸到的刻度，录像估算就按你自己校准。
- **训练**：扣篮 4 周训练块（第 4 周减量复测，复测后建议换块或提前进阶），或固定模板。练前测 CMJ 或记恢复数据，状态差自动减量，连续疲劳建议插入减量周。这周漏练的课可以在休息日补上；跳深、六角杠铃跳直接写你的箱高和重量。
- **速度、VBT、灵活度、体能耐力**：冲刺计时（录像、光电门、秒表分开比较）、杠铃速度和 1RM 估算、7 项灵活度左右对比、Yo-Yo / Cooper / RSA。
- **恢复**：每天记 HRV、静息心率、睡眠、呼吸频率，可以用「快捷指令」从苹果健康导入。
- **历史**：摸高曲线在最上面，其余每个指标有趋势和逐次记录，点开一次记录可以改错或删除。
- **数据备份与同步**（「我的」→ 数据备份与同步）：登录自己的云端账号后自动备份，换手机、换电脑或用网页版，登录同一个邮箱就能恢复；也能导出、导入备份文件。云端用自己的 Supabase 免费项目，建表 SQL 在 [supabase/backups.sql](supabase/backups.sql)，地址和 key 在 `src/sync/config.ts`。

## 怎么运行

1. iPhone 从 App Store 装 **Expo Go**；电脑装 [Node.js](https://nodejs.org) LTS。
2. 下载 https://github.com/Sam18069272581/jump-attack/archive/refs/heads/main.zip 并解压（重新下载前先删掉旧的 `jump-attack-main` 文件夹）。
3. 终端进入 `mobile` 文件夹，运行：

   ```sh
   npm install
   npm start
   ```

4. 手机和电脑连同一个 Wi-Fi，用相机扫终端里的二维码。连不上（比如校园网）时改用 `npx expo start --go --tunnel`。

**记录跟着启动它的电脑走**：Expo Go 按电脑区分数据，换一台电脑 `npm start`，手机上看到的是另一份空数据。登录云端备份后，换了电脑再登录同一个邮箱就能恢复。

### 不开电脑也能用

合并到 main 后由 GitHub Actions 自动更新，两种都免费：

- **网页版**：https://sam18069272581.github.io/jump-attack/ 。iPhone 用 Safari 打开，点「分享 → 添加到主屏幕」，之后全屏打开，断网也能用。数据存在这个浏览器里。录像只能从相册导入，逐帧定位不如 App 精确；量角度要先点「允许使用运动传感器」。微信、QQ 内置浏览器打不开。
- **Expo Go 云端版**：Expo Go 登录自己的 Expo 账号，打开 `exp://u.expo.dev/589a8a7c-8269-46a9-a6f1-a9fa25be2636?channel-name=main`。只能打开自己账号（或所在组织）的项目。

网页版、云端版和电脑启动的版本各存各的数据，登录同一个云端账号就能同步。

第一次设置（只做一次）：仓库 Settings → Pages → Source 选「GitHub Actions」；expo.dev → Access tokens 新建 token，填到仓库 Settings → Secrets and variables → Actions，名字 `EXPO_TOKEN`。也可以在电脑上 `npx eas-cli@latest login` 后 `npm run update` 手动发布。

### 拍视频

设置 → 相机 → 录制慢动作，选 1080p 240 fps。手机放稳在侧面，镜头对准脚踝，起跳前 2 秒开拍。在 App 里选项目 → 从相册导入 → 逐帧标记。每个项目的拍法写在导入页上。

## 开发

在 `mobile/` 下：

```sh
npm test && npm run typecheck && npm run lint
npm run build:web   # 网页版导出到 dist/（npx expo start --web 可本地预览）
```

代码分层见仓库根目录的 `CLAUDE.md`。
