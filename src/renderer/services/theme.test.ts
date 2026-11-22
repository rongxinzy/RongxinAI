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
  const input = document.createElement('textarea');
  input.value = 'Kept draft';
  document.body.append(input);
  input.focus();
  expect(add).toHaveBeenCalledTimes(1);
  expect(themeService.getStyle()).toBe('zenith');
  expect(themeService.getEffectiveTheme()).toBe('light');
  change?.({ matches: true });
  expect(themeService.getEffectiveTheme()).toBe('dark');
  expect(document.documentElement.dataset.theme).toBe('zenith-dark');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(document.documentElement.style.getPropertyValue('--main-background-color')).not.toBe('');
  themeService.setTheme('light');
  change?.({ matches: true });
  expect(themeService.getEffectiveTheme()).toBe('light');
  themeService.setStyle('unavailable');
  expect(themeService.getStyle()).toBe('zenith');
  expect(document.documentElement.dataset.theme).toBe('zenith-light');
  expect(document.documentElement.style.getPropertyValue('--main-background-color')).toBe(
    '#F4F5F7',
  );
  expect(document.querySelector('style')).toBeNull();
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('Kept draft');
  vi.unstubAllGlobals();
});
