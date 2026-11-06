# 知远智能体 · Figma 设计系统同步器 (ZhiYuan Design System Synchronizer)

本插件是知远智能体（ZhiYuan Agent）前端团队与设计团队之间的自动化规范同步桥梁，专门用于将生产代码与 `DESIGN.md` (v4.0 Quiet Studio) 的几何居中与 Auto Layout 规范自动同步到官方 Figma 设计稿中。

- **目标 Figma 文件**: [知远智能体 — 产品现状与设计重构](https://www.figma.com/design/l1IdC96sLjXx5CfPwcG4pQ/知远智能体-—-产品现状与设计重构?node-id=0-1&p=f&t=BUtatH2p9uYgPDiH-0) (`fileKey: l1IdC96sLjXx5CfPwcG4pQ`)
- **云端部署插件 ID**: `77f95319-bde7-45c4-b9f9-10e5859f3075` (发布至团队库 `Hawk Li's team`)

---

## 一键云端运行入口

点击以下链接即可直接在目标 Figma 设计文件中加载并运行该同步器：
👉 **[在 Figma 中打开并运行同步器](https://www.figma.com/design/l1IdC96sLjXx5CfPwcG4pQ/知远智能体-—-产品现状与设计重构?try-tool-resource-content-id=77f95319-bde7-45c4-b9f9-10e5859f3075&try-tool-resource-type=gen_tool)**

在新设计文件中试用：
👉 **[在空白 Figma 文件中试用同步器](https://www.figma.com/file/new?try-tool-resource-content-id=77f95319-bde7-45c4-b9f9-10e5859f3075&try-tool-resource-type=gen_tool&type=design&mode=design)**

---

## 本地导入运行步骤 (Figma Desktop)

若在 Figma 桌面客户端本地开发运行：
1. 打开 Figma Desktop 客户端；
2. 进入菜单 `Plugins` -> `Development` -> `Import plugin from manifest...`；
3. 选择本项目中的 `docs/design/figma-sync-plugin/manifest.json`；
4. 打开目标文件 `知远智能体 — 产品现状与设计重构`；
5. 在右键插件菜单中点击「知远智能体 · 布局几何对齐同步器」；
6. 在弹出的交互控制面板中，点击「⚡ 一键全量规范同步 (FIG1-FIG11)」或按需分项点击执行。

---

## 8 大核心重构任务执行明细 (FIG1 - FIG11)

| 任务编号 | 针对画板 / 节点 | 核心修正与几何重构 |
|---|---|---|
| **FIG1** | Page 02 根画板 (`6:131` 浅色, `7:105` 深色) | 开启 Auto Layout `HORIZONTAL`，`padding=8`, `gap=0`, `alignItems="CENTER"`；舞台 `6:252` 设为 `Fill container` & `cornerRadius=12` |
| **FIG2-FIG4** | 1012px 主舞台居中流 (`6:255`-`6:265`, `7:133`-`7:143`) | 纠正 1px 偏心误差：问候语 (288px) 居中至 `x=362`；说明 (378px) 居中至 `x=317`；输入岛 (768px) 居中至 `x=122`；快捷动作胶囊组 (690px) 居中至 `x=161` |
| **FIG5** | 核心输入岛 (`6:257`, `7:135`) | 统合底部配件垂直基线 (文本 `y=100`, 发送圆形按钮 `y=94`, 中心线严格对齐在 `y=110`)，彻底消除历史 7px 锯齿晃动 |
| **FIG6** | 任务会话阅读流 (Page 03, `12:275`, `12:320`) | 规范化会话阅读列为 896px (`max-w-4xl`) 对称居中 (`x=58px`)，续聊输入岛 `12:334` 宽度从非标 872px 重构为标准 896px |
| **FIG7 & FIG8** | 基础组件母版体系 (Page 01, `4:33`) | 侧栏导航行母版 `4:34` 重构为 Auto Layout `Fill container` (244px)；通用按钮母版 `4:60` 等 8 个状态设为 Auto Layout `Hug contents` (`px=12`, `gap=8`)；快捷胶囊 `6:124` 设为 `Hug contents` |
| **FIG9** | 设置中心 (Page 04, `9:107`, `9:152`) | 设置行母版 `9:100` 设为 744px 撑满内容列；底栏关闭按钮 `9:218` 右对齐至 744px 内容列右边线 (`x=740`)，消除 5px~25px 错位 |
| **FIG10** | 模态弹窗系统 (Page 01, Page 05) | 创建标准 448px Form Dialog (`Dialog / Form / 448`) 与 448px Confirm Dialog (`Dialog / Confirm / 448`)；治理业务弹窗 `16:1008` (从非标 672px 缩减至标准 512px，消除定时分钟溢出) |
| **FIG11** | 本地推理模型卡片 (Page 06, `24:301`, `25:291`) | 卡片网格垂直与水平间距严格规范为 `gap=16`，保证动态高度变化自适应流动 |
