import { expect } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { DesktopPetState } from '../../src/shared/desktopPet/constants.ts';

// Optional native acceptance, using the same isolated app and real menu IPC as task verification.
export async function stressMedia(application, main, actor, seconds) {
  if (!Number.isInteger(seconds) || seconds < 30 || seconds > 600)
    throw new Error('COMPANION_MEDIA_STRESS_SECONDS must be an integer from 30 to 600');
  await main.evaluate(() => window.electron.desktopPet.setSettings({ chatter: false }));
  await expect(actor.locator('canvas')).toHaveAttribute('data-state', DesktopPetState.Idle, {
    timeout: 30_000,
  });
  const actions = [
    ['侧看一眼', 'Peek sideways'],
    ['点点头', 'Nod'],
    ['舒展一下', 'Stretch out'],
  ];
  const play = async labels => {
    await application.evaluate(({ Menu }, labels) => {
      Menu.prototype.popup = function () {
        const item = this.items.find(item => labels.includes(item.label));
        if (!item) throw new Error('Native motion menu item missing');
        item.click();
      };
    }, labels);
    await actor.evaluate(() => window.desktopPet.menu());
    await actor.waitForTimeout(9000);
  };
  // Warm the exact measured action set before comparing retained resources.
  for (const labels of actions) await play(labels);
  const cdp = await actor.context().newCDPSession(actor);
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    // GC may advance a clip handoff. Observe an actual decoded successor after
    // GC with the existing bounded expect timeout; failed playback still fails.
    let media;
    await expect
      .poll(async () => {
        media = await actor.evaluate(() => ({
          slots: window.acceptanceVideos.length,
          rasterCanvases: window.acceptanceCanvases ?? null,
          sources: window.acceptanceVideos.filter(video => video.getAttribute('src')).length,
          state: document.querySelector('canvas').dataset.mediaState,
        }));
        return media.state;
      })
      .toBe('playing');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const process = await application.evaluate(({ app, BrowserWindow }) => {
      const pet = BrowserWindow.getAllWindows().find(window =>
        window.webContents.getURL().includes('desktop-pet.html'),
      );
      const pid = pet.webContents.getOSProcessId();
      const metrics = app.getAppMetrics().find(process => process.pid === pid);
      if (!metrics) throw new Error('Native pet renderer metrics missing');
      return {
        pid,
        workingSetKiB: metrics.memory.workingSetSize,
        cpuPercent: metrics.cpu.percentCPUUsage,
      };
    });
    expect(media.slots).toBe(2);
    expect(media.sources).toBeLessThanOrEqual(2);
    expect(media.state).toBe('playing');
    return {
      heapBytes: heap.usedSize,
      embedderHeapBytes: heap.embedderHeapUsedSize ?? null,
      backingStorageBytes: heap.backingStorageSize ?? null,
      ...dom,
      ...process,
      ...media,
    };
  };
  const samples = [await sample()];
  const started = performance.now();
  for (let index = 0; performance.now() - started < seconds * 1000; index++) {
    await play(actions[index % actions.length]);
    samples.push(await sample());
  }
  const first = samples[0];
  const last = samples.at(-1);
  const result = {
    seconds: (performance.now() - started) / 1000,
    samples,
    heapGrowthBytes: last.heapBytes - first.heapBytes,
    workingSetGrowthKiB: last.workingSetKiB - first.workingSetKiB,
  };
  // Optional inspection runs after all measured samples: enabling DOM inspection
  // can itself retain nodes and must not alter the resource-growth evidence.
  if (process.env.COMPANION_MEDIA_DOM_DIAGNOSTICS === '1') {
    await cdp.send('DOM.enable');
    const { detachedNodes } = await cdp.send('DOM.getDetachedDomNodes');
    result.domDiagnostics = {
      connectedElements: await actor.evaluate(() => document.querySelectorAll('*').length),
      detachedRoots: detachedNodes.length,
      retainedNodes: detachedNodes.reduce((sum, root) => sum + root.retainedNodeIds.length, 0),
      roots: detachedNodes.slice(0, 24).map(({ treeNode, retainedNodeIds }) => ({
        name: treeNode.nodeName,
        retained: retainedNodeIds.length,
        children: treeNode.children?.slice(0, 16).map(child => child.nodeName),
      })),
    };
    await cdp.send('DOM.disable');
  }
  // Preserve the measurements even when a growth assertion fails.
  console.log(JSON.stringify({ nativeMediaResources: result }));
  expect(new Set(samples.map(sample => sample.pid)).size).toBe(1);
  expect(result.heapGrowthBytes).toBeLessThan(16 * 1024 * 1024);
  expect(result.workingSetGrowthKiB).toBeLessThan(64 * 1024);
  await main.evaluate(() => window.electron.desktopPet.setSettings({ doNotDisturb: true }));
  console.log(
    JSON.stringify({
      hiddenPet: await application.evaluate(({ BrowserWindow }) => {
        const pet = BrowserWindow.getAllWindows().find(window =>
          window.webContents.getURL().includes('desktop-pet.html'),
        );
        return {
          visible: pet.isVisible(),
          loading: pet.webContents.isLoading(),
          destroyed: pet.webContents.isDestroyed(),
        };
      }),
      renderer: await actor.evaluate(() => ({
        visible: document.querySelector('canvas')?.dataset.visible,
        sources: window.acceptanceVideos.filter(video => video.getAttribute('src')).length,
      })),
    }),
  );
  await expect(actor.locator('canvas')).toHaveAttribute('data-visible', 'false');
  expect(
    await actor.evaluate(() =>
      window.acceptanceVideos.every(video => video.paused && !video.getAttribute('src')),
    ),
  ).toBe(true);
  await cdp.detach();
  return result;
}
