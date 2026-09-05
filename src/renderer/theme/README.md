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
      tokens: { ...classicLight.tokens /* override semantic roles here */ },
    },
    dark: {
      meta: { ...classicDark.meta, id: 'paper-dark', name: 'Paper Dark', appearance: 'dark' },
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
