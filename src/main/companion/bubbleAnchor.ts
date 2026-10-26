import { screen, type BrowserWindow } from 'electron';
import type { CompanionBubblePlacement } from '../../shared/companion/bubble';
import { companionBubblePlacement } from './bubblePlacement';

interface Options {
  getPetWindow?(): BrowserWindow | null;
  onBubbleVisibility?(visible: boolean): void;
  hideWindow?(): void;
}

/** One cancellable movement notification. No focus changes or model requests while following. */
export function anchorCompanionBubble(
  window: BrowserWindow,
  options: Options,
  changed: (placement: CompanionBubblePlacement) => void,
) {
  let pet: BrowserWindow | null = null;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous = '';
  const place = () => {
    if (window.isDestroyed()) return;
    const source = options.getPetWindow?.();
    const cursor = screen.getCursorScreenPoint();
    const bounds =
      source && !source.isDestroyed() && source.isVisible()
        ? source.getBounds()
        : { ...cursor, width: 0, height: 0 };
    const area = screen.getDisplayNearestPoint({
      x: bounds.x + bounds.width / 2,
      y: bounds.y,
    }).workArea;
    const next = companionBubblePlacement(bounds, area);
    window.setBounds(next.bounds, false);
    const key = JSON.stringify(next.placement);
    if (key !== previous) {
      previous = key;
      changed(next.placement);
    }
  };
  const move = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      place();
    }, 16);
  };
  const hide = () => {
    if (options.hideWindow) options.hideWindow();
    else {
      window.hide();
      hidden();
    }
  };
  const detach = () => {
    clearTimeout(timer);
    timer = undefined;
    pet?.removeListener('move', move);
    pet?.removeListener('resize', move);
    pet?.removeListener('hide', hide);
    pet?.removeListener('closed', hide);
    pet = null;
  };
  const activate = () => {
    if (window.isDestroyed()) return;
    const source = options.getPetWindow?.() ?? null;
    if (active && source === pet) {
      place();
      return;
    }
    detach();
    pet = source;
    pet?.on('move', move);
    pet?.on('resize', move);
    pet?.on('hide', hide);
    pet?.on('closed', hide);
    active = true;
    place();
    options.onBubbleVisibility?.(true);
  };
  const hidden = () => {
    detach();
    if (active) options.onBubbleVisibility?.(false);
    active = false;
  };
  const dispose = () => {
    hidden();
    window.removeListener('show', activate);
    window.removeListener('hide', hidden);
    screen.removeListener('display-metrics-changed', move);
    screen.removeListener('display-removed', move);
  };
  window.on('show', activate);
  window.on('hide', hidden);
  window.once('closed', dispose);
  screen.on('display-metrics-changed', move);
  screen.on('display-removed', move);
  place();
  return { place, activate, deactivate: hidden };
}
