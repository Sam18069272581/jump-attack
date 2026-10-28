# 上线步骤：TestFlight → App Store

App 用 Expo 的云端编译服务（EAS）打包，**不需要 Xcode**，Intel Mac 也可以。下面的命令都在 Mac 的「终端」里、`mobile` 文件夹下运行。

## 准备（只做一次）

1. **Apple 开发者账号**：https://developer.apple.com/programs/enroll/ ，每年 99 美元，通过后才能做第 3 步。
2. **Expo 账号**：https://expo.dev/signup ，免费。
3. 下载最新代码：https://github.com/Sam18069272581/jump-attack/archive/refs/heads/main.zip ，进入 `jump-attack-main/mobile`：

   ```sh
   cd ~/Downloads/jump-attack-main/mobile
   npm install
   ```

## 第一次打包

打包前先把 `mobile/app.json` 里的 `"runtimeVersion": "exposdk:58.0.0"` 改回 `{ "policy": "appVersion" }`。`exposdk:` 是给 Expo Go 云端版用的，正式版要按自己的版本号接收更新。

1. 登录 Expo：

   ```sh
   npx eas-cli@latest login
   ```

2. 在 Expo 上建项目，并打开「在线更新」：

   ```sh
   npx eas-cli@latest init
   npx eas-cli@latest update:configure
   ```

   两个命令问问题时都直接回车（选 Yes）。完成后运行下面这行，**把输出发给 Claude**，Claude 会把它写进代码，以后重新下载代码也不会丢：

   ```sh
   grep -n "projectId\|u.expo.dev\|owner" app.json
   ```

3. 云端打包，打完自动上传到 App Store Connect：

   ```sh
   npx eas-cli@latest build --platform ios --profile production --auto-submit
   ```

   过程中会问：

   | 提示 | 怎么答 |
   |---|---|
   | Do you want to log in to your Apple account? | Yes，输入 Apple ID、密码和手机上的验证码 |
   | Generate a new Apple Distribution Certificate? | Yes |
   | Generate a new Apple Provisioning Profile? | Yes |
   | 推送通知（Push Notifications）相关 | No |
   | 是否在 App Store Connect 创建 App | Yes。名字被占用时，按 [商店资料](app-store-listing.md) 里的说明换一个 |

   证书、描述文件都由 Expo 保管，以后不用再管。打包在云端进行，免费账号一般排队加编译 30 分钟到 1 小时，终端可以关掉，进度在 https://expo.dev 上看。

4. 上传后 Apple 处理 10 到 30 分钟，你会收到邮件。

## 装到自己手机上（TestFlight）

1. 打开 https://appstoreconnect.apple.com → App → Jump Attack → TestFlight。
2. 「内部测试」点 + 新建一个组，把自己加进去。内部测试不用审核。
3. iPhone 上从 App Store 安装 **TestFlight**，用同一个 Apple ID 登录，就能看到 Jump Attack，点「安装」。

正式版和 Expo Go 不一样的地方：

- 跳跃测试可以直接在 App 里用 240fps 录像，不用再先拍慢动作再导入（导入也照样能用）。
- 不需要电脑开着终端。

想给朋友或队员测：TestFlight →「外部测试」，加他们的邮箱或生成公开链接。第一次外部测试要 Apple 简单审核，通常 1 天内。

## 以后发新版本

- **只改了 App 里的功能和界面**（大多数情况）：不用重新打包，也不用审核，几分钟就推到所有人手机上，下次打开 App 时生效：

  ```sh
  npx eas-cli@latest update --channel production --message "这次改了什么"
  ```

- **加了新的原生能力**（比如接入 Apple 健康）或改了 App 版本号：重新跑第一次打包的第 3 步。

Claude 会在每次合并时告诉你属于哪一种。

## 提交 App Store 审核

1. 按 [商店资料](app-store-listing.md) 填写描述、关键词、截图、隐私信息。
2. 在「App Store」页选择已上传的版本（构建版本），点「添加以供审核」→「提交」。
3. 审核一般 1 到 2 天。被拒的话把 Apple 的原文发给 Claude。

提交前要确认：首页没有「即将上线」这类还不能点的入口（Apple 会以「功能不完整」拒绝），商店描述里只写已经能用的功能。

## 上架地区

在 App Store Connect →「价格与销售范围」里选。上架中国大陆需要先办 ICP 备案，备案号填在 App 信息页。
