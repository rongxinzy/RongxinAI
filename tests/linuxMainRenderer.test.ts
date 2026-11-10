import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'vitest';
import {
  isMainRendererReady,
  isMainRendererTarget,
  readMainRendererState,
} from '../scripts/ci/linux-main-renderer.mjs';

test('renderer selects the packaged main document, not other file pages', () => {
  const target = {
    type: 'page',
    url: 'file:///opt/Agent/resources/app.asar/dist/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:43123/devtools/page/main',
  };
  assert.equal(isMainRendererTarget(target), true);
  assert.equal(
    isMainRendererTarget({
      ...target,
      url: 'file:///tmp/.mount_App/resources/app.asar/dist/index.html',
    }),
    true,
  );
  for (const url of [
    'file:///opt/Agent/resources/error.html',
    'file:///opt/Agent/resources/app.asar/dist/pet.html',
    `${target.url}?window=companion`,
    `${target.url}#log`,
    'https://example.com/dist/index.html',
    'not a URL',
  ]) {
    assert.equal(isMainRendererTarget({ ...target, url }), false);
  }
  assert.equal(isMainRendererTarget({ ...target, type: 'worker' }), false);
  assert.equal(isMainRendererTarget({ ...target, webSocketDebuggerUrl: undefined }), false);
});

function fixture({ welcome = false, canvas = true, sidebar = true, composer = true } = {}) {
  const element = (visible: boolean) => ({ checkVisibility: () => visible });
  const root = {
    childElementCount: 1,
    querySelector: (selector: string) => {
      if (selector === '[data-testid="companion-welcome"]') return welcome ? {} : null;
      if (selector === 'aside[data-active-view]') return element(sidebar);
      if (selector === '[data-main-canvas]') {
        return { ...element(canvas), querySelector: () => element(composer) };
      }
      return null;
    },
  };
  return {
    readyState: 'complete',
    body: { innerText: welcome ? 'Hello. It is good to see you. Ready' : 'New task Settings' },
    getElementById: () => root,
  };
}

test('CDP probe rejects welcome, blank, loading and failed bootstrap surfaces', () => {
  const probe = (document: ReturnType<typeof fixture>) =>
    vm.runInNewContext(`(${readMainRendererState.toString()})(document)`, { document });
  const ready = probe(fixture());
  assert.equal(isMainRendererReady(ready), true);
  // Reproduces the observed same-document welcome with Ready text and nonblank artwork.
  assert.equal(isMainRendererReady(probe(fixture({ welcome: true }))), false);
  assert.equal(isMainRendererReady(probe(fixture({ canvas: false }))), false);
  assert.equal(isMainRendererReady(probe(fixture({ sidebar: false }))), false);
  assert.equal(isMainRendererReady(probe(fixture({ composer: false }))), false);
  assert.equal(isMainRendererReady({ ...ready, readyState: 'loading' }), false);
  assert.equal(isMainRendererReady({ ...ready, rootChildren: 0 }), false);
  assert.equal(isMainRendererReady({ ...ready, text: '' }), false);
  assert.equal(isMainRendererReady(null), false);
});

test('smoke waits for the main shell before the existing nonblank screenshot gate', async () => {
  const source = await fs.readFile('scripts/verify-linux-renderer.mjs', 'utf8');
  assert.ok(source.includes('targets.find(isMainRendererTarget)'));
  assert.ok(source.includes('readMainRendererState.toString()'));
  assert.ok(source.includes('if (isMainRendererReady(state))'));
  assert.ok(
    source.indexOf('renderedState = await waitForRenderedContent(devTools)') <
      source.indexOf('const screenshotAnalysis = await waitForNonBlankScreenshot(devTools)'),
  );
  assert.ok(source.includes('screenshotAnalysis.distinctColors >= 8'));
  assert.ok(source.includes('screenshotAnalysis.nonWhiteRatio >= 0.01'));
});
