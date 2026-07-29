# DESIGN.md

RongxinAI 前端设计标准。本文件是**项目级约束**：所有新增和修改的 UI 代码必须遵守。与 `AGENTS.md` 的组件库规则配套使用。

## 技能参考

涉及 UI 实现时，**必须参考以下技能**（通过 `/` 或 Skill 工具加载，优先级从高到低）：

1. **`shadcn`** — shadcn/ui 组件用法、样式规则、表单、组合、图标。项目中 shadcn 组件安装于 `@shared/components/ui/*`。
2. **`ai-elements`** — Vercel AI Elements 的 AI 原生组件（`Message`、`PromptInput`、`ModelSelector`、`Conversation`、`Suggestion`、`Reasoning`、`Sources` 等）。安装于 `@shared/components/ai-elements/*`。
3. **`rongxinai-ui-adapter`** — 本项目适配层：文件位置约定、i18n（`t()` 包裹所有用户可见文本）、常量（`as const` 对象定义判别值）、`--zy-*` 主题映射表、页面级组件选择矩阵、以及 `--zy-*` ↔ shadcn 语义 token 的对应关系。

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

### 质感目标：轻盈、流畅、有呼吸感

在"克制"的底色之上，产品应当感觉**轻盈、流畅、有呼吸感**——这与克制不矛盾，它靠节奏和留白实现，不靠加特效：

- **轻盈** = 视觉重量低 + 动效质量感小。视觉重量由本文件的色彩/边框/字重规则保证；动效质量感小意味着小幅度、短距离、快速到位的运动，没有沉重的大位移和迟缓的过渡。
- **流畅** = 轨迹连续，没有断裂点。流畅的反义词不是"慢"，是"断"：硬切、闪屏、中途重挂载都是断裂。具体规则见「交互手感」。
- **呼吸感** = 节奏。内容按次序落位而不是整屏同时砸出来；留白有疏密；进行中的状态有缓慢的生命迹象（脉冲、微光）。一屏的呼吸感由一处编排好的节奏提供，不是到处都在动。
- **不呆板** = 微交互覆盖。每个可交互元素对 hover/press 都有即时、轻微的回应（见「动效语言」）。微交互单个不起眼，合在一起是"做得用心"的直觉。

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
| 技能着色 | `skill-blue`（`--zy-skill-blue-foreground/background`） | 已挂载技能胶囊（ActiveSkillBadge）的文字与 hover 底色；唯一的功能性蓝色例外，不推广到其他元素 |

### 当前色值参考（Light）

| Token | oklch | 等效 RGB |
|-------|-------|----------|
| `--zy-primary` / `--zy-foreground` / `--zy-text-primary` | `oklch(0.366 0.008 253)` | `rgb(60, 63, 67)` |
| `--zy-text-secondary` / `--zy-text-muted` | `oklch(0.553 0.013 58.071)` | ≈ `rgb(128, 125, 119)` |
| `--zy-background` | `oklch(1 0 0)` | `#ffffff` |
| `--zy-surface-raised` | `oklch(0.97 0.001 106.424)` | ≈ `#f5f5f4` |
| `--zy-border` | `oklch(0.923 0.003 48.717)` | ≈ `#e7e5e4` |
| `--zy-destructive` | `oklch(0.577 0.245 27.325)` | ≈ `#ef4444` |

> `primary`、`foreground`、`text-primary` 三者同值（`rgb(60,63,67)`，冷灰偏蓝），是 2026-07-28 验收后确定的统一主色。

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

只允许以下六档（Tailwind 类名），新增场景先匹配现有角色，不要发明第七档：

| 档位 | 类名        | 尺寸 | 用途                                            |
| ---- | ----------- | ---- | ----------------------------------------------- |
| 辅助 | `text-xs`   | 12px | 时间戳、badge、caption、快捷键提示              |
| 次要 | `text-sm`   | 14px | **默认字号。** 正文、消息、按钮、列表项、设置项 |
| 强调 | `text-base` | 16px | 区块标题、面板标题                              |
| 页面 | `text-lg`   | 18px | 页面级标题、空状态主标题                        |
| 展示 | `text-xl`   | 20px | 仅用于空状态/欢迎页等展示场景，一张屏幕至多一处 |
| 超大 | `text-xxl`  | 22px | 页面 hero 主标题，一张屏幕至多一处              |

刻度为等差数列（公差 2px）。`text-xxl` 非 Tailwind 原生类，由 `index.css` `@theme` 中的 `--text-xxl: 22px`（行高 1.375）定义。

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
4. **唯一例外：主输入框（hero prompt input）容器允许 `rounded-3xl`。** 它是产品的中心舞台元素，更大的圆角是有意的识别特征；此例外不推广到其他容器。

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
| 模态遮罩                   | `bg-black/10`（`.modal-backdrop` 与共享 Dialog/Sheet overlay），只变暗、**不使用 backdrop-blur**     |
| 其余一切"让颜色变浅"的需求 | **禁止用 opacity 实现**，改用对应的弱档 token（`text-secondary`、`border-subtle`、`primary-muted`） |

原因：opacity 会让元素与背后的内容混色，在明暗两套主题下表现不一致；token 才能在两套主题中各自取到正确的值。

## 动效

- 时长：**150–250ms**，统一 `ease-out`（或 `transitionTimingFunction.smooth`）。超过 300ms 的动画需要理由。
- 可动属性只有 `opacity` 和 `transform`；禁止动画化 width/height/top/left（布局抖动）。结构性位移（如侧边栏宽度）沿用已有的受控例外。
- 入场动画用 `index.css` `@theme` 中已有的：`animate-fade-in` / `fade-in-up` / `fade-in-down` / `scale-in` / `message-in`。不新增 keyframes，除非现有组合确实无法表达。
- 必须遵守 `prefers-reduced-motion`（全局 CSS 已处理，新增自定义动画时验证）。

### 动效语言

动效分三档，各自的幅度和时长不得混用：

| 档位 | 场景 | 幅度 | 时长 |
| ---- | ---- | ---- | ---- |
| 微交互 | hover / press / focus / 状态切换 | 位移 1–2px；背景或阴影换一档；图标形变 | 100–150ms |
| 过渡 | 视图切换、展开收起、弹层进出 | 位移 4–28px；opacity | 150–250ms |
| 入场编排 | 页面/区块首次出现 | `fade-in-up`（8px），错峰 delay 60–100ms 递增 | 单层 ≤250ms |

规则：

1. **按压有反馈。** 按钮和可点卡片 active 态下沉 `translate-y-px`（组件库 Button 已内置）；可点卡片可加 `active:scale-[0.99]`。
2. **hover 反馈必须可感知。** 背景换一档（`hover:bg-muted`/`surface-raised`）或阴影升一档（`shadow-sm → shadow-md`），二选一但要看得出差别；对比度不足 3% 的"假 hover"视同没有（参考 issue #148）。
3. **缩放只用于小元素。** 图标、按钮、缩略图可以 `scale`（hover ≤1.02）；**含正文文本的卡片禁止 scale**——高分屏下缩放会使文字瞬时发虚，浮起感改用阴影 + 背景表达。
4. **入场错峰有节制。** 同一屏幕至多一组错峰编排，2–4 层，delay 步进 60–100ms，总延迟 ≤400ms——用户永远不应该"等"内容出现。其余页面内容直接渲染，不要到处加入场动画。
5. **循环动画只表达状态。** 缓慢的循环（`shimmer`、`shadow-glow-accent` 脉冲）只允许用于进行中的状态指示（连接中、运行中、生成中），一屏至多一处；禁止与状态无关的装饰性循环动画（飘浮、流光、无限摆动）。
6. **一屏一个重点。** 同一屏幕同时进行的编排动画至多一处；其余元素保持安静。动效的总预算是固定的，花在一个地方才被感知，到处都动等于没有动。

正误对照：

- ✅ 首页三段 `fade-in-up` 错峰（120/200/300ms）；tab 指示器滑动（layered-tabs）；按钮 `active:translate-y-px`
- ❌ 整屏内容无过渡瞬间出现；三层以上的错峰或总延迟 >400ms
- ❌ 对含文字的卡片做 `scale` hover；对比度 <3% 的 hover 变色
- ❌ 装饰性循环动画；一屏多处同时脉冲/流光

## 交互手感

「手感」是交互轨迹、UI 与动效的综合感受。基准仍是 Kimi、Codex 这一代产品：它们的共性不是某个具体动画，而是**连续性**——用户的每个动作都落在一条不间断的轨迹上。以下规则是项目级约束。

### 核心原则：输入框是主角，视图围绕它变换

对话类产品的交互主线是输入框。Home、项目、会话之间的切换是**同一个输入框在不同上下文中延续**，而不是"销毁一个页面、创建另一个页面"。设计任何涉及输入框的视图切换时，先回答：输入框在轨迹的哪一端，它如何到达另一端。

### 规则

1. **导航必须有目的地。** 点击一个容器（项目、工作区、会话分组）必须让主面板抵达一个对应的场所（项目主页、会话视图），不允许只改变侧栏状态而主面板无响应。没有目的地的导航等于没有导航。
2. **视图切换走"退出-进入"序列，禁止硬切。** 旧内容退出（opacity，≤150ms）→ 新内容进入（opacity + 位移，≤250ms）。实现统一复用 `layered-tabs-content` 的范式（`AnimatePresence mode="wait"`，x:±28 + opacity，0.22s easeOut）；reduced-motion 下退化为瞬时切换。同一屏幕内只做一次编排好的过渡，不做多元素各自为政的散落动画。
3. **异步标识替换不得打断界面。** 前端先生成稳定 id 并全程用作 React key；后端真实 id 返回后只建立映射，不替换 key。禁止在流式输出、输入进行中等连续体验中途 remount 组件树（滚动位置、动画、局部状态会全部重置，用户感知为"闪一下"）。
4. **加载态用骨架屏，不用全屏 Spinner。** 原地内容加载（会话、列表、详情）渲染目标区域的骨架（`.skeleton` shimmer）；预计 <200ms 的加载直接渲染结果，不展示任何加载态，避免闪屏。全屏 Spinner 仅保留给应用级启动。
5. **空状态是邀请，不是死端。** 每个空状态必须给出下一步动作（CTA 按钮或明确的操作指引），禁止只有一行灰字的死端画面。
6. **主要动作不靠 hover 显形。** 新建、安装等主操作常显（可用低对比度呈现，hover 提亮）；hover 才出现的隐藏入口只允许用于删除等低频危险动作。
7. **切换不得静默丢状态。** 模式、项目、会话切换时若有未提交内容或进行中的任务，要么保留现场，要么明确告知；不允许无提示地清空用户正在看的内容。

### 反面清单（本仓库出现过的手感破坏者）

- 条件渲染直接换掉整棵视图树，居中的输入区瞬间消失换成另一套布局
- 临时 id → 真实 id 替换触发 `key` 变化，流式输出中途整树 remount
- 切换容器时 `clearCurrentSession()` 式地瞬间清空主面板
- 快机器上全屏 Spinner 一闪而过，比不显示更糟
- 关键入口 `opacity-0` 藏到 hover 才出现，用户找不到

## 组件范式范例：分段切换控件

侧边栏顶部的「工作 / 对话」模式切换（`src/renderer/components/Sidebar.tsx`，样式见 `index.css` 中 `[data-mode="work-chat"]` 段）是本项目的**控件质感基准**，新做开关、分段控件、Tab 切换时参照它：

1. **全宽胶囊轨道**：轨道用中性灰 `rgb(237, 237, 236)` + 1px 边框 + `shadow-inset`，与背景分得开但不抢眼。
2. **滑动玻璃滑块**：全圆角滑块宽度超出轨道 2px、带 `shadow-md` 级投影，200ms ease 滑动，方向感清晰。
3. **状态用文字表达，不用色块**：选中侧 `font-semibold text-foreground`，未选侧 `font-normal text-muted-foreground opacity-50`；不靠强调色染色。
4. **纯文本，无图标**：两侧各一个 `text-sm` 标签居中定位在轨道 25%/75% 位置。
5. **整行可点**：点击目标是整个控件区域，不只是滑块。

这套语言推广到所有开关/切换类组件：中性的轨道、明确的滑动反馈、文字层级表达选中态、200ms 内的动效。

## 组件范式范例：工具栏触发按钮

输入框工具栏上的选择器/触发按钮（参照实现：`PermissionModeMenu`、`CoworkModelPicker`）是**工具栏按钮的质感基准**，新做同类按钮（下拉选择器、菜单触发器、工具栏动作）时一律使用，不自造变体：

1. **统一用 ghost `PromptInputButton`**（ai-elements）：无边框、无背景、无阴影，静止时完全融入工具栏。
2. **hover 用背景表达**：`hover:bg-surface-raised`，200ms 内过渡；不用边框、阴影或颜色变化做 hover 信号。
3. **下拉触发器带尾部箭头**：`ChevronDown`（`h-3.5 w-3.5 text-muted-foreground`），表明"点开有菜单"；纯动作按钮（如「+」）只放图标，不加箭头。
4. **内容从左到右**：可选的前置图标（`size-4` 或供应商标识）→ `text-sm` 文字 → 尾部箭头；文字过长用 `max-w` + `truncate` 截断。
5. **成对出现时必须同构**：同一工具栏里的多个选择器（如权限选择器与模型选择器）共享完全相同的尺寸、间距与状态样式。

禁止：给工具栏触发按钮加 `border`（包括 `border-input`）、用 `rounded-full` 胶囊、用阴影作为 hover 反馈——这些是已被否决的变体。

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
- [ ] 动效 ≤250ms，只动 opacity/transform；幅度符合「动效语言」三档规范
- [ ] hover 反馈可感知（非 <3% 的假 hover）；含文字卡片未用 scale
- [ ] 入场错峰至多一组、≤4 层、总延迟 ≤400ms；循环动画只用于状态指示且一屏一处
- [ ] 视图切换有退出-进入序列，无硬切；reduced-motion 下退化正常
- [ ] 异步 id 替换不触发 key 变化和中途 remount
- [ ] 原地加载用骨架屏，无全屏 Spinner 闪屏
- [ ] 空状态有 CTA；主要动作常显，不靠 hover 显形
- [ ] 每个可交互元素有 hover / focus / disabled 状态
- [ ] 亮色与暗色两种外观下都看过效果
- [ ] 组件优先使用 shadcn/ui 与 ai-elements（见 AGENTS.md），未自造轮子

## 可复用的分割线 Tabs

带重叠层级、阴影、尺寸和文字动效的 tabs 统一存放在：

```text
src/shared/components/ui/layered-tabs/
├── constants.ts
├── layered-tabs.tsx
├── layered-tabs.test.ts
└── index.ts
```

组件导出 `LayeredTabsList`，它必须放在现有 shadcn `Tabs` 根节点内部，与 `TabsContent` 配合使用。页面只提供受控的 `value`、`items` 和文案，不把页面业务状态、脏表单拦截或内容切换逻辑放进组件。

```tsx
<Tabs value={activeTab} onValueChange={setActiveTab}>
  <LayeredTabsList
    value={activeTab}
    items={tabs}
    separatorEdge={LayeredTabsSeparatorEdge.Top}
  />
  <TabsContent value={activeTab}>{content}</TabsContent>
</Tabs>
```

`separatorEdge` 有两个变体：

- `LayeredTabsSeparatorEdge.Top`：separator 位于 tab 顶部，tab 向下展开。
- `LayeredTabsSeparatorEdge.Bottom`：separator 位于 tab 底部，tab 向上展开。

`LayeredTabsList` 是 separator 的唯一拥有者。页面 header、TabsList 外层和其他父级不得再绘制同一位置的 `border` 或 `Separator`，否则 active tab 无法完整遮挡线段。页面需要调整宽度、外边距或内容间距时，使用组件的 `className`、`contentClassName` 和 `listClassName`，不要复制内部 trigger 和 surface 样式。

组件使用 `motion` 处理 active 层级、背景表面和文字缩放，自动遵守 `prefers-reduced-motion`。新增 tab 数量或顺序时只需修改页面传入的 `items`，层级由组件统一计算；不要在页面中重新实现 z-index、三级尺寸或 separator 方向逻辑。
