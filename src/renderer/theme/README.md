# Theme plugins

The desktop theme is presentation data. App routes, React state, focus, IPC and persistence remain owned by existing components and services. `theme` selects light/dark/system; the optional `themeStyle` config property selects a registered style, falling back to `codex` if it is unavailable.

## Add a style

1. Create a module alongside `themes/classic-light.ts`. Export a `ThemePlugin` with `version: THEME_PLUGIN_VERSION`, a unique kebab-case ID, localized name and both appearances.
2. Derive tokens from the built-in appearance and override the relevant semantic roles. Assign unique appearance IDs. `ThemeDefinition.tokens` is a complete typed contract: colors, typography, radii, shadows, editor and syntax roles. The compatibility palette keeps existing utility classes theme-controlled; new components should use semantic names.
3. Add the plugin to `themePlugins` in `themes/plugins.ts`. The settings style selector appears when multiple plugins exist. This is a bundled plugin API, not an arbitrary JavaScript loader or external theme marketplace.
4. Run `bun run theme:generate`, `bun run lint`, renderer tests and browser checks in both appearances.

```ts
const paper: ThemePlugin = {
  version: THEME_PLUGIN_VERSION,
  id: 'paper',
  name: { zh: '纸白', en: 'Paper' },
  appearances: {
    light: {
      meta: { ...classicLight.meta, id: 'paper-light', name: 'Paper', appearance: 'light' },
      components: structuredClone(classicLight.components),
      tokens: { ...classicLight.tokens /* override semantic roles here */ },
    },
    dark: {
      meta: { ...classicDark.meta, id: 'paper-dark', name: 'Paper Dark', appearance: 'dark' },
      components: structuredClone(classicDark.components),
      tokens: { ...classicDark.tokens /* matching dark roles */ },
    },
  },
};
```

## Source boundaries

- `tokens/contract.ts`: exhaustive variable names; `themes/*.ts`: values. `themes.css` is generated and checked for drift by lint.
- `css/tailwind.css`: utility-to-token adapter, no per-theme values. `css/components.css`: shared control, typography, motion and layout rules. Layout dimensions and state selectors remain structural CSS; they are not separate runtime component implementations.
- `syntax/`: static CodeMirror and Prism scope adapters; Shiki emits semantic variables. Switching style does not require re-highlighting to update colors.
- `ThemeManager`: replaces one generated stylesheet and updates the root appearance class in place. Settings cancel restores both style and appearance; saving writes only changed configuration fields.
- Brand/provider/file-type logos, avatar artwork, sampled boot-logo particles, user-authored artifacts and portable document exports retain content colors. Theme plugins do not rewrite user documents or execute code inside artifact sandboxes.

## Verification boundaries

`theme:audit` scans renderer/shared component modules for literal colors and unregistered palette utilities, with named content/artwork exceptions. It is a color ownership gate, not a proof that every UI flow or arbitrary CSS declaration has been tested. `theme:check` checks generated CSS. Browser verification must check computed colors after transitions finish, keyboard focus, drafts, open menus, both appearances and a narrow viewport. Electron-native dialogs and OS chrome are outside the renderer theme contract.

## Main canvas backgrounds (theme-author API only)

Each `ThemeDefinition` may include `background`. There is no user background editor or background preference. The user can select a complete theme and its light/dark/system mode; every other visual decision belongs to the package.

```ts
import paperImage from './assets/paper.webp';

// Add to an appearance definition:
background: {
  ...DEFAULT_BACKGROUND,
  kind: BackgroundKind.Image,
  image: paperImage,
  fit: BackgroundFit.Cover,
  opacity: 0.16,
}
// Alternatively: kind: BackgroundKind.Color, color: '#f3eee4', opacity: 1
// Or: kind: BackgroundKind.Texture, texture: BackgroundTexture.Paper
```

Images must be bundled assets (Vite imports or public theme assets) or inline raster data. Paper uses a static procedural SVG grain; grid/dots/silk use CSS paints. Opacity is applied to the background layer only. Page canvases reveal the layer while cards, editors, inputs and portal dialogs retain their own surfaces. Switching to a theme without a background clears the previous image, color and opacity. Light and dark appearances may define different backgrounds. These backgrounds do not change OS-native windows or exported document styling.

## Component appearance recipes

`ThemeDefinition.components` supplies structured appearance data for the six control families: buttons, input fields, selectors, badges, cards and overlays. Their variants, fixed size scales, typography, decorations and applicable visual states belong to the package. Every registered hook declares all `COMPONENT_STATES`; an empty object inherits the base appearance.

The integration covers shared primitives and their business compositions: local-inference actions and model cards, permission/model menus, command search, joined controls, native fields/buttons, legacy modals, composer effects, clickable/editable surfaces, generated skill tokens, CodeMirror search, forwarded prompt/fold triggers, message/queue/reasoning surfaces, and Tabs/PageTabs. Each light/dark appearance supplies the complete contract. Structural layout and interaction behavior remain in the components.

Selectors and state precedence belong to the engine; themes cannot inject selectors, event handlers, pointer-event rules or arbitrary CSS. Generated rules use the `components` cascade layer, established before Tailwind imports. Reduced-motion settings are enforced by the engine. A theme switch replaces the stylesheet in place, including for controls whose `data-slot` is overridden by a composition wrapper. Theme hooks therefore use stable CSS classes.

Input/textarea dimensions, responsive typography and file-selector appearance now belong to recipes. The fixed `wide` condition preserves the existing 48rem breakpoint. Joined controls use orientation-specific hooks instead of global corner overrides. Wrapper layout, alignment, hit testing and runtime popup geometry remain in shared components. The named JSX, native-control, interactive-surface and forwarded-control inventories contain no remaining appearance overrides in these families. These source inventories do not cover third-party style generators automatically. No additional style controls are exposed to users.

### Migration verification snapshot

The current working tree passes 879 renderer/shared tests, the production build, and bundle budgets (startup graph 1.56 MiB). Browser checks cover complete-theme switching, invalid+focused inputs, draft/focus preservation, composed inputs, task-search selection, attachment hover/remove, menu checkbox/radio/submenu behavior, dialogs, popovers, sheets and tooltips. Additional checks cover local-operation recipe switching while hovered, horizontal/vertical joined corners, and responsive field typography. An AST comparison of 125 changed renderer business modules found no changes outside presentation classes and added state metadata. This comparison does not establish CSS hit testing or full Electron end-to-end behavior; those are separate verification scopes.

`theme:audit` also rejects state appearance utilities in the 17 migrated shared primitive modules. This gate protects those primitives; it does not claim to resolve arbitrary business-component expressions or replace rendered interaction verification.

### Theme-owned motion and pseudo-elements

Recipes can supply `motionStart` and `motionEnd` declarations and reference them with `animation-name: component-motion` in a visual state. The compiler generates names isolated to each theme scope and hook, so live themes cannot reuse another theme's keyframes. Frames permit only opacity, scale and translate; animation names cannot reference external CSS. Duration, easing, delay, repeat and direction are package data. Empty frames mean no custom motion. Set `animation-name: none` to disable a package effect.

Registered pseudo-element hooks are emitted after owner state selectors. Composer focus remains tied to the actual editable control, and pseudo-elements retain shared `pointer-events: none` geometry. Reduced-motion enforcement disables component animations, including pseudo-elements. Browser checks verify theme switching while typing, disabling the glow through package data, reduced motion, and draft/Escape behavior in the legacy Modal wrapper.

The interactive-surface browser fixture uses the real TodoTaskRow and InlineSkillPromptEditor. It verifies keyboard activation, nested actions, package hover overrides, DOM-generated token appearance/removal and draft preservation. The Todo checkbox click also opens its row in the HEAD baseline fixture; the migrated fixture retains that baseline behavior. This is a pre-existing interaction issue, not evidence that nested checkbox clicks are isolated. The literal DOM className assignment comparison is limited to appearance strings, with all other imperative token code still compared.

### Vendor control integration

CodeMirror search controls use registered `editor-search-*` recipes. Their component source retains flex alignment, margins, cursor policy and search behavior. The engine emits these fixed vendor hooks outside cascade layers, with bounded editor specificity, because CodeMirror injects unlayered defaults at runtime. Theme packages cannot choose this integration policy or supply arbitrary selectors. Reduced-motion rules are emitted at the same priority. `theme:audit` rejects reintroduced search-control appearance properties in CodeBlock's EditorView theme object.

The actual CodeBlock browser fixture verifies query preservation and input-radius overrides during a live theme switch, next-result navigation, no-match status, case-sensitive matching, and closing the panel. The renderer AST comparison excludes only the migrated CodeMirror search appearance properties while retaining its structural declarations and search event code.

### Control sizing boundary

`classic-control-sizing.ts` holds shared height/inset compositions and their call-site provenance. Standard button icon dimensions and inline-icon padding are package-owned. Conditional card-footer and image spacing is also package-owned and emitted after plain size compositions to preserve the previous conditional utility precedence. Browser verification checks changing an inset recipe and icon-size recipe live, regular card-footer zero padding, and marketplace footer padding.

The remaining call-site geometry inventory contains `h-full` (fill the parent row/grid cell), `min-h-0` (allow flex children to shrink), and viewport-derived dialog/sheet heights (`dvh`, `calc`, `min`). These express layout relationships, not fixed control size scales. No individual sizing preferences are exposed to users.

### Composite-control internals

Input-group addon padding and input clearances use fixed alignment hooks. Left/right and top/bottom addon order, automatic height, click-to-focus and flex layout remain shared behavior. Browser checks cover all four alignments, bordered addons, multiline content, theme-owned padding overrides and focused-draft preservation.

Fifteen remaining primitive dimension fragments now use package-owned piece recipes. The `piece-size-*` marker preserves explicit SVG sizing opt-outs in parent icon rules. Badge icons read the fixed component variable `--zy-control-icon-size` supplied by the badge recipe, retaining the shared forced sizing policy while allowing the package to choose its value. This is a component appearance field, not a user preference or an arbitrary custom-property API.

### Forwarded control states

Prompt action modifiers and expert chips now use `classic-prompt-actions.ts`. The former global sidebar surface rule is a recipe, including open and inactive-view states. Folder warning outlines compose with hover/expanded shadows. Fold triggers use shared compact, settings and reasoning appearance recipes; trigger state and callbacks remain local. Browser checks use the real PromptInputButton in DropdownMenuTrigger and a real CollapsibleTrigger to verify expanded theme changes, menu actions, keyboard activation and focus feedback.

### Composer and message surfaces

Composer shell shape, nested input-group shape and drag-over highlight are theme recipes. Drag highlight composes with the existing elevated shadow. MessageContent default typography and role-based user/assistant surfaces are recipes as well, preserving their previous precedence over caller surface modifiers. Queue completed styling retains its independent line-through state and caller color precedence. Browser checks verify composer draft/focus retention, removal of the drag outline through package data, message-role color changes and completed queue styling.

Reasoning panel typography, connector indentation, and the existing data-state=open/closed animation hooks are package data. The selectors preserve the prior exact data-state conditions; no new Base UI lifecycle behavior is introduced. Entry and exit use separate generated keyframe names to preserve animation restarts, with the installed tw-animate default of 150ms and no fill mode.


### Tabs and page navigation

Tabs list surfaces, trigger dimensions, typography, states, icon sizing and line indicators use package recipes. PageTabs supplies only composition layout and its existing shared-layout indicator behavior. Browser measurements match the pre-migration baseline for default, vertical and page tabs, including the 32px page list and 36px page triggers. Tests verify selection, disabled activation prevention, keyboard navigation, retained focus/selection during theme switching, and vertical indicator updates. Base UI keeps disabled tabs keyboard-focusable; the migration preserves that behavior.

### Acceptance evidence and limits

| Requirement | Evidence |
| --- | --- |
| Complete appearance data for the six control families | Required `ComponentAppearances` on both classic appearances; registration/compiler validation rejects missing hooks/states and unsafe properties, selectors and variable references. |
| State precedence and motion | Contract tests cover generated selectors, variant/state ordering, disabled guards, pseudo-element ownership and isolated keyframes; real-component browser checks cover focus, invalid/disabled/selected/open states and reduced motion. |
| Package changes take effect without replacing controls | Browser fixture switches between both classic appearances and an independently modified package while inputs, overlays, menus and editors remain mounted; drafts, focus, selection and actions are asserted. |
| Composition and vendor integration | Source inventories include named components, native controls, forwarded wrappers and interactive surfaces; generated skill tokens and CodeMirror search are inspected and exercised separately. |
| Existing functions remain intact | Renderer business-code AST comparison plus renderer/shared tests and rendered interaction checks. This is not a proof of every Electron/IPC workflow; no packaged Electron end-to-end run is claimed. |
| User choices stay limited to whole theme and mode | `AppearanceSettings` exposes only package selection and light/dark/system choices; individual component/background preferences are absent. |

The source inventories are heuristics, not a substitute for rendered verification. Remaining parent-fill dimensions, flex shrink resets, popup viewport bounds and indicator layout coordinates express relationships and stay in shared code. Theme data does not control events, focus order, hit testing, DOM structure or persistence.


### 大明风华

`themes/daming.ts` 注册纸白和墨夜两种外观。以纸白、朱红和墨色组织主界面，玉色、古铜色与青灰色承担状态和分类。仅页面标题使用本机宋体字体栈，正文与操作控件保持系统无衬线。主画布使用包内静态纸纹；墨夜不启用纸纹。背景、颜色和形状均属于主题定义，不提供独立设置。

共享的 FluidTabs、Checkbox、Slider、Progress、Switch、RadioGroup 和 Toggle 通过固定 `theme-*` hooks 消费组件 recipe；页面标题使用 `theme-heading`。拖动位置、进度值和选中状态仍归共享组件管理。新增主题不能替换组件实现或引入业务判断。


开关尺寸使用 `style-switch-*` 变量，组件通过元素测量和主题属性观察同步 Motion 坐标；`style-work-chat-thumb` 与 `primary-foreground` 独立。Codex 保留原尺寸与白色滑块，大明风华使用方圆形状。FluidTabs 的指示块跟随实际标签矩形，过渡曲线在 recipe 中定义。


#### 覆盖与验收（2026-09-06）

基础控件、展示控件、表单、通知、共享侧栏及业务组合外观均通过固定 hook 消费包内 recipe。`classic-scenes.ts` 管理问答选项、技能/专家头像框、表格与骨架屏等组合；头像图片和第三方品牌内容仍保持原样。旧局部覆盖已从调用点移到包内，交互状态与页面布局继续由共享组件管理。

| 验收范围 | 结果与证据 |
| --- | --- |
| 四种外观往返切换 | 真实 React 控件浏览器夹具验证 Codex 浅/深、大明风华浅/深及切回；原节点、选择状态保留。 |
| 开关、分段选项与选择控件 | 开关默认 34×20px；主题改为 44×26px、20px 滑块后测量同步；立即拖动、键盘、只读、禁用通过。指示块与标签矩形差小于 1px。 |
| 展示、表单与组合 | 表格选中/悬停、末行边框、头像尺寸、字段禁用/错误去重/整卡选中、问答选项、本地访问开关、通知圆角、滚动区键盘焦点通过。 |
| 共享侧栏 | 空/字符串 data-active 均识别；选中字重 500，常规/大号高度 32/48px，折叠恢复为 32×32px，操作按钮显隐正确。 |
| 动效 | Spinner、Skeleton 和会话扫光由包内隔离 keyframe 提供；减少动态效果时停用。扫光渐变可定制，远程 URL 仍被契约拒绝。 |
| 色板完整性 | 语义侧栏、图表、旧 amber/yellow/red 映射到包内角色；正文、次要文字、主要按钮、成功/警告/危险文字的指定表面对比度测试通过。 |
| 实机页面 | 最新生产构建通过 Computer Use 检查纸白/墨夜模型市场、设置、搜索、会话，以及纸白专家、技能、自动化空状态和创建表单。 |
| 实机功能 | 保存大明风华后免费模型回复 DAMINGOK；搜索 Return 跳转成功；已有草稿在保存切回 Codex 后保持原文。启动读取已保存的大明风华墨夜成功。 |
| 自动检查 | Renderer/shared 176 个测试文件、886 项测试通过；lint、主题生成一致性/样式审计、TypeScript、生产构建和体积预算通过。启动图 1.60 MiB。 |

扩展 JSX 控件调用点和交互表面审计均无剩余命中，但这些清单属于启发式证据。实机验收覆盖上表场景，不代表执行过所有 IPC、模型安装、外部渠道或导出格式。主题不修改这些业务流程；OS 原生窗口、用户文档、第三方预览与品牌原图不在重着色范围内。


### 长安风物

`themes/changan.ts` 提供绢白与夜阑两套外观，复用共享交互与完整组件 recipe。主操作使用孔雀青，辅助色为古金、玉色与赭红；卡片、弹层及输入区使用更圆润的轮廓，普通开关保持胶囊形。字号和操作尺寸保留共享基线。

背景使用 `BackgroundTexture.Silk` 的静态经纬线绘制，浅色透明度 0.045、深色 0.025。它复用背景图层，不引入图片请求、动画或独立用户设置。预览卡片通过同一背景定义绘制，跟随当前明暗模式。新增包无需添加设置页业务分支。

验收记录：Renderer/shared 177 个测试文件、891 项测试通过；lint、主题生成一致性、样式审计、生产构建和体积预算通过，启动图 1.61 MiB。真实 React 控件夹具验证六种外观往返切换、选择状态、开关尺寸与滑块对比度、组合边框、键盘焦点和减少动态效果。Computer Use 在隔离配置的 Electron 生产构建中检查三套主题预览、长安风物浅/深外观、保存后主界面、搜索弹层及结果跳转、已有会话内容。此次未重新执行模型安装或外部渠道流程。

### 未央金石

`themes/weiyang.ts` 注册玄金与石白两套完整外观，采用古金主操作、方中带圆的控件与宋体标题。`BackgroundTexture.Clouds` 是引擎提供的固定静态 SVG 云气纹，仅以主题定义的颜色和透明度绘制，不接受外部 SVG 或脚本。右上、左下两角延展，中央保留阅读留白，主画布与主题预览复用同一背景定义。

验收记录：178 个 Renderer/shared 测试文件、895 项测试通过；lint、生成一致性、样式审计、生产构建与体积预算通过，启动图 1.61 MiB。Playwright 真实组件夹具验证八种外观往返切换、草稿与选择状态保留、开关拖动/键盘、组合边框、浮层和减少动态效果；外观设置验证四套预览、跟随系统、显式模式优先以及 390px 窄屏无横向溢出。Computer Use 在隔离 Electron 生产构建中检查玄金/石白主界面与模型市场、量化下拉浮层、保存主题后草稿保留，重新加载后外观设置保持。此次不包含模型安装、外部渠道或跨平台实机验收。
