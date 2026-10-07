---
name: rongxinai-ui-adapter
description: 知远智能体产品 UI 的项目适配入口，用于组件选择、主题 token/recipe 定位、i18n 和交互验证。适用于 Work、Chat、Settings、MCP、Skills 等产品页面；营销页面另按项目规则选择视觉技能。
---

# 知远智能体 UI 适配

本文路径均相对项目根目录。先读当前 `AGENTS.md` 和 `DESIGN.md` 的相关章节；本技能提供代码导航，不复制视觉数值或覆盖规范。Claude 的 `CLAUDE.md` 通过 `@AGENTS.md` 导入同一份规则。

## 如何选择入口

- 已有页面的视觉或布局调整：先读 `.codex/skills/frontend-ui-change-strategy/SKILL.md`，完成其分析与方案流程；同一具体方案已有明确授权时直接实施，不重复确认。
- 新增或调整产品 UI：用下表定位共享实现，并完整读受影响组件、状态来源、样式 recipe 和相关测试。
- landing、营销或品牌页：按 AGENTS.md 使用当前环境可用的视觉技能，仍受项目规范约束。技能不在项目或当前环境中时报告实际缺口，不猜测其内容，也不为引用名称自动安装依赖。

## 组件选择矩阵

| 需求 | 先检查的实现 |
| --- | --- |
| 功能页顶栏与窗口拖拽边界 | `src/renderer/components/PageHeader.tsx` |
| 页面标签页 | `src/shared/components/ui/page-tabs.tsx`，放入 PageHeader 的 tabs 槽位 |
| 分段、筛选 | `src/shared/components/ui/fluid-tabs.tsx` |
| 删除确认 | `src/shared/components/ui/destructive-confirm-dialog.tsx` |
| 按钮、输入、选择、表单、菜单与弹层 | `src/shared/components/ui/` 下的 button、input、select、field、dropdown-menu、dialog、sheet、popover、tooltip 等实际文件 |
| 对话容器、消息、输入 | `src/shared/components/ai-elements/` 下的 conversation.tsx、message.tsx、prompt-input.tsx |
| 推理、工具、附件、代码 | `src/shared/components/ai-elements/` 下的 reasoning.tsx、tool.tsx、attachments.tsx、code-block.tsx |

使用共享组件实际导出的 props/类型，不照搬组件库网站或旧示例的 API；第三方 API 查本项目 node_modules 声明。图标使用 lucide-react。不得用裸 div 点击区、手写 SVG 图标或自造基础控件替代项目范式。

## 外观改在哪里

| 改动 | 事实入口 |
| --- | --- |
| 找现有视觉语义与变量 | `src/renderer/theme/tokens/contract.ts` |
| 找控件 hook、状态与属性白名单 | `src/renderer/theme/components/contract.ts` |
| 改组件外观或状态 | `src/renderer/theme/components/` 中现有 recipe |
| 查主题注册及明暗配套 | `src/renderer/theme/themes/plugins.ts`、`src/renderer/theme/themes/types.ts` |
| 查生成、热切换及边界 | `src/renderer/theme/README.md`、`src/renderer/theme/engine/`、`src/renderer/theme/components/css.ts` |
| 查 --zy-* 与 shadcn 语义变量桥接 | `src/renderer/theme/css/shadcn-token-bridge.css`、`src/renderer/theme/css/tailwind.css`；不在技能中另存映射快照 |

先查现有 token/recipe，再决定是否需扩共享 variant/size 或注册 hook；新增视觉语义先更新 DESIGN.md 与契约，再补齐所有注册主题。完整状态使用项目的 COMPONENT_STATES 与 recipe()，不加任意选择器、提权重、!important 或未登记变量。

页面和共享组件保留 DOM、业务状态、排列、响应式、滚动、命中区、键盘和焦点；控件自身固定尺寸、内边距、颜色、字号、圆角、阴影和视觉动效归 recipe。即使引用语义 token，也不得在调用点用外观 utility 或局部 CSS 覆写控件。Button 的 className 只用于布局；样式通过共享 variant/size 选择。

`src/renderer/theme/css/themes.css` 由 `bun run theme:generate` 生成，不手改。切换主题原位更新，不能换 React key、重挂编辑器或清空草稿、附件、焦点、选中、弹层和滚动。用户仅选择整套主题与明暗模式，不增加独立样式设置。

## 文案、常量与业务边界

- renderer 文案使用 `src/renderer/services/i18n.ts` 的 t()，主进程用户文案使用 `src/main/i18n.ts`，新增键同时提供 zh/en。
- 重用多处比较的模式、状态和 IPC 常量；模块按项目 constants.ts 约定维护，测试也导入同一常量。一次性文案与 CSS/React 属性不据此常量化。
- 展示层接收真实数据和回调，不为视觉示例虚构状态、增加 IPC 或改变权限、持久化、网络与任务行为。Artifacts 的 iframe、SVG 清理及 Mermaid 安全边界继续保持。

## 产品边界

界面名称使用知远智能体（ZhiYuan Agent）；Pi、cc-connect、llama.cpp 等内部实现不进入普通界面文案。保持现有功能入口、权限和数据流，视觉调整不自动授权新增模型、网络开放或迁移行为。

## 验证与交付

- 纯技能/规范文档改动：核对路径、导入文件、触发条件和规范一致性，运行 `git diff --check`；不能据此宣称 UI 验收。
- 代码改动：运行 `npm run lint` 和受影响测试；新增/修改测试实际运行。按 AGENTS.md 完成格式检查及相应构建检查。
- token/recipe/生成器变化：运行 `bun run theme:generate`。共享主题契约或引擎变化另运行 `npx vitest run src/renderer src/shared`、`npm run build`、`npm run test:bundle-budget`。
- 实际 UI 改动：在 `npm run electron:dev` 验证相关流程、light/dark、窄窗口、长文案、键盘、适用及组合状态、portal、减少动效和主题热切换；确认草稿、焦点等状态连续。
- 对照 DESIGN.md 的落地检查清单逐项报告通过、不适用及原因或未通过项。交付说明列出实际命令、运行覆盖与未验证边界，不用编译通过代替交互证据。
