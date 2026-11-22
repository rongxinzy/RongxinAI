/** Override a bundled recipe in the fixture while using the real appearance switch. */
export async function applyThemeRecipes(page, appearance, edits) {
  await page.evaluate(
    async ({ appearance, edits }) => {
      const [{ allThemes }, { generateThemeCSS }, { themeService }] = await Promise.all([
        import(new URL('/src/renderer/theme/themes/index.ts', location.href).href),
        import(new URL('/src/renderer/theme/engine/css-generator.ts', location.href).href),
        import(new URL('/src/renderer/services/theme.ts', location.href).href),
      ]);
      const theme = allThemes.find(item => item.meta.appearance === appearance);
      const id = `preview-recipes-${theme.meta.id}`;
      let sheet = document.getElementById(id);
      if (edits.length) {
        const definition = structuredClone(theme);
        for (const [hook, state, declarations] of edits) {
          Object.assign(definition.components[hook][state], declarations);
        }
        if (!sheet) {
          sheet = document.createElement('style');
          sheet.id = id;
          document.head.append(sheet);
        }
        sheet.textContent = generateThemeCSS(definition);
      } else {
        sheet?.remove();
      }
      themeService.setTheme(appearance);
    },
    { appearance, edits },
  );
}
