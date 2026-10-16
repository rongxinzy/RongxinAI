import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync('scripts/installer-shell/preview/index.html', 'utf8');
const windows: JSDOM[] = [];

// An actual thenable, with no native Promise.catch even on chained results.
function thenOnly<T>(result: Promise<T>): PromiseLike<T> {
  return { then: (resolve, reject) => thenOnly(result.then(resolve, reject)) };
}

function mount(query = '?lang=en', hosted = true) {
  const start = vi.fn<(path: string, inference: boolean) => PromiseLike<void>>(() =>
    thenOnly(Promise.resolve()),
  );
  const uninstall = vi.fn<() => PromiseLike<void>>(() => thenOnly(Promise.resolve()));
  const launch = vi.fn<() => PromiseLike<boolean>>(() => thenOnly(Promise.resolve(false)));
  const close = vi.fn<() => PromiseLike<void>>(() => thenOnly(Promise.resolve()));
  const cancel = vi.fn<() => PromiseLike<void>>(() => thenOnly(Promise.resolve()));
  const post = vi.fn();
  const errors: Error[] = [];
  const diagnostics: unknown[][] = [];
  let engine: (event: { data: unknown }) => void = () => {};
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  virtualConsole.on('error', (...args) => diagnostics.push(args));
  const dom = new JSDOM(html, {
    url: `https://setup.local/index.html${query}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      if (!hosted) return;
      Object.defineProperty(window, 'chrome', {
        value: {
          webview: {
            hostObjects: {
              shell: {
                StartInstall: start,
                StartUninstall: uninstall,
                LaunchApp: launch,
                RequestClose: close,
                CancelInstall: cancel,
                GetDefaultInstallDir: () => thenOnly(Promise.resolve('C:\\知远\\Application')),
              },
            },
            postMessage: post,
            addEventListener: (_: string, callback: typeof engine) => {
              engine = callback;
            },
          },
        },
      });
    },
  });
  windows.push(dom);
  const document = dom.window.document;
  return {
    dom,
    document,
    start,
    uninstall,
    launch,
    close,
    cancel,
    post,
    errors,
    diagnostics,
    click: (selector: string) => (document.querySelector(selector) as HTMLElement).click(),
    event: (data: unknown) => engine({ data }),
  };
}

afterEach(() => windows.splice(0).forEach(dom => dom.window.close()));

describe('hosted installer Promise bridge (not Windows acceptance)', () => {
  it.each([
    ['zh', 'hero'],
    ['en', 'hero'],
    ['zh', 'uninstall'],
    ['en', 'uninstall'],
  ])('renders the requested %s language on the hosted %s page', (language, page) => {
    const ui = mount(`?shell=1&lang=${language}${page === 'uninstall' ? '&page=uninstall' : ''}`);
    const english = language === 'en';
    expect(ui.document.documentElement.lang).toBe(english ? 'en' : 'zh-CN');
    expect(ui.document.querySelector('.page.active')?.id).toBe(`page-${page}`);
    expect(ui.document.querySelector('.app-title')?.textContent).toBe(
      english
        ? page === 'uninstall'
          ? 'Uninstaller'
          : 'Setup'
        : page === 'uninstall'
          ? '卸载程序'
          : '安装程序',
    );
    for (const [selector, chinese, translated] of [
      ['#btnInstall', '安装', 'Install'],
      ['#btnBrowse', '更改…', 'Change…'],
      ['#btnCancelHero', '取消', 'Cancel'],
      ['#btnCancelProgress', '取消', 'Cancel'],
      ['#btnDone', '完成', 'Finish'],
      ['#btnLaunch', '启动知远智能体', 'Launch ZhiYuan Agent'],
      ['#btnConfirmUninstall', '卸载', 'Uninstall'],
      ['[data-i18n="localInference"]', '安装本地推理组件', 'Install local inference components'],
    ]) {
      expect(ui.document.querySelector(selector)?.textContent).toBe(english ? translated : chinese);
    }
    expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(true);
    expect(ui.start).not.toHaveBeenCalled();
    expect(ui.errors).toEqual([]);
  });

  it.each(['?shell=1', '?shell=1&lang=', '?shell=1&lang=unsupported', '?shell=1&lang=toString'])(
    'preserves the Chinese default for an absent or unsupported language: %s',
    query => {
      const ui = mount(query);
      expect(ui.document.documentElement.lang).toBe('zh-CN');
      expect(ui.document.querySelector('#btnInstall')?.textContent).toBe('安装');
      expect(ui.errors).toEqual([]);
    },
  );

  it.each([
    ['#btnDone', 'complete'],
    ['#btnCancelHero', 'hero'],
    ['#btnCancelUninstall', 'uninstall'],
    ['.win-btn.close', 'hero'],
  ])('requests host close from %s without simulating window exit', async (selector, page) => {
    const ui = mount(page === 'uninstall' ? '?page=uninstall' : undefined);
    if (page === 'complete') {
      ui.event({ type: 'done' });
      await vi.waitFor(() =>
        expect(ui.document.querySelector('.page.active')?.id).toBe('page-complete'),
      );
    }
    const proxy = thenOnly(Promise.resolve());
    const then = vi.spyOn(proxy, 'then');
    ui.close.mockReturnValue(proxy);
    ui.click(selector);
    expect(ui.close).toHaveBeenCalledExactlyOnceWith();
    await vi.waitFor(() => expect(then).toHaveBeenCalledOnce());
    expect(ui.document.querySelector('.page.active')?.id).toBe(`page-${page}`);
    expect(ui.launch).not.toHaveBeenCalled();
    expect(ui.post).not.toHaveBeenCalled();
    expect(ui.errors).toEqual([]);
  });

  it('keeps progress visible until the engine confirms cancellation or rollback', async () => {
    const ui = mount();
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    ui.click('.win-btn.close');
    expect(ui.close).toHaveBeenCalledOnce();
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    ui.click('#btnCancelProgress');
    await vi.waitFor(() => expect(ui.cancel).toHaveBeenCalledOnce());
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    ui.event({ type: 'error', message: 'Cancelled after rollback' });
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-hero');
    expect(ui.document.querySelector('#heroStatus')?.textContent).toBe('Cancelled after rollback');
    expect(ui.post).not.toHaveBeenCalled();
  });

  it.each(['install', 'uninstall'])(
    'retains early Cancel through delayed %s admission without waiting for the operation',
    async operation => {
      const ui = mount(operation === 'uninstall' ? '?page=uninstall' : undefined);
      let acknowledgeStart = () => {};
      const pendingStart = new Promise<void>(resolve => {
        acknowledgeStart = resolve;
      });
      (operation === 'install' ? ui.start : ui.uninstall).mockReturnValue(thenOnly(pendingStart));
      const proxy = thenOnly(Promise.resolve());
      const then = vi.spyOn(proxy, 'then');
      ui.cancel.mockReturnValue(proxy);
      if (operation === 'install') ui.click('#licenseCheck');
      ui.click(operation === 'install' ? '#btnInstall' : '#btnConfirmUninstall');
      const button = ui.document.querySelector('#btnCancelProgress') as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      ui.click('#btnCancelProgress');
      expect(ui.cancel).not.toHaveBeenCalled();
      expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
      await Promise.resolve();
      expect(ui.cancel).not.toHaveBeenCalled();
      acknowledgeStart();
      await vi.waitFor(() => expect(then).toHaveBeenCalledOnce());
      expect(ui.cancel).toHaveBeenCalledExactlyOnceWith();
      expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
      ui.event({ type: 'error', message: 'Cancelled after rollback', detail: 'cancelled by user' });
      expect(ui.document.querySelector('.page.active')?.id).toBe(
        operation === 'uninstall' ? 'page-uninstall' : 'page-hero',
      );
      expect(ui.errors).toEqual([]);
      expect(ui.post).not.toHaveBeenCalled();
    },
  );

  it('does not send Cancel after admission rejects, and Retry gets its own cancellable admission', async () => {
    const ui = mount();
    let rejectStart = (_error: Error) => {};
    const pendingStart = new Promise<void>((_resolve, reject) => {
      rejectStart = reject;
    });
    ui.start.mockReturnValue(thenOnly(pendingStart));
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    ui.click('#btnCancelProgress');
    rejectStart(new Error('Start admission rejected'));
    await vi.waitFor(() =>
      expect(ui.document.querySelector('#heroStatus')?.textContent).toContain(
        'Start admission rejected',
      ),
    );
    expect(ui.cancel).not.toHaveBeenCalled();
    expect(ui.diagnostics).toHaveLength(1);
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-hero');
    ui.start.mockReturnValue(thenOnly(Promise.resolve()));
    ui.click('#btnInstall');
    ui.click('#btnCancelProgress');
    await vi.waitFor(() => expect(ui.cancel).toHaveBeenCalledExactlyOnceWith());
    expect(ui.start).toHaveBeenCalledTimes(2);
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    expect(ui.errors).toEqual([]);
  });

  it.each([false, true])(
    'does not apply an older pending Cancel to a newer Retry admission (old rejects: %s)',
    async rejects => {
      const ui = mount();
      let acknowledgeStart = () => {};
      const pendingStart = new Promise<void>((resolve, reject) => {
        acknowledgeStart = () =>
          rejects ? reject(new Error('Previous admission rejected')) : resolve();
      });
      ui.start.mockReturnValue(thenOnly(pendingStart));
      ui.click('#licenseCheck');
      ui.click('#btnInstall');
      ui.click('#btnCancelProgress');
      ui.event({ type: 'error', message: 'Previous attempt failed' });
      ui.start.mockReturnValue(thenOnly(Promise.resolve()));
      ui.click('#btnInstall');
      acknowledgeStart();
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(ui.cancel).not.toHaveBeenCalled();
      ui.click('#btnCancelProgress');
      await vi.waitFor(() => expect(ui.cancel).toHaveBeenCalledExactlyOnceWith());
      expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
      expect(ui.errors).toEqual([]);
    },
  );

  it.each(['install', 'uninstall'])(
    'returns a rejected busy %s Retry to its retryable page until cleanup releases admission',
    async operation => {
      const ui = mount(operation === 'uninstall' ? '?page=uninstall' : undefined);
      const start = operation === 'install' ? ui.start : ui.uninstall;
      const button = operation === 'install' ? '#btnInstall' : '#btnConfirmUninstall';
      if (operation === 'install') {
        ui.click('#toggleInference');
        ui.click('#licenseCheck');
      }
      ui.click(button);
      ui.event({ type: 'error', message: 'Previous attempt failed; cleanup is still active' });
      const busyMessage =
        'The previous setup operation is still finishing safely. Please try again shortly.';
      start.mockReturnValue(thenOnly(Promise.reject(new Error(busyMessage))));
      ui.click(button);
      ui.click('#btnCancelProgress');
      await vi.waitFor(() =>
        expect(ui.document.querySelector('#heroStatus')?.textContent).toContain(busyMessage),
      );
      expect(ui.document.querySelector('.page.active')?.id).toBe(
        operation === 'install' ? 'page-hero' : 'page-uninstall',
      );
      expect(ui.cancel).not.toHaveBeenCalled();
      expect(ui.document.querySelector('#page-complete')?.classList.contains('active')).toBe(false);
      start.mockReturnValue(thenOnly(Promise.resolve()));
      ui.click(button);
      expect(start).toHaveBeenCalledTimes(3);
      if (operation === 'install') expect(ui.start.mock.calls[2][1]).toBe(true);
      expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
      ui.click('#btnCancelProgress');
      await vi.waitFor(() => expect(ui.cancel).toHaveBeenCalledExactlyOnceWith());
      expect(ui.errors).toEqual([]);
    },
  );

  it('handles then-only Cancel rejection without claiming rollback or enabling Retry during installation', async () => {
    const ui = mount();
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    const status = ui.document.querySelector('#heroStatus')?.textContent;
    ui.cancel.mockReturnValue(thenOnly(Promise.reject(new Error('Cancel request rejected'))));
    ui.click('#btnCancelProgress');
    await vi.waitFor(() => expect(ui.diagnostics).toHaveLength(1));
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    expect(ui.document.querySelector('#heroStatus')?.textContent).toBe(status);
    expect(ui.document.querySelector('#completeSub')?.textContent).toBe('');
    expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(true);
    expect((ui.document.querySelector('#btnCancelProgress') as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(ui.errors).toEqual([]);
  });

  it.each(['progress', 'complete'])(
    'does not turn close rejection into install failure on %s',
    async page => {
      const ui = mount();
      ui.click('#licenseCheck');
      ui.click('#btnInstall');
      if (page === 'complete') {
        ui.event({ type: 'done', installDir: 'C:\\知远\\Application' });
        await vi.waitFor(() =>
          expect(ui.document.querySelector('.page.active')?.id).toBe('page-complete'),
        );
      }
      const status = ui.document.querySelector('#heroStatus')?.textContent;
      ui.close.mockReturnValue(thenOnly(Promise.reject(new Error('Close request rejected'))));
      ui.click(page === 'complete' ? '#btnDone' : '.win-btn.close');
      await vi.waitFor(() => expect(ui.diagnostics).toHaveLength(1));
      expect(ui.document.querySelector('.page.active')?.id).toBe(`page-${page}`);
      expect(ui.document.querySelector('#heroStatus')?.textContent).toBe(status);
      if (page === 'complete') {
        expect(ui.document.querySelector('#completeSub')?.textContent).toContain(
          'Close request rejected',
        );
        expect((ui.document.querySelector('#btnLaunch') as HTMLButtonElement).disabled).toBe(false);
      } else
        expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(true);
      expect(ui.errors).toEqual([]);
      expect(ui.post).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['#btnDone', 'complete'],
    ['#btnCancelHero', 'hero'],
    ['#btnCancelUninstall', 'uninstall'],
  ])('keeps standalone preview navigation for %s', (selector, page) => {
    const ui = mount(`?page=${page}`, false);
    ui.click(selector);
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-hero');
    expect(ui.close).not.toHaveBeenCalled();
    expect(ui.errors).toEqual([]);
  });

  it.each([false, true])('retains consent and the local-inference choice (%s)', async inference => {
    const ui = mount();
    await vi.waitFor(() =>
      expect(ui.document.querySelector('#installPath')?.textContent).toBe('C:\\知远\\Application'),
    );
    ui.click('#btnInstall');
    expect(ui.start).not.toHaveBeenCalled();
    if (inference) ui.click('#toggleInference');
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    expect(ui.start).toHaveBeenCalledExactlyOnceWith('C:\\知远\\Application', inference);
    expect(ui.document.querySelector('#page-progress')?.classList.contains('active')).toBe(true);
    expect(ui.document.querySelector('#page-complete')?.classList.contains('active')).toBe(false);
    expect(ui.errors).toEqual([]);
    expect(ui.post).not.toHaveBeenCalled();
  });

  it.each([false, true])('assimilates a then-only install proxy (rejects: %s)', async fails => {
    const ui = mount();
    const result = fails ? Promise.reject(new Error('Native install rejected')) : Promise.resolve();
    const proxy = thenOnly(result);
    const then = vi.spyOn(proxy, 'then');
    expect(proxy).not.toHaveProperty('catch');
    ui.start.mockReturnValue(proxy);
    ui.click('#licenseCheck');
    ui.click('#btnInstall');
    await vi.waitFor(() => expect(then).toHaveBeenCalledTimes(1));
    expect(then.mock.calls[0].map(callback => typeof callback)).toEqual(['function', 'function']);
    if (fails) {
      await vi.waitFor(() =>
        expect(ui.document.querySelector('#heroStatus')?.textContent).toContain(
          'Native install rejected',
        ),
      );
      expect(ui.document.querySelector('#heroStatus')?.getAttribute('role')).toBe('alert');
      expect(ui.document.querySelector('#page-hero')?.classList.contains('active')).toBe(true);
      expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(false);
      ui.start.mockReturnValue(thenOnly(Promise.resolve()));
      ui.click('#btnInstall');
      expect(ui.start).toHaveBeenCalledTimes(2);
    }
    expect(ui.document.querySelector('#page-progress')?.classList.contains('active')).toBe(true);
    expect(ui.document.querySelector('#page-complete')?.classList.contains('active')).toBe(false);
    expect(ui.errors).toEqual([]);
    expect(ui.post).not.toHaveBeenCalled();
  });

  it.each(['started', 'not-started', 'rejected'] as const)(
    'handles a then-only launch proxy without inventing successful launch (%s)',
    async outcome => {
      const ui = mount();
      ui.event({ type: 'done', installDir: 'C:\\知远\\Application' });
      await vi.waitFor(() =>
        expect(ui.document.querySelector('#page-complete')?.classList.contains('active')).toBe(
          true,
        ),
      );
      const result =
        outcome === 'rejected'
          ? Promise.reject(new Error('Native launch rejected'))
          : Promise.resolve(outcome === 'started');
      const proxy = thenOnly(result);
      const then = vi.spyOn(proxy, 'then');
      expect(proxy).not.toHaveProperty('catch');
      ui.launch.mockReturnValue(proxy);
      ui.click('#btnLaunch');
      await vi.waitFor(() => expect(then).toHaveBeenCalledTimes(1));
      expect(then.mock.calls[0].map(callback => typeof callback)).toEqual(['function', 'function']);
      if (outcome === 'started') {
        await vi.waitFor(() => expect(ui.close).toHaveBeenCalledExactlyOnceWith());
      } else {
        await vi.waitFor(() =>
          expect((ui.document.querySelector('#btnLaunch') as HTMLButtonElement).disabled).toBe(
            false,
          ),
        );
        expect(ui.close).not.toHaveBeenCalled();
        expect(ui.document.querySelector('#page-complete')?.classList.contains('active')).toBe(
          true,
        );
      }
      expect(ui.errors).toEqual([]);
      expect(ui.post).not.toHaveBeenCalled();
      ui.close.mockClear();
      ui.click('#btnDone');
      expect(ui.close).toHaveBeenCalledExactlyOnceWith();
    },
  );
});

describe('installer brand and license review', () => {
  it('opens the real local license without granting consent', async () => {
    const ui = mount('?lang=zh');
    const dialog = ui.document.getElementById('licenseDialog') as HTMLDialogElement;
    const show = vi.fn();
    dialog.showModal = show;
    const license = vi.fn(() => Promise.resolve('LOCAL LICENSE TEXT'));
    const window = ui.document.defaultView!;
    (
      window as unknown as {
        chrome: { webview: { hostObjects: { shell: Record<string, unknown> } } };
      }
    ).chrome.webview.hostObjects.shell.GetLicenseText = license;
    ui.click('#btnLicense');
    await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
    expect(license).toHaveBeenCalledOnce();
    expect(ui.document.querySelector('#licenseText')?.textContent).toBe('LOCAL LICENSE TEXT');
    expect(ui.document.querySelector('#licenseCheck')?.getAttribute('aria-checked')).toBe('false');
    expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(true);
    expect(ui.start).not.toHaveBeenCalled();
  });

  it('keeps license read errors visible without granting consent', async () => {
    const ui = mount('?lang=en');
    const dialog = ui.document.getElementById('licenseDialog') as HTMLDialogElement;
    const show = vi.fn();
    dialog.showModal = show;
    const window = ui.document.defaultView!;
    (
      window as unknown as {
        chrome: { webview: { hostObjects: { shell: Record<string, unknown> } } };
      }
    ).chrome.webview.hostObjects.shell.GetLicenseText = () =>
      Promise.reject(new Error('Unavailable'));
    ui.click('#btnLicense');
    await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
    expect(ui.document.querySelector('#licenseText')?.textContent).toContain(
      'The license could not be read',
    );
    expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(true);
    expect(ui.start).not.toHaveBeenCalled();
  });

  it('ships the website-inspired palette without remote assets or runtime dependencies', () => {
    expect(html).toContain('--brand: #090d16');
    expect(html).toContain('--serif:');
    expect(html).toContain('prefers-reduced-motion');
    expect(html).toContain('forced-colors');
    expect(html).not.toMatch(/(?:src|href)=["']https?:|@import|@font-face/);
    expect(html).toContain('id="completeTitle"');
  });
});

it('retains the full install path for copying, tooltips and assistive technology', async () => {
  const ui = mount('?lang=zh');
  await Promise.resolve();
  await Promise.resolve();
  const path = ui.document.getElementById('installPath')!;
  expect(path.title).toBe(path.textContent);
  expect(path.getAttribute('aria-label')).toBe(path.textContent);
  expect(path.textContent).toContain('知远');
});

it('renders the existing uninstall completion selector without discarding data wording', async () => {
  const ui = mount('?page=uninstall&lang=en');
  ui.event({ type: 'done' });
  await vi.waitFor(() =>
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-complete'),
  );
  expect(ui.document.querySelector('#completeTitle')?.textContent).toBe(
    'ZhiYuan Agent uninstalled',
  );
  expect(ui.document.querySelector('#completeSub')?.textContent).toContain(
    'personal files are kept',
  );
  expect((ui.document.querySelector('#btnLaunch') as HTMLElement).style.display).toBe('none');
});

it('keeps one brand mark and a task heading instead of repeating the product name', () => {
  const ui = mount('?lang=zh');
  expect(ui.document.querySelectorAll('#wordmarkImg')).toHaveLength(1);
  expect(ui.document.querySelector('.titlebar #wordmarkImg')).not.toBeNull();
  expect(ui.document.querySelector('#page-hero h1')?.textContent).toBe('开始你的 AI 工作台');
  expect(ui.document.querySelector('#page-hero')?.textContent).not.toContain('(ZhiYuan Agent)');
});

it('does not add a second admission on repeated clicks', () => {
  const ui = mount('?lang=en');
  ui.click('#licenseCheck');
  ui.click('#btnInstall');
  ui.click('#btnInstall');
  ui.click('#btnInstall');
  expect(ui.start).toHaveBeenCalledTimes(1);
});

describe('license fallback and repeated opening', () => {
  it('rejects an HTTP error page without displaying it as a license or consenting', async () => {
    const ui = mount('?lang=en', false);
    const dialog = ui.document.getElementById('licenseDialog') as HTMLDialogElement;
    dialog.showModal = vi.fn();
    const text = vi.fn(async () => '404 error page');
    ui.document.defaultView!.fetch = vi.fn(async () => ({
      ok: false,
      text,
    })) as unknown as typeof fetch;
    ui.click('#btnLicense');
    await vi.waitFor(() => expect(dialog.showModal).toHaveBeenCalledOnce());
    expect(text).not.toHaveBeenCalled();
    expect(ui.document.querySelector('#licenseText')?.textContent).toContain(
      'The license could not be read.',
    );
    expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not show an already-open dialog again during repeated clicks', async () => {
    const ui = mount();
    const dialog = ui.document.getElementById('licenseDialog') as HTMLDialogElement;
    dialog.showModal = vi.fn(() => {
      dialog.open = true;
    });
    ui.click('#btnLicense');
    ui.click('#btnLicense');
    await vi.waitFor(() => expect(dialog.showModal).toHaveBeenCalledOnce());
    expect(dialog.open).toBe(true);
    expect((ui.document.querySelector('#btnInstall') as HTMLButtonElement).disabled).toBe(true);
  });
});
