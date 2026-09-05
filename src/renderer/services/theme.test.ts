// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
vi.mock('./config', () => ({
  configService: { getConfig: () => ({ theme: 'system', themeStyle: 'removed-style' }) },
}));

test('restores missing styles safely and keeps system appearance independent from the style', async () => {
  let change: ((event: { matches: boolean }) => void) | undefined;
  const add = vi.fn((_event: string, callback: typeof change) => {
    change = callback;
  });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: add,
    removeEventListener: vi.fn(),
  }));
  const { themeService } = await import('./theme');
  themeService.initialize();
  themeService.initialize();
  expect(add).toHaveBeenCalledTimes(1);
  expect(themeService.getStyle()).toBe('codex');
  expect(themeService.getEffectiveTheme()).toBe('light');
  change?.({ matches: true });
  expect(themeService.getEffectiveTheme()).toBe('dark');
  themeService.setTheme('light');
  change?.({ matches: true });
  expect(themeService.getEffectiveTheme()).toBe('light');
  themeService.setStyle('unavailable');
  expect(themeService.getStyle()).toBe('codex');
  expect(document.documentElement.dataset.theme).toBe('classic-light');
  vi.unstubAllGlobals();
});
