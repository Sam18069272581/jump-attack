# App Store 商店资料（草稿）

在 App Store Connect 里新建 App、填写资料时，照这里复制粘贴。主要语言用「简体中文」（App 界面目前只有中文）。

> 标 ⏳ 的句子对应还没合并进 main 的功能，提交审核前功能没上的话，把这几句删掉。Apple 审核会核对描述和实际功能。

## 基本信息

| 项目 | 内容 |
|---|---|
| App 名称（≤30 字符） | Jump Attack 弹跳训练 |
| 副标题（≤30 字符） | 测跳高、练弹跳、看进步 |
| 套装 ID（Bundle ID） | com.sam18069272581.jumpattack |
| SKU | jumpattack-ios |
| 主要类别 | 健康健美 |
| 次要类别 | 体育 |
| 年龄分级 | 4+（问卷全部选「无」） |
| 价格 | 免费 |
| 隐私政策网址 | https://github.com/Sam18069272581/jump-attack/blob/main/docs/privacy.md |
| 技术支持网址 | https://github.com/Sam18069272581/jump-attack/issues |
| 版权 | 2026 （你的名字） |

「Jump Attack」这个名字如果已被别人占用，App Store Connect 会提示，换成「Jump Attack - 弹跳测试」之类即可，App 桌面上显示的名字不受影响。

## 宣传文本（≤170 字符，随时可改，不用重新审核）

用 iPhone 慢动作或 App 内 240fps 录像，逐帧算出你的真实跳高。和自己的历史比，看清每一次进步，疲劳时自动提醒减量。

## 描述

Jump Attack 是给篮球、排球、田径等项目运动员和教练用的弹跳测试与训练工具。不需要测力台，不需要跳垫，一台 iPhone 就够。

【跳跃测试】
· 支持反向纵跳（CMJ）、深蹲跳（SJ）、单腿 CMJ
· 用 240fps 高帧率视频逐帧标出起跳和落地，按滞空时间计算跳高
· 每次测试可做多次，自动取最好成绩

【科学评估】
· 和你自己的历史基线比较，超过「最小有意义变化」才算真进步，不被日常波动误导
· CMJ 明显低于近期水平时提示疲劳，建议减量

【训练计划】⏳
· 垂直弹跳周期计划和保持计划，训练日自己选
· 每次训练前测一次 CMJ，状态差时自动减量并说明原因
· 逐组记录次数、重量、RPE，练完生成训练小结

【历史与趋势】
· 每项指标的趋势图和逐次记录
· 支持多个测试对象，适合教练管理队员

【隐私】
所有数据只保存在你的手机上，没有账号，不上传，不追踪。

## 关键词（≤100 字符，英文逗号分隔，不加空格）

弹跳,跳高,纵跳,CMJ,摸高,扣篮,篮球,排球,田径,体能,爆发力,训练计划,测试,RSI,VBT,运动表现

## 本版本新增内容（首个版本可不填）

首个版本上线。

## 截图

iPhone 6.9 英寸（1320×2868 或 1290×2796）至少 1 张、最多 10 张，必须是 App 真实界面。建议 5 张：

1. 首页
2. 逐帧标记页（起跳帧）
3. 测试结果页（跳高 + 评估结论）
4. 历史趋势图
5. 今日训练 ⏳

拿到 TestFlight 版本后在手机上截图即可；手机不是 6.9 英寸也没关系，发给 Claude 处理成需要的尺寸。

## App 隐私（「营养标签」）

在 App Store Connect →「App 隐私」里选择：**不收集数据**。

依据：没有服务器和账号，所有数据只存在手机本地。Expo 更新服务下载新代码时只用到版本号等技术信息，不关联用户，不属于 Apple 定义的「收集」。以后如果加了云同步或统计工具，要回来改这一项。

## 审核信息

| 项目 | 内容 |
|---|---|
| 需要登录 | 否 |
| 联系人 | 你的姓名、电话、邮箱 |
| 备注（英文，给审核员看） | 见下方 |

```
Jump Attack measures vertical jump height from high-frame-rate video.
No account is needed. To try it: Jump Test > CMJ > import any slow-motion
video (or record in-app), then step frame by frame to mark take-off and
landing; the result screen shows jump height and an assessment against
the athlete's own history. All data stays on the device.
```

## 出口合规

已在 app.json 里声明不使用非豁免加密（`usesNonExemptEncryption: false`），上传后不会再问。
