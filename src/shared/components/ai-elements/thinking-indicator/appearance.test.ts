// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';

import { readIndicatorPaint, subscribeIndicatorAppearance } from './appearance';

afterEach(() => {
  document.documentElement.classList.remove('dark');
  document.documentElement.style.removeProperty('color');
  vi.restoreAllMocks();
});

test('reads the theme ink and explicit appearance instead of the system preference', () => {
  const host = document.createElement('span');
  host.style.color = 'rgb(83, 88, 98)';
  document.body.appendChild(host);
  expect(readIndicatorPaint(host)).toEqual({ color: 'rgb(83, 88, 98)', theme: 'light' });
  document.documentElement.classList.add('dark');
  expect(readIndicatorPaint(host)?.theme).toBe('dark');
  host.remove();
});

test('converts computed CSS colors unsupported by the dependency into RGB ink', () => {
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([83, 88, 98, 255]) }),
  };
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    color: 'color(srgb 0.32549 0.345098 0.384314)',
  } as CSSStyleDeclaration);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  expect(readIndicatorPaint(document.createElement('span'))?.color).toBe('#535862');
  expect(context.fillStyle).toBe('color(srgb 0.32549 0.345098 0.384314)');
  expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1, 1);
});

test('shares theme subscriptions and releases them after the final indicator unmounts', async () => {
  const observe = vi.spyOn(MutationObserver.prototype, 'observe');
  const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
  let flushFrame: FrameRequestCallback = () => {};
  const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    flushFrame = callback;
    return 1;
  });
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const first = vi.fn();
  const second = vi.fn();
  const stopFirst = subscribeIndicatorAppearance(first);
  const stopSecond = subscribeIndicatorAppearance(second);
  const style = document.createElement('style');
  try {
    expect(observe).toHaveBeenCalledTimes(2);
    document.documentElement.classList.add('dark');
    await Promise.resolve();
    document.head.appendChild(style);
    await Promise.resolve();
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    flushFrame(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    stopFirst();
    expect(disconnect).not.toHaveBeenCalled();
    second.mockClear();
    style.textContent = ':root { color: CanvasText; }';
    await Promise.resolve();
    flushFrame(0);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    document.documentElement.style.color = 'CanvasText';
    await Promise.resolve();
    stopSecond();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    second.mockClear();
    document.documentElement.classList.remove('dark');
    await Promise.resolve();
    expect(second).not.toHaveBeenCalled();
  } finally {
    stopFirst();
    stopSecond();
    style.remove();
  }
});
