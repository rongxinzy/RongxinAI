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
  const launch = vi.fn<() => PromiseLike<boolean>>(() => thenOnly(Promise.resolve(false)));
  const close = vi.fn<() => PromiseLike<void>>(() => thenOnly(Promise.resolve()));
  const cancel = vi.fn();
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
    expect(ui.cancel).toHaveBeenCalledOnce();
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-progress');
    ui.event({ type: 'error', message: 'Cancelled after rollback' });
    expect(ui.document.querySelector('.page.active')?.id).toBe('page-hero');
    expect(ui.document.querySelector('#heroStatus')?.textContent).toBe('Cancelled after rollback');
    expect(ui.post).not.toHaveBeenCalled();
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
