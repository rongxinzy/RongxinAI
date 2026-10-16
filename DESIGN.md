# DESIGN.md - 知远智能体 (ZhiYuan Agent) Zenith Design System

> **Version**: v3.0 (Zenith - Premium Futuristic)  
> **Date**: 2026-10-16  
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

**Design Authority**: This specification is the single source of truth for Zenith design system. Any deviation requires explicit approval and documentation update.

**Version**: 3.0.0-zenith  
**Last Updated**: 2026-10-16  
**Next Review**: Q1 2027
