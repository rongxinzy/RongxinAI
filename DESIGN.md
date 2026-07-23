# DESIGN.md

RongxinAI 前端设计标准。本文件是**项目级约束**：所有新增和修改的 UI 代码必须遵守。与 `AGENTS.md` 的组件库规则配套使用。

## 技能参考

涉及 UI 实现时，**必须参考以下技能**（通过 `/` 或 Skill 工具加载，优先级从高到低）：

1. **`shadcn`** — shadcn/ui 组件用法、样式规则、表单、组合、图标。项目中 shadcn 组件安装于 `@shared/components/ui/*`。
2. **`ai-elements`** — Vercel AI Elements 的 AI 原生组件（`Message`、`PromptInput`、`ModelSelector`、`Conversation`、`Suggestion`、`Reasoning`、`Sources` 等）。安装于 `@shared/components/ai-elements/*`。
3. **`rongxinai-ui-adapter`** — 本项目适配层：文件位置约定、i18n（`t()` 包裹所有用户可见文本）、常量（`as const` 对象定义判别值）、lobster theme 映射表、页面级组件选择矩阵、以及 `--zy-*` ↔ shadcn 语义 token 的对应关系。

**使用规则：**

- 任何新增 UI 组件，首先查上述技能是否有现成的 shadcn / ai-elements 组件可用，**禁止自造轮子**。
- 组合现有组件时遵循 shadcn 技能的样式范式（`FieldGroup` + `Field` 而不用 `space-y-*`；Button 的 `variant`/`size` 枚举等）。
- 所有面向用户的文本通过 `t('key')` 走 i18n，键同时补充 `zh` / `en` 两套。
- 状态判别、IPC 通道、模式选择器等字符串常量必须定义为 `as const`，禁止裸字符串字面量。

## 设计方向

以 **Kimi、Codex 这一代 AI 产品的质感**为基准：中性、克制、内容优先。

- **界面退后，内容向前。** 界面骨架由中性灰构成，颜色只出现在该出现的地方（品牌强调、状态语义）。不做炫技的渐变、发光、彩色装饰。
- **用留白和字重建立层级，而不是用颜色和边框。** 分组靠间距，强调靠字重，分隔优先用空白，其次用 1px 细线，最后才是阴影。
- **暗色与亮色是同一套设计的两个面。** 主题只保留：浅色 / 深色 / 跟随系统。不再新增彩色主题。所有设计决策必须同时在两种外观下成立。

## 色彩

### 事实来源（过渡期双真源）

颜色只允许通过语义 token 使用。当前存在**两层变量，值同步**：

1. **shadcn 语义层** —— `src/renderer/theme/css/shadcn-token-bridge.css`
   `:root` / `.dark`（并挂 `[data-theme]` 别名）直写 oklch。这是与标准 shadcn 语义表逐值一致的真源，含 `--sidebar-primary` 暗色蓝、`--chart-1..5`、`--radius: 0.625rem`。
2. **项目兼容层** —— `src/renderer/theme/css/themes.css` 的 `--zy-*`（oklch）
   供仍使用 `var(--zy-*)` / `bg-surface` 等的存量组件消费；`tokens/contract.ts`、`themes/classic-light.ts`、`themes/classic-dark.ts` 与之同步。

Tailwind 工具类经 `index.css` 中 `@theme` 块桥接：`--color-background: var(--zy-background)` 等映射到 `--zy-*`，shadcn 语义名（`card`、`popover`、`secondary`、`muted` 等）映射到 bridge 的 `var(--语义名)`。组件可通过 `bg-background` / `bg-card` / `text-muted-foreground` 等 utility 消费，也可直接用 `var(--zy-*)`。

> **过渡说明**：两层构成双真源。彻底单层需将存量组件的 `var(--zy-*)` / `bg-surface` 全部迁到 shadcn 语义名，留待后续重构。新建组件**应优先使用 shadcn 语义 utility**（`bg-card`、`text-muted-foreground` 等），减少对 `--zy-*` 的新增依赖。

**禁止：**

- 在组件中直接写 hex / rgb / hsl 色值（如 `bg-[#3B82F6]`、`text-gray-500`、`bg-white`）。
- 使用 Tailwind 默认彩色刻度（`blue-*`、`gray-*`、`slate-*` 等）。唯一的例外是灰度语义化之前的临时迁移代码。
- 新增一次性颜色。需要新颜色时，先加到 token 契约，再在明暗两套主题中各给出一个值。

### 色板角色

| 角色     | Token                                         | 用途                                                   |
| -------- | --------------------------------------------- | ------------------------------------------------------ |
| 画布     | `background`                                  | 应用底层背景                                           |
| 表面     | `surface`                                     | 卡片、侧边栏、输入框底色                               |
| 浮起表面 | `surface-raised`                              | hover 态、次级填充、开关轨道                           |
| 覆盖层   | `surface-overlay`                             | 弹层、下拉、浮窗                                       |
| 主文本   | `text-primary` / `foreground`                 | 正文、标题                                             |
| 次文本   | `text-secondary` / `text-muted-foreground`    | 辅助说明、时间戳、占位符、搜索无匹配结果及紧凑空态     |
| 弱文本   | `text-muted`                                  | 禁用态、最次要信息                                     |
| 边框     | `border` / `border-subtle`                    | 分隔线、控件描边                                       |
| 强调     | `primary` / `primary-hover` / `primary-muted` | 唯一的品牌强调色，用于主按钮、激活态、链接、focus ring |
| 状态     | `destructive` / `success` / `warning`         | 仅用于语义状态，不作装饰                               |

规则：

1. **强调色唯一。** 一个屏幕内，`primary` 只出现在一个主要动作和少数激活态上。禁止用强调色给普通图标、普通文本"提色"。
2. **状态色不装饰。** 红/绿/黄只表达危险、成功、警告。
3. **层级公式：** 背景每浮起一层（background → surface → surface-raised → overlay），明暗差异缩小一档；不要跳档制造高反差色块。
4. 明暗主题共用同一套 token 名，组件代码不得出现 `dark:` 前缀的单独配色——差异必须在 token 层解决。个别结构性例外（如纯黑遮罩 `bg-black/40`、nav 悬浮的透明度叠加 `hover:bg-black/3 dark:hover:bg-white/4`）允许保留。
5. **搜索空结果使用次文本。** 关键词无匹配、无可选项等紧凑空态使用 `text-sm text-muted-foreground`，不使用主文本、状态色或额外边框；完整空状态页面再按空状态组件规范处理。

## 字体

### 字体族

- **界面字体：** 系统字体栈（`index.css` 中 `:root` 已定义：SF Pro / PingFang SC / Microsoft YaHei / Inter / system-ui 等）。禁止引入 Web 字体文件。
- **代码字体：** `'SF Mono', 'Fira Code', Menlo, Monaco, 'Courier New', monospace`。所有代码块、行内代码、终端、diff 统一使用。
- 全局统一，禁止在组件上用 `font-family` 覆盖。

### 字号刻度

只允许以下五档（Tailwind 类名），新增场景先匹配现有角色，不要发明第六档：

| 档位 | 类名        | 尺寸 | 用途                                            |
| ---- | ----------- | ---- | ----------------------------------------------- |
| 辅助 | `text-xs`   | 12px | 时间戳、badge、caption、快捷键提示              |
| 次要 | `text-sm`   | 14px | **默认字号。** 正文、消息、按钮、列表项、设置项 |
| 强调 | `text-base` | 16px | 区块标题、面板标题                              |
| 页面 | `text-lg`   | 18px | 页面级标题、空状态主标题                        |
| 展示 | `text-xl`   | 20px | 仅用于空状态/欢迎页等展示场景，一张屏幕至多一处 |

### 字重

只允许三档：

| 字重 | 类名            | 用途                                         |
| ---- | --------------- | -------------------------------------------- |
| 400  | `font-normal`   | 默认正文                                     |
| 500  | `font-medium`   | 按钮、选中态、需要轻微突出的标签             |
| 600  | `font-semibold` | 标题、当前激活项（如侧边栏模式切换的选中侧） |

禁止 `font-bold`（700）及以上，唯一例外是品牌字标（如侧边栏"知远"）。**用 500/600 区分层级，不要用字号跳变或颜色。**

### 行高

| 场景         | 值                                        | 说明               |
| ------------ | ----------------------------------------- | ------------------ |
| 单行控件文本 | `leading-none` ~ `leading-tight` (1–1.25) | 按钮、标签、导航项 |
| 标题         | `leading-snug` (1.375)                    |                    |
| 正文/消息    | 1.6（全局默认，不额外设置）               | 阅读场景           |
| 代码块       | `leading-relaxed` (1.625)                 |                    |

## 圆角

基准值 `--zy-radius` = **10px**（0.625rem），同步于 `shadcn-token-bridge.css` 的 `--radius: 0.625rem`。派生刻度：

| 圆角    | 类名                        | 用途                                                        |
| ------- | --------------------------- | ----------------------------------------------------------- |
| 8px     | `rounded-sm` / `rounded-md` | 按钮、输入框、下拉项、badge、行内代码块、小图标按钮         |
| 10px    | `rounded-lg`                | **默认。** 卡片、面板、导航项、侧边栏分组                   |
| 14px    | `rounded-xl`                | 对话框、大型弹层、代码块容器                                |
| 全圆    | `rounded-full`              | 头像、分段控件滑块、胶囊形元素                              |

规则：

1. 同一容器内，子元素圆角 ≤ 父元素圆角，视觉上保持同心。
2. 禁止任意值圆角（`rounded-[7px]` 等）；刻度不满足时优先改设计，其次扩展刻度。
3. 拼接控件（ButtonGroup 等）相邻边圆角归零，由统一的 CSS 规则处理（参考 `index.css` 中 button-group 段）。

## 阴影

定义于 `index.css` `@theme` 块中，将 Tailwind 内置 `--shadow-sm/md/lg/xl/2xl` 以字面值映射到项目档位（保证 v4 `@theme` 下确定生效，无 var 链），并额外提供 `--shadow-inset` 用于内嵌态。**禁止手写 `shadow-[...]` 任意值**：

| 级别                 | 类名                               | 用途 |
| -------------------- | ---------------------------------- | ---- |
| `shadow-sm`          | 极轻的浮起感                       | 默认、hint |
| `shadow-md`          | 卡片级                             | 卡片、控制柄滑块 |
| `shadow-lg`          | 悬浮级                             | hover 浮起、sticky 栏 |
| `shadow-xl`          | 弹层级                             | 对话框、modal |
| `shadow-2xl`         | 最远浮层                           | popover、tooltip |
| `shadow-inset`       | 内嵌凹陷                           | switch 轨道、work/chat 轨道、分段控件轨道 |
| `shadow-glow-accent` | 品牌光晕                           | 仅用于脉冲指示点、loading 标记，一页至多一处 |

规则：

1. **边框优先，阴影殿后。** 浅色主题下能用一个 1px `border` 说清的层级，不用阴影。阴影只用于"真正浮在内容之上"的元素（弹层、对话框）。
2. 暗色主题慎用阴影（深色上阴影不可见），层级用表面色明度差 + 边框表达。
3. 普通按钮、输入框**不加阴影**。

## 间距与填充

- 以 **4px 为基准网格**，只使用 Tailwind 标准间距刻度（`p-1`=4px … `p-6`=24px）。禁止 `p-[13px]` 这类任意值。
- 约定俗成的填充模式：

| 场景         | 模式                                                              |
| ------------ | ----------------------------------------------------------------- |
| 侧边栏分组   | 水平 `px-3`，组内项间距 `space-y-0.5`，组间 `space-y-2` 或 `mt-2` |
| 导航/列表项  | `px-3 py-1.5`，圆角 `rounded-lg`                                  |
| 按钮（默认） | 组件库默认（`h-9 px-4`），小号 `h-8 px-3`                         |
| 图标按钮     | `h-8 w-8`，图标 `h-4 w-4`                                         |
| 卡片         | `p-4`；密集卡片 `p-3`                                             |
| 对话框       | 内容区 `p-6`， footer `px-6 py-4`                                 |
| 表单行距     | `space-y-4`                                                       |

- 图标与文字并排时间距 `gap-1.5`（紧凑）或 `gap-2`（默认）。

## 边框

- **宽度一律 1px**（`border`，不显式写 `border-1`）。唯一允许 2px+ 的地方是 focus ring 和个别进度条。
- 颜色只用 token：常规 `border-border`，更弱的分隔 `border-border-subtle`，输入框 `border-input`。
- hover 不改变边框宽度（避免布局抖动），只改颜色或背景。
- **所有浮层必须有边框。** Popover、Dropdown、Select、HoverCard 与 Dialog 使用 `border border-border`，不得以 `ring` 模拟边框或用 `border-0` 移除；二级子菜单同样保留边框，可按动效规则即时展开。

## 透明度

透明度只用于**状态**，不用于**配色**：

| 场景                       | 做法                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| 禁用态                     | `opacity-50`（配合 `pointer-events-none`）                                                          |
| 非激活的分段选项           | `opacity-50` + 激活时恢复（参见下方范例）                                                           |
| 加载骨架闪烁               | `animate-shimmer` 内置                                                                              |
| 模态遮罩                   | `bg-black/40` + `backdrop-blur-sm`（`.modal-backdrop`）                                             |
| 其余一切"让颜色变浅"的需求 | **禁止用 opacity 实现**，改用对应的弱档 token（`text-secondary`、`border-subtle`、`primary-muted`） |

原因：opacity 会让元素与背后的内容混色，在明暗两套主题下表现不一致；token 才能在两套主题中各自取到正确的值。

## 动效

- 时长：**150–250ms**，统一 `ease-out`（或 `transitionTimingFunction.smooth`）。超过 300ms 的动画需要理由。
- 可动属性只有 `opacity` 和 `transform`；禁止动画化 width/height/top/left（布局抖动）。结构性位移（如侧边栏宽度）沿用已有的受控例外。
- 入场动画用 `index.css` `@theme` 中已有的：`animate-fade-in` / `fade-in-up` / `fade-in-down` / `scale-in` / `message-in`。不新增 keyframes，除非现有组合确实无法表达。
- 必须遵守 `prefers-reduced-motion`（全局 CSS 已处理，新增自定义动画时验证）。

## 组件范式范例：分段切换控件

侧边栏顶部的「工作 / 对话」模式切换（`src/renderer/components/Sidebar.tsx`，样式见 `index.css` 中 `[data-mode="work-chat"]` 段）是本项目的**控件质感基准**，新做开关、分段控件、Tab 切换时参照它：

1. **全宽胶囊轨道**：轨道用中性灰 `rgb(237, 237, 236)` + 1px 边框 + `shadow-inset`，与背景分得开但不抢眼。
2. **滑动玻璃滑块**：全圆角滑块宽度超出轨道 2px、带 `shadow-md` 级投影，200ms ease 滑动，方向感清晰。
3. **状态用文字表达，不用色块**：选中侧 `font-semibold text-foreground`，未选侧 `font-normal text-muted-foreground opacity-50`；不靠强调色染色。
4. **纯文本，无图标**：两侧各一个 `text-sm` 标签居中定位在轨道 25%/75% 位置。
5. **整行可点**：点击目标是整个控件区域，不只是滑块。

这套语言推广到所有开关/切换类组件：中性的轨道、明确的滑动反馈、文字层级表达选中态、200ms 内的动效。

## 交互状态

所有可交互元素必须具备完整状态链，缺一不可：

- **hover**：背景变浅一档（`hover:bg-surface-raised`）或文字变深一档；200ms 内过渡。
- **active/pressed**：可省略，由 hover 延续。
- **focus-visible**：统一 focus ring（`.focus-ring` 或组件库默认），颜色取 `primary`，不得移除焦点样式而不提供替代。
- **disabled**：`opacity-50` + 禁止指针事件，不改变配色结构。

## 落地检查清单

提交 UI 代码前逐项自查：

- [ ] 没有直接写死的色值 / Tailwind 默认彩色刻度；全部走 `--zy-*` token 或其桥接工具类
- [ ] 没有 `dark:` 前缀的单独配色（主题差异在 token 层解决；结构性例外如透明度叠加 `hover:bg-black/3 dark:hover:bg-white/4`、模态遮罩等允许）
- [ ] 字号在五档之内，字重在 400/500/600 之内
- [ ] 圆角、阴影只用本文件定义的刻度，无任意值
- [ ] 边框 1px，颜色用 token
- [ ] 透明度只用于状态，配色变浅一律换 token
- [ ] 动效 ≤250ms，只动 opacity/transform
- [ ] 每个可交互元素有 hover / focus / disabled 状态
- [ ] 亮色与暗色两种外观下都看过效果
- [ ] 组件优先使用 shadcn/ui 与 ai-elements（见 AGENTS.md），未自造轮子
