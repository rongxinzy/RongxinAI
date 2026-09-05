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

Images must be bundled assets (Vite imports or public theme assets) or inline raster data. Paper uses a static procedural SVG grain; grid/dots use CSS paints. Opacity is applied to the background layer only. Page canvases reveal the layer while cards, editors, inputs and portal dialogs retain their own surfaces. Switching to a theme without a background clears the previous image, color and opacity. Light and dark appearances may define different backgrounds. These backgrounds do not change OS-native windows or exported document styling.

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
