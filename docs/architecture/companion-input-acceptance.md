# 小远气泡：输入与首次打开

2026-10-26，本地验收记录；没有完成安装或发布。

## 原生输入链路

手动入口为 `scripts/companion/verify-bubble-input.mjs`。它创建隔离用户目录和仅回环的合成模型，实际点击桌宠、使用真实窗口/preload/IPC/持久聊天；不改真实用户配置，不使用外部模型，也不操作记忆工具。模型不可用场景只删除该临时目录中刚创建的测试服务商。

```bash
PREVIEW_PORT=5194 ZHIYUAN_ENGRAM_BIN=/private/tmp/engram-v3-namespace-candidate bun scripts/companion/verify-bubble-input.mjs
# 当前生产 renderer 的对照；先在 5195 提供本轮 dist，仍使用隔离开发壳。
PREVIEW_PORT=5195 COMPANION_INPUT_BUNDLED=1 ZHIYUAN_ENGRAM_BIN=/private/tmp/engram-v3-namespace-candidate bun scripts/companion/verify-bubble-input.mjs
```

该文件是实际执行的离线验收 CLI，需要将自身与导入图纳入 Knip entry 根检查；不是 ignoreFiles、ignoreIssues、导出白名单或 CI 豁免。已有原生气泡验收同样采用手动入口，常规 PR 不自动启动 Electron。

实际 Chromium `Input.imeSetComposition` 产生 compositionstart/update/end 和 isComposing=true 的按键事件。聊天和任务模式都验证选词回车不提交、组合期间 Esc 不隐藏、确认文字后收起再打开保留草稿、Shift+Enter 换行。正常回车只受理一次真实伙伴聊天并收到本机模型回复；禁用临时服务商后再提交，没有新增持久消息，原文保留。工作台草稿独立保留。

这些是 Chromium 的输入组合和 Electron 业务链路证据；没有驱动操作系统拼音候选窗，不能宣称所有真实输入法或 Windows 均已验收。

## 窗口生命周期与测量

旧逻辑在 ready-to-show 无条件 show，加载中收起仍会延后弹出。行为红灯保留在 `/tmp/companion-input-lifecycle-red.log`；现在打开只记录一次显示意图，收起取消意图，ready 只执行仍然有效的请求。

桌宠默认关闭时不创建伙伴窗口。实际显示桌宠后，至多预备一个隐藏壳，不聚焦；渲染器先订阅再读取只读可见性，实际打开后才 bootstrap 对话，隐藏期间不刷新/轮询。初始读取迟到不得覆盖更新的原生 show/hide，卸载取消订阅和迟到结果。浏览器检查确认隐藏预备时 bootstrap 为零，真实显示后才加载，收起后变更通知不加载，草稿保留。

| 独立运行 | 首次自动化输入完成 | 重复打开 P95（30 次） | 边界 |
| --- | --- | --- | --- |
| 原开发 renderer | 573.4ms | 50.1ms | Vite 与自动化往返均包含 |
| 原生产 renderer | 401.0ms | 48.1ms | 回环静态资源、开发 Electron 壳 |
| 隐藏预备后的生产 renderer | 253.6ms | 47.6ms | 预备窗口确已存在；首次仍未达到 200ms |

后续补充真实焦点事件采样，保留自动化往返数据：一次独立运行中，点击前到启用文本框真正获得焦点为 236ms，自动化输入字符并验证完毕为 345.4ms，30 次重复打开的输入完成 P95 为 51.0ms。焦点在 renderer 事件发生时以 Date.now 记录，与宿主点击前的同一墙钟相减；确认事件不早于点击，且不晚于完整输入往返。该次首次焦点仍超过 200ms，`firstInputTargetMet=false`，没有通过换指标标成达标。

原始结果：[原生产资源](../companion-input-2026-10-26/before-bundled.json)、[预备后完整往返](../companion-input-2026-10-26/prepared-roundtrip.json)、[预备后焦点与往返](../companion-input-2026-10-26/prepared-focus-events.json)。实际发布范围的明暗气泡均仅显示小远；多伙伴测试专用夹具用于隔离回归，未作为本版选择入口。

另定位到每次相同会话刷新仍会替换两次相同主题样式。真实 DOM MutationObserver 的红灯收到 2 次替换，修复后为 0；只在规范化后的主题包或明暗偏好变化时更新，未修改主题引擎、配色或 recipe，真实主题/语言热切换继续通过。最初截取的深色帧在初始化绘制中偏黑，稳定状态与对比度检查正常；补上首个可用输入状态和纸面前景色一致性、axe 检查后保存[浅色](../companion-input-2026-10-26/bubble-en-light.png)/[深色](../companion-input-2026-10-26/bubble-en-dark.png)，没有据此重画或改色。

最终代码先完成一次与单测/Knip 并行的采样，真实首次焦点为 260ms、输入完成 395.6ms、warm P95 137.5ms，完整记录在[并行检查采样](../companion-input-2026-10-26/context-during-checks.json)。本地检查结束后独立重测一次：首次焦点 **220ms**，输入完成 **256.1ms**，30 次重复打开的输入完成 P95 **81.5ms**，见[最终独立采样](../companion-input-2026-10-26/final-idle-input.json)，日志 `/tmp/companion-input-native-idle-final.log`。两次都保留 `firstInputTargetMet=false`；首次 200ms 目标仍未完成，不将独立运行差异归因为固定性能收益。

计时从实际角色点击前开始，到文本框聚焦、输入字符并验证值为止；没有仅以窗口出现或 warm 结果冒充可输入/首次结果。三次独立运行不能证明固定倍数收益。原生脚本原样保留 `firstInputTargetMet=false`，目标没有放宽。尚需继续减少首次等待，并在实际安装包、多次冷启动及更多平台验收 P95；无角色显示时首次全局快捷键的冷启动也未验收。

日志：`/tmp/companion-input-native-fixture.log`、`/tmp/companion-input-native-bundled.log`、`/tmp/companion-input-native-prepared.log`、`/tmp/companion-input-native-ready-events.log`。初次脚本在无模型时试图进入工作台，按既有逻辑跳到设置，未找到工作台输入框而失败；之后先使用本机合成模型进入工作台，最后再禁用它验证降级，没有修改应用的模型引导行为。

## 本轮检查

- 43 项相关单测与 22 项浏览器检查通过，覆盖隐藏/加载/收起竞态、输入可见性、文件草稿/迟到回执/不可用附件、明暗中英文、最小 448px 窗口、主题与焦点/选区/弹层连续性，仅开放小远。
- 新只读共享契约完成后，渲染器与共享模块完整回归 361 文件、1,942 项通过，记录 `/tmp/companion-input-renderer-shared.log`；这是 renderer/shared 范围，不宣称全应用发版测试。源码行数、大文件与生成桥校验通过，既有暂存的两份旧首页删除保持原样，没有扩大提交或忽略范围。
- 前后端类型、生成桥一致性、生产构建与 bundle budget 通过。新只读 IPC 验证所属主帧与空参数，不暴露通用窗口或文件能力。
- 常规/生产 Knip、lint、格式、主进程编译通过；lint 的无关存量告警保留，不宣称零告警或完整发布门禁。手动验收脚本作为实际 CLI 入口纳入 Knip 导入图，没有新增 ignore/白名单豁免。
- 原生附件任务复验通过：原生对话框授权文件、真实工具读取、同一 Task/Run 在工作台展开、受理回执去重，删除原测试文件后仍返回同一已受理回执；4 次本机模型请求中 2 次任务、2 次既有维护，无额外任务副本。见[结果](../companion-input-2026-10-26/native-task-files.json)，日志 `/tmp/companion-input-task-files-native-final.log`。旧验收在免打扰已收起气泡后直接截图而超时；现在先断言解除免打扰没有自动弹出，再从真实菜单显式打开后截图，原任务断言全部保留。
- 原生窗口复验覆盖点击招呼、上下锚定、移动焦点、独立草稿与免打扰，见[结果](../companion-input-2026-10-26/native-bubble-lifecycle.json)，日志 `/tmp/companion-input-bubble-native.log`；本轮没有重跑全局记忆界面矩阵。
- DESIGN.md 十节：没有改变控件外观、字号、色系、间距或媒体，因此对应新视觉规格不适用；复用原铅笔气泡和共享输入、按钮、附件及主题。主要动作、键盘、禁用/输入/错误状态、明暗窄窗、草稿和原位切换按上述浏览器与原生结果通过。全局应用所有页面、真实 OS 候选窗、真实 Windows、安装和发布没有据此标通过。
- 欢迎动画、角色素材和其他六位的隐藏范围没有改变。没有新增用户侧模型或外观设置。
