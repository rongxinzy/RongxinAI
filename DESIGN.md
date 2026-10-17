# DESIGN.md - 知远智能体 (ZhiYuan Agent) Zenith Design System

> **Version**: v3.1 (Zenith - Premium Futuristic, 2026-10-17 polish)
> **Date**: 2026-10-17
> **Positioning**: P0 mandatory constraint for all frontend work, paired with `AGENTS.md` engineering rules.
> **Philosophy**: 清新 (fresh) · 轻盈 (light/airy) · 畅快 (smooth, fluid) · 科技感 (tech-forward)

Zenith is a modern premium design system that balances futuristic aesthetics with desktop efficiency, characterized by subtle glassmorphism, clean typography, efficient spacing, and smooth interactions. Surfaces have depth without distraction, typography is crisp and readable, and the interface feels light yet information-dense.

## Design Principles

1. **Subtle Glassmorphism** - Light backdrop blur and translucency for depth without overwhelming
2. **Efficient Density** - Compact spacing optimized for desktop productivity, not mobile bloat
3. **Smooth Transitions** - 150-200ms animations for responsive, polished feel
4. **Clean Hierarchy** - Clear visual relationships through weight, size, and color
5. **Tech-Forward Polish** - Modern aesthetics without sacrificing usability or information density

## 一、Color System - 色彩系统

### Zenith Light Palette

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Canvas Base | `--zy-background` | `#FAFBFD` | Ethereal off-white canvas with subtle cool tint |
| Primary Surface | `--zy-surface` | `rgba(255, 255, 255, 0.85)` | Glassmorphic cards with 85% opacity |
| Elevated Surface | `--zy-surface-raised` | `rgba(255, 255, 255, 0.95)` | Hovered/elevated cards, 95% opacity |
| Overlay Surface | `--zy-surface-overlay` | `rgba(255, 255, 255, 0.98)` | Menus, popovers with subtle backdrop blur |
| Primary Text | `--zy-text-primary` | `#0A1628` | Deep blue-black for premium feel |
| Secondary Text | `--zy-text-secondary` | `#4A5568` | Muted for hierarchy |
| Tertiary Text | `--zy-text-muted` | `#A0AEC0` | Subtle hints and disabled states |
| Electric Accent | `--zy-primary` | `linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%)` | Vibrant blue-to-purple gradient |
| Accent Glow | `--zy-primary-glow` | `0 0 24px rgba(59, 130, 246, 0.3)` | Luminous glow effect |
| Success | `--zy-success` | `#10B981` | Vibrant emerald |
| Warning | `--zy-warning` | `#F59E0B` | Warm amber |
| Error | `--zy-error` | `#EF4444` | Clean red |
| Border | `--zy-border` | `rgba(0, 0, 0, 0.06)` | Subtle separation |
| Border Glow | `--zy-border-glow` | `rgba(59, 130, 246, 0.15)` | Accent border with subtle glow |

### Zenith Dark Palette

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Canvas Base | `--zy-background` | `#0A0E1A` | Deep space background |
| Primary Surface | `--zy-surface` | `rgba(20, 24, 36, 0.85)` | Glassmorphic cards with 85% opacity |
| Elevated Surface | `--zy-surface-raised` | `rgba(30, 35, 50, 0.90)` | Elevated surfaces |
| Overlay Surface | `--zy-surface-overlay` | `rgba(30, 35, 50, 0.98)` | Menus and overlays |
| Primary Text | `--zy-text-primary` | `#E8EBF0` | Near-white for readability |
| Secondary Text | `--zy-text-secondary` | `#A0AEC0` | Muted hierarchy |
| Tertiary Text | `--zy-text-muted` | `#4A5568` | Subtle disabled |
| Electric Accent | `--zy-primary` | `linear-gradient(135deg, #60A5FA 0%, #A78BFA 100%)` | Lighter gradient for dark bg |
| Accent Glow | `--zy-primary-glow` | `0 0 32px rgba(96, 165, 250, 0.4)` | Stronger glow in dark |
| Success | `--zy-success` | `#34D399` | Brighter emerald |
| Warning | `--zy-warning` | `#FBBF24` | Bright amber |
| Error | `--zy-error` | `#F87171` | Softer red |
| Border | `--zy-border` | `rgba(255, 255, 255, 0.08)` | Subtle light borders |
| Border Glow | `--zy-border-glow` | `rgba(96, 165, 250, 0.25)` | Luminous accent borders |

### Color Usage Rules

1. **Glassmorphism Everywhere** - All cards and surfaces use 80-95% opacity with backdrop blur (8-16px)
2. **Gradient Primaries** - Main actions use the electric blue-purple gradient, never flat colors
3. **Colored Shadows** - Shadows carry subtle color tints matching their context (blue glow for primary, green for success)
4. **Depth Through Opacity** - Layer surfaces from 80% (background cards) to 98% (top overlays)
5. **No Pure Black/White** - Light mode uses #FAFBFD, dark mode uses #0A0E1A - both with character

## 二、Typography - 字体排版

### Font Stack

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
--font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, Consolas, monospace;
```

### Type Scale (Desktop-optimized: light and dense)

| Role | Size / Line Height | Weight | Usage |
| --- | --- | --- | --- |
| Display | 24px / 32px | 650 | Hero headings, welcome screens |
| H1 | 20px / 28px | 600 | Page titles |
| H2 | 17px / 24px | 600 | Section headers |
| H3 | 15px / 22px | 600 | Card titles |
| Body | 13px / 20px | 400 | Default UI text, lists |
| Caption | 12px / 18px | 400 | Labels, auxiliary, metadata |
| Tiny | 11px / 16px | 500 | Badges, tags, compact info |

### Typography Rules

1. **Tight Line Height** - 1.45-1.55x for UI text, optimized for density
2. **Variable Fonts** - Use Inter's variable weight axis (400-650) for smooth hierarchy
3. **Compact Hierarchy** - Clear differentiation without excessive size jumps
4. **Sentence Case** - Use sentence case for UI labels, not UPPERCASE (except acronyms)

## 三、Spacing & Layout - 间距与布局

### 8px Grid System

All spacing uses 8px base unit for consistency and scale:

| Token | Value | Usage |
| --- | --- | --- |
| `space-1` | 8px | Tight gaps between related items |
| `space-2` | 16px | Standard gaps, button padding |
| `space-3` | 24px | Card padding, section spacing |
| `space-4` | 32px | Large section gaps |
| `space-5` | 40px | Page margins |
| `space-6` | 48px | Hero spacing |
| `space-8` | 64px | Major layout divisions |

### Component Sizing (Desktop-optimized: light and dense)

| Component | Height | Padding (H×V) | Notes |
| --- | --- | --- | --- |
| Button Default | 32px | 16px × 8px | Standard desktop size |
| Button Small | 28px | 12px × 6px | Compact contexts |
| Button Large | 36px | 20px × 10px | Primary CTAs |
| Input Field | 32px | 12px × 8px | Efficient typing area |
| Navigation Item | 32px | 12px × 8px | Comfortable clicking |
| Card | - | 20px | Balanced internal padding |
| Dialog | - | 24px | Modal padding |
| Sidebar | 240px | - | Compact but usable |

### Layout Principles

1. **Efficient Density** - Desktop-optimized spacing, not mobile-first bloat
2. **Max Width 1600px** - Wide-screen friendly content container
3. **Smart Padding** - 16/20/24px padding based on hierarchy
4. **Clean Surfaces** - Subtle glassmorphism without excessive decoration

## 四、Elevation & Shadows - 高度与阴影

### Shadow System

Shadows include both depth (grey) and colored glow components:

| Level | Shadow | Glow | Usage |
| --- | --- | --- | --- |
| Flat | none | none | Inline elements |
| Low | `0 1px 3px rgba(0,0,0,0.06)` | - | Subtle cards |
| Medium | `0 4px 12px rgba(0,0,0,0.08)` | `0 0 20px rgba(59,130,246,0.08)` | Default cards |
| High | `0 8px 24px rgba(0,0,0,0.10)` | `0 0 32px rgba(59,130,246,0.12)` | Elevated cards, hover |
| Ultra | `0 12px 40px rgba(0,0,0,0.12)` | `0 0 48px rgba(59,130,246,0.18)` | Modals, popovers |
| Primary | `0 8px 24px rgba(59,130,246,0.20)` | `0 0 32px rgba(59,130,246,0.30)` | Primary button hover |

### Glassmorphism Recipe

Standard glassmorphic surface:
```css
background: rgba(255, 255, 255, 0.85);
backdrop-filter: blur(12px) saturate(180%);
border: 1px solid rgba(255, 255, 255, 0.18);
box-shadow: 
  0 8px 32px rgba(0, 0, 0, 0.08),
  0 0 24px rgba(59, 130, 246, 0.08);
```

## 五、Border Radius - 圆角

### Radius Scale

| Token | Value | Usage |
| --- | --- | --- |
| `radius-sm` | 8px | Small tags, inline code |
| `radius-md` | 12px | Buttons, inputs, badges |
| `radius-lg` | 16px | Cards, panels |
| `radius-xl` | 20px | Large cards, dialogs |
| `radius-2xl` | 24px | Hero sections, modals |
| `radius-3xl` | 32px | Feature cards, islands |
| `radius-full` | 9999px | Pills, avatar, circular buttons |

**Rule**: Larger surfaces = larger radii. Nest with 8px step-down (20px container → 12px inner card).

## 六、Motion & Animation - 动效与动画

### Timing Functions

```css
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);      /* Smooth deceleration */
--ease-in-out-circ: cubic-bezier(0.85, 0, 0.15, 1);  /* Circular ease */
--spring: cubic-bezier(0.34, 1.56, 0.64, 1);         /* Bouncy spring */
```

### Duration Scale

| Speed | Duration | Usage |
| --- | --- | --- |
| Instant | 100ms | Micro-interactions, hover |
| Fast | 200ms | Button press, small transitions |
| Medium | 350ms | Cards, panels, modals |
| Slow | 500ms | Page transitions, complex animations |
| Lazy | 800ms | Ambient animations, breathing |

### Animation Principles

1. **Spring Physics** - All movements use spring easing for natural feel
2. **Staggered Reveals** - Lists animate in with 50ms delay between items (max 8 items)
3. **Morphing Shapes** - Buttons and cards morph between states, don't just fade
4. **Breathing Idle** - Subtle scale pulse (1.0 → 1.02) on idle interactive elements
5. **Colored Transitions** - Shadows and glows transition color along with state
6. **Reduce Motion** - All animations respect `prefers-reduced-motion`, falling back to instant or opacity-only

### Hover Effects

```css
/* Button hover - lift + glow */
transform: translateY(-2px) scale(1.02);
box-shadow: 0 12px 32px rgba(59, 130, 246, 0.25);
transition: all 200ms var(--ease-out-expo);

/* Card hover - gentle lift */
transform: translateY(-4px);
box-shadow: 0 16px 48px rgba(0, 0, 0, 0.12);
transition: transform 350ms var(--ease-out-expo);
```

## 七、Component Specifications - 组件规格

### Buttons

**Primary Button** (Gradient with glow):
```css
background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
padding: 14px 28px;
border-radius: 12px;
font-size: 15px;
font-weight: 550;
box-shadow: 0 4px 16px rgba(59, 130, 246, 0.25);

/* Hover */
transform: translateY(-2px);
box-shadow: 0 8px 24px rgba(59, 130, 246, 0.35);
```

**Secondary Button** (Ghost with border):
```css
background: rgba(255, 255, 255, 0.05);
border: 1.5px solid rgba(59, 130, 246, 0.3);
backdrop-filter: blur(8px);
```

**Icon Button**:
- Size: 40×40px (24px icon)
- Hover: Subtle scale (1.08) + background fade-in

### Input Fields

```css
height: 48px;
padding: 0 16px;
background: rgba(255, 255, 255, 0.5);
border: 1.5px solid rgba(0, 0, 0, 0.08);
border-radius: 12px;
backdrop-filter: blur(8px);
font-size: 15px;

/* Focus */
border-color: var(--zy-primary);
box-shadow: 
  0 0 0 4px rgba(59, 130, 246, 0.1),
  0 0 20px rgba(59, 130, 246, 0.2);
```

### Cards

```css
background: rgba(255, 255, 255, 0.85);
backdrop-filter: blur(12px) saturate(180%);
border: 1px solid rgba(255, 255, 255, 0.18);
border-radius: 16px;
padding: 32px;
box-shadow: 
  0 8px 32px rgba(0, 0, 0, 0.08),
  0 0 24px rgba(59, 130, 246, 0.08);

/* Hover */
transform: translateY(-4px);
box-shadow:
  0 16px 48px rgba(0, 0, 0, 0.12),
  0 0 32px rgba(59, 130, 246, 0.12);
transition: all 350ms var(--ease-out-expo);
```

### Sidebar

```css
width: 280px;
background: rgba(255, 255, 255, 0.85);
backdrop-filter: blur(16px) saturate(180%);
border-right: 1px solid rgba(0, 0, 0, 0.06);

/* Navigation Item */
height: 40px;
padding: 0 16px;
border-radius: 10px;
font-size: 15px;
font-weight: 450;

/* Active */
background: linear-gradient(135deg, 
  rgba(59, 130, 246, 0.1) 0%, 
  rgba(139, 92, 246, 0.1) 100%);
color: #3B82F6;
font-weight: 600;
```

### Modals & Overlays

```css
/* Backdrop */
background: rgba(10, 14, 26, 0.4);
backdrop-filter: blur(8px);

/* Dialog */
background: rgba(255, 255, 255, 0.98);
backdrop-filter: blur(20px) saturate(180%);
border-radius: 24px;
padding: 40px;
box-shadow:
  0 24px 80px rgba(0, 0, 0, 0.15),
  0 0 64px rgba(59, 130, 246, 0.12);
```

## 八、Iconography - 图标系统

1. **Lucide React** - Continue using Lucide for consistency
2. **Stroke Width**: 1.5px (slightly thinner for refined look)
3. **Size Scale**: 20px (small), 24px (default), 28px (large), 32px (hero)
4. **Animated Icons**: Subtle scale/rotation on hover (1.1x scale, 15° rotate for settings cog)

## 九、Removed Features & Consolidation

Based on analysis, the following changes for streamlined premium experience:

### Theme Consolidation

**REMOVE** the following traditional themes:
- ❌ 大明风华 (Daming) - Traditional Chinese aesthetic doesn't fit futuristic vision
- ❌ 长安风物 (Changan) - Classical style conflicts with tech-forward direction
- ❌ 未央金石 (Weiyang) - Ancient aesthetic out of place
- ❌ 晓软红 (Xiaoruan) - Brand-specific theme creates inconsistency

**KEEP** only:
- ✅ **Zenith Light** - New premium light theme
- ✅ **Zenith Dark** - New premium dark theme

**Rationale**: Multiple traditional themes fragment the experience and dilute the premium, futuristic brand positioning. A focused, world-class light/dark pair creates stronger identity.

### UI Feature Simplification

**Potential removals** (pending user confirmation):
- Consider consolidating "Expert" and "Skills" into single "Extensions" view
- Merge "Activity" feed into main conversation view as inline status
- Simplify sidebar categories from 8+ to 4-5 core views

*Note: No features removed yet. Will confirm specific removals with user before implementation.*

## 十、Implementation Checklist

Before committing Zenith redesign:

- [ ] All colors use new tokens, no hardcoded values
- [ ] Typography matches the new 30%-larger scale
- [ ] All surfaces have glassmorphism (opacity + backdrop-filter)
- [ ] Shadows include both depth AND colored glow components
- [ ] Border radii follow 8px-stepped scale (12/16/20/24/32)
- [ ] All animations use spring physics and respect reduced-motion
- [ ] Buttons use gradient primary, not flat colors
- [ ] Spacing uses 8px grid throughout
- [ ] Component heights 30% larger (44px buttons, 48px inputs, 40px nav items)
- [ ] Hover states include lift (translateY) + scale effects
- [ ] Focus states have colored ring shadows
- [ ] Both light AND dark themes fully specified
- [ ] Obsolete traditional themes (daming/changan/weiyang/xiaoruan) removed
- [ ] `bun run theme:generate` completes successfully
- [ ] `bun run lint`, `bun run test`, `bun run build` all pass
- [ ] Before/after screenshots captured at 1280×800 and 1920×1080

## 十一、Migration Notes

### Breaking Changes

1. **Token names unchanged** - Use existing `--zy-*` tokens but with new values
2. **Component contracts preserved** - No IPC/state changes, only visual
3. **Backdrop filter support** - Requires modern browsers (already required by Electron)
4. **Performance** - Glassmorphism adds GPU cost; test on lower-end hardware

### Transition Strategy

1. Create new `zenith-light.ts` and `zenith-dark.ts` theme files
2. Set Zenith as new default in `plugins.ts`
3. Mark old themes as `deprecated: true` (hide from UI but keep code temporarily)
4. Remove deprecated themes after 2-week migration period
5. Update all theme preview screenshots

---

## 十二、2026-10-17 体验修订

本轮修复 Zenith 主题落地后暴露的可见性、层级与密度问题，不改变信息架构。

### 控件可见性

- **开关**：未选中轨道使用 `color-mix(in oklab, var(--zy-foreground) 14%, var(--zy-background))`，描边 `var(--zy-input-border)`，滑块统一为白色；选中轨道使用 `--zy-switch-track-checked`。未选中开关不得再用 `--zy-surface-raised` 作为轨道，滑块不得与轨道同色。
- **对话框**：内容面使用 `--zy-surface-overlay`，不得使用半透明 `--zy-surface`，避免页面内容透出；遮罩为 20% 黑 + 6px backdrop blur。菜单与弹层继续使用 `--popover`。
- **侧栏分界**：侧栏 header/footer 的 hairline 使用 `--border`，不得退回到几乎不可见的 `--border-subtle`。

### 布局契约

- **设置页行式面板**（General / Appearance / Shortcuts）内容最大宽度 768px；Model、Platform Models、Email、About 同样使用 768px 阅读列，Memory 与 IM 使用 1024px 画布；主题卡片用 auto-fill、单列最小 13rem 排布，单张卡片不得拉伸占满整行。
- **首页快捷动作**：≥1280px 保持单行居中；更窄时使用 2/3 列网格，保持两行平衡，不得出现右侧孤立末项。
- **会话阅读列**：对话与输入区共享 `max-w-4xl`（896px）并居中；首页输入岛仍为 `max-w-3xl`（768px）。长文行宽优先保证可读性，工具卡片在列内自适应。
- **表单弹窗**：至少 448px，字段间距 16px；内容不足时优先加宽（512px）而不是压缩字号或控件。项目名与路径都必须有可见标签。

### 文案与空状态

- 自动化页的新建动作使用「New automation / 新建自动化」，与全局「New Task / 新建任务」区分。
- 空状态必须有对象与下一步，不能只留空白容器；空状态动作使用共享 Button，不另造控件。
- 英文计数在单数时使用单数文案（如 `1 turn`，不是 `1 turns`）。

### 验收补充

- 除 1280×800 / 1920×1080 外，另在 1440×900、1024×768、940×700、760×700 检查：无横向溢出、无孤立掉行、输入区控件仍可达。
- 开关、对话框、空状态、设置行式面板必须浅色/深色成对截图验收；页面内不得出现裸 i18n key 或重复空状态标题。

---

## 十三、2026-10-17 设置页重构

本轮重做设置页的信息架构、页脚语义与模型页层级，移除已由 Magpie 模型服务取代的旧路由入口。

### 信息架构

- 设置侧栏分组固定为 General / Models & memory / Channels；`Model Routing` 页删除，Memory 归入 Models & memory，不再单列在模型组末尾。
- 每页标题只由 PageHeader 提供；内容区从第一个设置分组或说明开始，不重复页面标题。
- General 页分为 Application（语言、登录启动、防休眠、系统代理、自动备份）与 Agent runtime（Codemode、MCP native bridge）两组。设置行不卡片化。

### 页脚契约

- **全部设置页自动保存**：页脚只保留 `Close`，不出现 `Save` / `Cancel`。切换、选择、开关在操作后立即写入；文本输入使用失焦或 600ms 防抖写入。
- **General / Appearance / Shortcuts**：语言、主题、快捷键在变更时立即持久化；不得再出现「切换后还要点 Save」或关闭时回滚已生效设置。
- **Email**：表单通过本地校验后自动写入 Skill 配置；关闭页面时冲刷未提交的有效表单。校验失败时不写入、不弹出自动错误。
- **IM**：字段在失焦时持久化，800ms 防抖后自动同步网关；关闭页面时冲刷待同步配置。不得要求用户再点 `Save`。
- 页脚与当前内容列同宽、右对齐；内容列切换时页脚按钮随之对齐，不固定在窗口最右缘。

### 宽度与间距

- 行式设置页（General / Appearance / Shortcuts / Model / Platform Models / Email / About）使用 768px 阅读列；Memory 与 IM 使用 1024px 画布。
- 页面自身不再叠加 `p-4`、`max-w-xl`、`max-w-2xl` 等内层宽度；宽度只由 SettingsPage 的内容列决定。
- 页面内容顶部统一 24px，页脚 12px 垂直内边距；分组之间 32px，组内行 16px。

### 模型页层级

- 模型页按官方 Magpie 设置的信息架构分为 Service / Agents / Providers / Models / Network & sharing / Privacy / About 七个分段，使用分段控件切换；窄窗口下改为下拉选择，不得横向裁切分段标签。
- 页面顶部只保留一个 `Model service` 区：状态徽标、简短说明、刷新/启用动作；启用说明只在未运行时出现。不得再出现打开官方管理页面的入口。
- Provider 使用带分隔线的行式列表，不再为每个 Provider 套 Card；服务商模型标签使用 `text-xs`，不得出现 10px/11px 字号。
- Default model 显示当前已保存默认模型；`Set as default` 只在用户选择了不同模型时出现，不展示长期禁用的主按钮。
- Models / Network / Privacy 使用自动保存行：切换即写入，行内显示当前值；不得再引入页面级 Save。Network 的端口、局域网共享、CORS 与允许来源由宿主托管，只读展示并说明原因。
- Privacy 的脱敏分类使用行式开关，不套嵌套卡片；订阅账号控制放在隐私分段底部。
- 外部 Agent 是模型页的一级分段 `Agents`，直接展示接入列表与刷新/断开动作；不得收在 Service 底部，也不得再通过“管理接入”弹窗承载。
- 页面内不得再出现重复的 `Models` 标题；许可证只在 About 分段出现一次。

### 其他修订

- 快捷键页增加录制说明；设置开关通过 `aria-labelledby`/`aria-describedby` 关联标签与描述。
- IM 渠道标题使用 `{name} Settings / {name} 设置`，不得拼接出 `WeChatSettings`。
- IM 项目必填字段默认使用中性样式与必填标记，不得在用户尚未操作时显示红色 invalid 态。

### 验收补充

- 设置页每个 tab 在 1440×900 与 1024×768 下检查浅色/深色、页脚对齐、无横向溢出；760×700 下检查侧栏与内容仍可用。
- 每个设置页切换、关闭、重开，确认变更已自动落盘且页脚只有 `Close`；不得出现 `Save`/`Cancel` 或关闭后回滚。

---

**Design Authority**: This specification is the single source of truth for Zenith design system. Any deviation requires explicit approval and documentation update.

**Version**: 3.4.0-zenith
**Last Updated**: 2026-10-17
**Next Review**: Q1 2027
