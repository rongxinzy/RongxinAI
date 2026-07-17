# Tailwind v4 升级后 UI 回归问题修复文档

> 分支：`fix/tailwind-v4-ui-regressions` → `dev`
> 修复日期：2026-07-17
> 前置 MR：#513（Tailwind CSS v3.4 → v4.3 升级）

## 一、背景

Tailwind v4 升级（MR #513）合并后，在 UI 层暴露出 5 个回归问题。这些问题的共同根源是 **v4 对 `transform` / `scale` / `translate` 的实现机制变更**，以及 **CSS 变量在 `@layer` 中的优先级变化**。

### v4 关键行为变化

| 特性 | v3 | v4 |
|---|---|---|
| `scale-125` | `transform: scale(1.25)` | `scale: 125% 125%`（**独立 CSS 属性**） |
| `translate-x-*` | `transform: translateX(...)` | `translate: x y`（**独立 CSS 属性**） |
| 内联 `transform` 与工具类 | 内联样式覆盖工具类（同属性竞争） | **叠加应用**（两个独立属性） |
| `transform: none` 覆盖工具类 | 有效 | **无效**（工具类写的是 `translate`/`scale`，不是 `transform`） |
| CSS 变量优先级 | 按声明顺序 | **无层样式 > `@layer` 内样式** |

## 二、问题与修复明细

### 问题 1：work-chat Switch 滑块与文本重叠、选中文本尺寸异常

**文件**：`src/renderer/components/Sidebar.tsx`

**根因**：v3 中 `scale-125` 生成 `transform: scale(1.25)`，被元素内联 `style={{transform: 'translate(-50%,-50%)'}}` 覆盖，缩放实际不生效。v4 中 `scale-125` 生成独立 `scale: 125%` 属性，与内联 `transform` **叠加**，导致文本突然放大且中心点偏移。

**修复**：移除 `scale-125` 类，选中态仅保留 `font-semibold`（加粗）+ `text-foreground`（变色），不再放大。

```diff
  workMode === 'work'
-   ? 'font-semibold text-foreground scale-125'
+   ? 'font-semibold text-foreground'
    : 'font-normal text-muted-foreground opacity-50'
- style={{ left: '25%', transform: workMode === 'work' ? 'translate(-50%, -50%) scale(1.25)' : 'translate(-50%, -50%)' }}
+ style={{ left: '25%', transform: 'translate(-50%, -50%)' }}
```

### 问题 2：work-chat Switch 滑块（thumb）位置错乱

**文件**：`src/renderer/index.css`

**根因**：自定义 thumb 定位用 `left` + `transform: none`，试图覆盖 switch.tsx 组件类中的 `group-data-checked:translate-x-[calc(100%-2px)]`。但 v4 中该工具类生成的是独立 `translate` 属性，`transform: none` 无法覆盖，导致 `left` 定位与 `translate` **双重偏移**。

**修复**：在 thumb 定位规则中追加 `translate: none !important`：

```css
[data-mode="work-chat"] [data-slot="switch-thumb"][data-unchecked] {
  left: -6px;
  top: -4px;
  transform: none;
  translate: none !important;  /* 新增：覆盖 v4 独立 translate 属性 */
}
[data-mode="work-chat"] [data-slot="switch-thumb"][data-checked] {
  left: calc(50% - 6px);
  top: -4px;
  transform: none;
  translate: none !important;
}
```

> `!important` 必须保留——v4 工具类选择器 `:is(:where(.group/switch)[data-size] *)[data-checked]` 权重不低，且工具类在 `@layer utilities` 中，无层自定义规则需 `!important` 才能稳定覆盖。

### 问题 3：work 模式下技能/MCP 入口错误显示

**文件**：`src/renderer/components/Sidebar.tsx`

**根因**：合并 v4 升级分支时的人工失误，条件 `workMode === 'chat'` 被错写为 `workMode !== 'chat'`，与 v3 逻辑相反。

**修复**：

```diff
- {workMode !== 'chat' && (
+ {workMode === 'chat' && (
```

恢复 v3 行为：技能/MCP 入口仅在 chat 模式显示。

### 问题 4：新建任务/对话 icon 颜色变浅

**文件**：`src/renderer/theme/css/shadcn-token-bridge.css`

**根因**：这是 v4 迁移中最隐蔽的问题——**CSS 变量层叠优先级冲突**。

v3 时代 `text-muted-foreground` 指向 `--zy-text-secondary`（深灰）。v4 迁移后存在两处同名变量定义：

```css
/* shadcn-token-bridge.css（v3 遗留，无层） */
:root, [data-theme] {
  --color-muted-foreground: var(--zy-text-muted);  /* 浅灰 */
}

/* index.css @theme（v4 新增，@layer theme） */
@layer theme {
  :root, :host {
    --color-muted-foreground: var(--muted-foreground);  /* → --zy-text-secondary 深灰 */
  }
}
```

**v4 中无层样式优先级高于 `@layer` 内样式**，导致 bridge 文件中的浅灰定义覆盖了 @theme 中的深灰定义，全局 `text-muted-foreground` 都变浅。

**修复**：将 bridge 文件中的变量值改为与 v3 一致：

```diff
  --color-background: var(--zy-background);
- --color-muted-foreground: var(--zy-text-muted);
+ --color-muted-foreground: var(--zy-text-secondary);
```

> 注意：bridge 文件中的 `--color-muted-foreground` 是 v3 时代为兼容 shadcn 组件保留的覆盖定义。由于无层样式始终覆盖 `@layer theme`，后续如需调整 muted-foreground 颜色，应直接修改 bridge 文件而非 @theme。

### 问题 5：新建任务/对话 icon 与其他侧边栏 icon 颜色不一致

**文件**：`src/renderer/components/Sidebar.tsx`

**根因**：新建按钮 icon 使用 `text-muted-foreground/40 dark:text-muted-foreground/45`（带透明度），而本地推理、搜索任务等其他 icon 不带颜色类，继承按钮的 `text-foreground/80`。

**修复**：移除 icon 的颜色类，与其他 icon 保持一致（继承按钮颜色）：

```diff
- const sidebarCreateIconClassName = 'h-4 w-4 shrink-0 text-muted-foreground/40 dark:text-muted-foreground/45';
+ const sidebarCreateIconClassName = 'h-4 w-4 shrink-0';
```

### 问题 6：`<button> cannot be a descendant of <button>` hydration 错误

**文件**：
- `src/renderer/components/cowork/SessionExpertPicker.tsx`
- `src/renderer/components/cowork/CoworkModelPicker.tsx`

**根因**：base-ui 的 `PopoverTrigger` 默认渲染为 `<button>`，当 children 也是 button（`PromptInputButton` → `Button` → `<button>`）时产生非法 HTML 嵌套。

**修复**：使用 base-ui 的 `render` prop 模式，Trigger 直接复用子元素作为自身渲染节点：

```diff
- <PopoverTrigger>
-   <PromptInputButton type="button" disabled={disabled} tooltip="添加会话专家">
-     ...
-   </PromptInputButton>
- </PopoverTrigger>
+ <PopoverTrigger
+   render={
+     <PromptInputButton type="button" disabled={disabled} tooltip="添加会话专家">
+       ...
+     </PromptInputButton>
+   }
+ />
```

`CoworkModelPicker.tsx` 中 children 是 `<span>`，虽不构成 button 嵌套，但同样统一为 `render` 模式，与项目里 `SkillsPopover.tsx` 的既有用法一致。

## 三、变更文件清单

| 文件 | 变更 |
|---|---|
| `src/renderer/components/Sidebar.tsx` | 问题 1/3/5 |
| `src/renderer/index.css` | 问题 2 |
| `src/renderer/theme/css/shadcn-token-bridge.css` | 问题 4 |
| `src/renderer/components/cowork/SessionExpertPicker.tsx` | 问题 6 |
| `src/renderer/components/cowork/CoworkModelPicker.tsx` | 问题 6 |

## 四、验证结果

- ✅ `npx tsc --noEmit` 类型检查通过
- ✅ `npm run lint` 无错误
- ✅ `vite build` 构建成功，编译 CSS 中确认：
  - `translate: none !important` 已生成
  - `--color-muted-foreground: var(--zy-text-secondary)` 为最终生效值

## 五、经验总结（v4 迁移排错指南）

1. **v3 → v4 后 `transform` 相关异常**：检查是否混用了内联 `transform` 与 `scale-*`/`translate-*`/`rotate-*` 工具类。v4 中它们是独立 CSS 属性，会叠加而非覆盖。
2. **自定义 CSS 覆盖工具类失效**：v4 工具类写的是 `translate`/`scale` 属性，自定义规则需用 `translate: none` / `scale: none`（而非 `transform: none`）覆盖，通常需要 `!important`。
3. **颜色莫名变浅/变深**：检查是否有**无层**的 `:root` 变量定义覆盖了 `@layer theme` 中的 `@theme` 定义。v4 中无层样式优先级最高。
4. **base-ui 组件嵌套 button**：base-ui 的 Trigger/Trigger 类组件默认渲染 `<button>`，children 含 button 时必须用 `render` prop。
