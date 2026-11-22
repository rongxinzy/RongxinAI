import { expect, test } from '@playwright/test';

import { CoworkArtifactRole, CoworkArtifactSource } from '../../../src/shared/cowork/artifacts.ts';
import { installConversation } from '../shared/conversationFixture.mjs';
import { attachConsoleGuards, home, previewSearch } from '../shared/harness.mjs';
import { applyThemeRecipes } from '../shared/themeFixture.mjs';

const SESSION_ID = 'conversation-regression';
const HTML_ID = 'html-frame';
const IMAGE_ID = 'image-frame';
const CODE_ID = 'code-frame';
const HTML_TITLE = 'HTML frame regression';
const HTML_CONTENT = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box}body{margin:0;min-width:1600px;background:#eee9dc;color:#24313d;font:16px/1.5 system-ui}
header{background:#d6e1ea;padding:24px}h1{font-size:24px;margin:0 0 12px}label{display:block}
input{font:inherit;max-width:100%;padding:8px;border:1px solid #536574;border-radius:4px}
section{padding:24px;min-height:900px}section:nth-of-type(2){background:#d9c9a9}
footer{padding:24px;background:#c4d3c4;min-width:640px}
</style></head><body><header><h1>Generated report</h1>
<label>Preview note <input aria-label="Preview note" value="Original HTML value"></label></header>
<section><h2>Overview</h2><p>Generated HTML owns this document and its scroll position.</p></section>
<section><h2>Details</h2><p>The application frame stays visible while this page scrolls.</p></section>
<footer>End of generated report</footer><script>window.previewLoadToken=Math.random().toString(36)</script>
</body></html>`;
const PNG_CONTENT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8DwHwMhwAQAF3AE/eS1Q7cAAAAASUVORK5CYII=';

const artifact = (id, type, title, content) => ({
  id,
  type,
  title,
  content,
  sessionId: SESSION_ID,
  messageId: 'a-html-frame',
  source: CoworkArtifactSource.Tool,
  role: CoworkArtifactRole.Deliverable,
  createdAt: 3002,
});

const stage = page => page.locator('.theme-html-preview-stage');
const viewport = page => page.locator('.theme-html-preview-viewport');
const iframe = page => page.locator(`iframe[title="${HTML_TITLE}"]`);
const htmlFrame = page => page.frameLocator(`iframe[title="${HTML_TITLE}"]`);

async function setTheme(page, theme) {
  await page.evaluate(async theme => {
    const { themeService } = await import(
      new URL('/src/renderer/services/theme.ts', location.href).href
    );
    themeService.setTheme(theme);
  }, theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', `zenith-${theme}`);
}

async function selectArtifact(page, id) {
  await page.evaluate(async id => {
    const [{ store }, { selectArtifact }] = await Promise.all([
      import(new URL('/src/renderer/store/index.ts', location.href).href),
      import(new URL('/src/renderer/store/slices/artifactSlice.ts', location.href).href),
    ]);
    store.dispatch(selectArtifact(id));
  }, id);
}

async function openHtmlPreview(page, baseURL, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await home(page, baseURL, previewSearch());
  await page.waitForFunction(() => window.__previewCoworkStreamReady === true);
  await setTheme(page, theme);
  await installConversation(
    page,
    [
      { id: 'u-html-frame', type: 'user', content: 'Create an HTML report', timestamp: 3000 },
      {
        id: 'a-html-frame',
        type: 'assistant',
        content: 'The report is ready to preview.',
        timestamp: 3001,
      },
    ],
    [
      artifact(HTML_ID, 'html', HTML_TITLE, HTML_CONTENT),
      artifact(IMAGE_ID, 'image', 'Frame image', PNG_CONTENT),
      {
        ...artifact(CODE_ID, 'code', 'Frame code', "const preview = 'kept';"),
        language: 'javascript',
      },
    ],
  );
  await selectArtifact(page, HTML_ID);
  await expect(htmlFrame(page).getByRole('heading', { name: 'Generated report' })).toBeVisible();
  await expect(iframe(page)).toHaveAttribute('sandbox', 'allow-scripts');
}

async function geometry(page) {
  const [outer, inner, document] = await Promise.all([
    stage(page).boundingBox(),
    viewport(page).boundingBox(),
    iframe(page).boundingBox(),
  ]);
  return {
    outer,
    inner,
    gaps: [
      inner.x - outer.x,
      inner.y - outer.y,
      outer.x + outer.width - inner.x - inner.width,
      outer.y + outer.height - inner.y - inner.height,
    ],
    iframeGaps: [
      document.x - inner.x,
      document.y - inner.y,
      inner.x + inner.width - document.x - document.width,
      inner.y + inner.height - document.y - document.height,
    ],
  };
}

async function expectInset(page, padding, radius = 8) {
  await expect(stage(page)).toHaveAttribute('data-inset', 'true');
  await expect(viewport(page)).toHaveAttribute('data-inset', 'true');
  for (const side of ['top', 'right', 'bottom', 'left']) {
    await expect(stage(page)).toHaveCSS(`padding-${side}`, `${padding}px`);
    await expect(viewport(page)).toHaveCSS(`border-${side}-width`, '1px');
    await expect(viewport(page)).toHaveCSS(`border-${side}-style`, 'solid');
  }
  await expect(viewport(page)).toHaveCSS('border-radius', `${radius}px`);
  await expect(stage(page)).toHaveCSS('overflow', 'hidden');
  await expect(viewport(page)).toHaveCSS('overflow', 'hidden');
  const bounds = await geometry(page);
  expect(bounds.inner.width).toBeGreaterThan(0);
  expect(bounds.inner.height).toBeGreaterThan(0);
  for (const gap of bounds.gaps) expect(Math.abs(gap - padding)).toBeLessThan(1);
  for (const gap of bounds.iframeGaps) expect(Math.abs(gap - 1)).toBeLessThan(1);
  return bounds;
}

async function expectFlat(page) {
  await expect(stage(page)).toHaveAttribute('data-inset', 'false');
  await expect(viewport(page)).toHaveAttribute('data-inset', 'false');
  await expect(stage(page)).toHaveCSS('padding', '0px');
  await expect(viewport(page)).toHaveCSS('border-radius', '0px');
  await expect(viewport(page)).toHaveCSS('border-top-width', '0px');
}

async function scrollHtml(page) {
  await htmlFrame(page)
    .locator('body')
    .evaluate(() => window.scrollTo(40, 620));
  await expect
    .poll(() =>
      htmlFrame(page)
        .locator('body')
        .evaluate(() => scrollY),
    )
    .toBeGreaterThan(0);
  return htmlFrame(page)
    .locator('body')
    .evaluate(() => ({ x: scrollX, y: scrollY, token: window.previewLoadToken }));
}

async function expectDocumentState(page, expected, originalIframe) {
  expect(
    await iframe(page).evaluate((element, original) => element === original, originalIframe),
  ).toBe(true);
  expect(
    await htmlFrame(page)
      .locator('body')
      .evaluate(() => ({ x: scrollX, y: scrollY, token: window.previewLoadToken })),
  ).toEqual(expected);
  await expect(htmlFrame(page).getByRole('textbox', { name: 'Preview note' })).toHaveValue(
    'Keep HTML state',
  );
}

for (const theme of ['light', 'dark']) {
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1024, 768],
    [940, 700],
    [760, 700],
  ]) {
    test(`HTML preview frame preserves its outer gaps while scrolling in ${theme} ${width}x${height}`, async ({
      page,
      baseURL,
    }, testInfo) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'HTML preview geometry');
      await page.setViewportSize({ width, height });
      await openHtmlPreview(page, baseURL, theme);
      const padding = width < 768 ? 8 : 12;
      const before = await expectInset(page, padding);
      if (width === 1280 || width === 760) {
        await page.screenshot({
          path: testInfo.outputPath(`html-preview-${theme}-${width}x${height}-initial.png`),
        });
        await viewport(page).screenshot({
          path: testInfo.outputPath(`html-viewport-${theme}-${width}x${height}-initial.png`),
        });
      }
      const documentState = await scrollHtml(page);
      const after = await expectInset(page, padding);
      expect(after).toEqual(before);
      expect(
        await viewport(page).evaluate(element => ({ x: element.scrollLeft, y: element.scrollTop })),
      ).toEqual({ x: 0, y: 0 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
      await page.screenshot({
        path: testInfo.outputPath(`html-preview-${theme}-${width}x${height}.png`),
      });
      await viewport(page).screenshot({
        path: testInfo.outputPath(`html-viewport-${theme}-${width}x${height}.png`),
      });
      if (width === 760) {
        const originalIframe = await iframe(page).elementHandle();
        await page.getByRole('button', { name: 'Open full-window preview', exact: true }).click();
        await expectFlat(page);
        expect(
          await iframe(page).evaluate((element, original) => element === original, originalIframe),
        ).toBe(true);
        expect(
          await htmlFrame(page)
            .locator('body')
            .evaluate(() => ({ x: scrollX, y: scrollY, token: window.previewLoadToken })),
        ).toEqual(documentState);
        await page.screenshot({
          path: testInfo.outputPath(`html-preview-${theme}-${width}x${height}-workspace.png`),
        });
        await viewport(page).screenshot({
          path: testInfo.outputPath(`html-viewport-${theme}-${width}x${height}-workspace.png`),
        });
        await page.getByRole('button', { name: 'Exit full-window preview', exact: true }).click();
        await expectInset(page, padding);
        expect(
          await iframe(page).evaluate((element, original) => element === original, originalIframe),
        ).toBe(true);
      }
      expect(failures).toEqual([]);
    });
  }

  test(`HTML preview retains document and host state through theme and layout changes in ${theme}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    const failures = [];
    attachConsoleGuards(page, failures, 'HTML preview state');
    await page.setViewportSize({ width: 1280, height: 800 });
    await openHtmlPreview(page, baseURL, theme);
    await htmlFrame(page).getByRole('textbox', { name: 'Preview note' }).fill('Keep HTML state');
    const originalIframe = await iframe(page).elementHandle();
    const originalStage = await stage(page).elementHandle();
    const originalViewport = await viewport(page).elementHandle();
    const documentState = await scrollHtml(page);
    const editor = page.getByRole('textbox').last();
    await editor.fill('Keep host draft');
    await editor.focus();
    await page.keyboard.press('ControlOrMeta+A');
    const hostSelection = await editor.evaluate(() => getSelection().toString());
    const originalEditor = await editor.elementHandle();
    const opposite = theme === 'light' ? 'dark' : 'light';
    await setTheme(page, opposite);
    await expectDocumentState(page, documentState, originalIframe);
    await expect(editor).toHaveText('Keep host draft');
    await expect(editor).toBeFocused();
    expect(await editor.evaluate(() => getSelection().toString())).toBe(hostSelection);
    expect(await editor.evaluate((element, original) => element === original, originalEditor)).toBe(
      true,
    );
    await htmlFrame(page)
      .getByRole('textbox', { name: 'Preview note' })
      .evaluate(element => element.focus({ preventScroll: true }));
    await setTheme(page, theme);
    await expect(htmlFrame(page).getByRole('textbox', { name: 'Preview note' })).toBeFocused();
    await expectDocumentState(page, documentState, originalIframe);

    await applyThemeRecipes(page, theme, [
      ['html-preview-stage', 'wide', { padding: '1rem' }],
      ['html-preview-stage', 'base', { 'background-color': '#e0e1e2' }],
      ['html-preview-viewport', 'base', { 'border-radius': '12px' }],
    ]);
    await expectInset(page, 16, 12);
    await expect(stage(page)).toHaveCSS('background-color', 'rgb(224, 225, 226)');
    await expectDocumentState(page, documentState, originalIframe);
    await applyThemeRecipes(page, theme, []);
    await expectInset(page, 12);

    await page.getByRole('button', { name: 'Open full-window preview', exact: true }).click();
    await expectFlat(page);
    await expectDocumentState(page, documentState, originalIframe);
    await page.getByRole('button', { name: 'Exit full-window preview', exact: true }).click();
    await expectInset(page, 12);
    await expectDocumentState(page, documentState, originalIframe);
    expect(
      await stage(page).evaluate((element, original) => element === original, originalStage),
    ).toBe(true);
    expect(
      await viewport(page).evaluate((element, original) => element === original, originalViewport),
    ).toBe(true);

    if (await page.evaluate(() => document.fullscreenEnabled)) {
      await page.getByRole('button', { name: 'Enter fullscreen preview', exact: true }).click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      await expectFlat(page);
      await expectDocumentState(page, documentState, originalIframe);
      await page.getByRole('button', { name: 'Exit fullscreen preview', exact: true }).click();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
      await page.getByRole('button', { name: 'Exit full-window preview', exact: true }).click();
      await expectInset(page, 12);
      await expectDocumentState(page, documentState, originalIframe);
    } else {
      testInfo.annotations.push({
        type: 'unverified',
        description: 'Browser fullscreen API unavailable',
      });
    }

    await page.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(stage(page)).toHaveCount(0);
    await expect(viewport(page)).toHaveCount(0);
    await selectArtifact(page, CODE_ID);
    await expect(page.locator('[data-artifact-panel]')).toContainText("const preview = 'kept';");
    await expect(stage(page)).toHaveCount(0);
    await selectArtifact(page, IMAGE_ID);
    const image = page.locator('[data-artifact-panel] img[alt="Frame image"]');
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate(element => element.complete && element.naturalWidth))
      .toBeGreaterThan(0);
    await expect(stage(page)).toHaveCount(0);
    await expect(viewport(page)).toHaveCount(0);
    expect(failures).toEqual([]);
  });
}
