import {
  DESKTOP_PET_SIZE,
  DesktopPetSprite,
  DesktopPetState,
} from '../../shared/desktopPet/constants';
import { squashScale } from '../../shared/desktopPet/physics';
import type { DesktopPetBridge, DesktopPetSnapshot } from '../../shared/desktopPet/types';
import atlasUrl from '../assets/desktop-pet/xiaoyuan-atlas.png';
import stylesheetUrl from './desktop-pet.css?url';

declare global {
  interface Window {
    desktopPet?: DesktopPetBridge;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#desktop-pet');
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = stylesheetUrl;
document.head.append(stylesheet);
const context = canvas?.getContext('2d', { willReadFrequently: true });
if (!canvas || !context) throw new Error('Desktop companion canvas is unavailable');
const view = canvas;
const ctx = context;
const bridge = window.desktopPet;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const image = new Image();
let state: DesktopPetState = DesktopPetState.Idle;
let reducedMotion = reduced.matches;
let timer: ReturnType<typeof setTimeout> | undefined;
let squashAt = -Infinity;
let disposed = false;

function draw(now = performance.now(), animated = true): void {
  if (!image.complete || image.naturalWidth === 0) return;
  const index = DesktopPetSprite[state];
  const cellWidth = image.naturalWidth / 3;
  const cellHeight = image.naturalHeight / 2;
  const squashProgress = (now - squashAt) / 220;
  const scaleY =
    !reducedMotion && animated
      ? squashProgress < 1
        ? squashScale(Math.max(0, squashProgress), 0.82)
        : 1 + Math.sin(now / 1400) * 0.012
      : 1;
  ctx.clearRect(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE);
  ctx.save();
  ctx.translate(DESKTOP_PET_SIZE / 2, DESKTOP_PET_SIZE);
  ctx.scale(1 / Math.sqrt(scaleY), scaleY);
  ctx.drawImage(
    image,
    (index % 3) * cellWidth,
    Math.floor(index / 3) * cellHeight,
    cellWidth,
    cellHeight,
    -DESKTOP_PET_SIZE / 2,
    -DESKTOP_PET_SIZE,
    DESKTOP_PET_SIZE,
    DESKTOP_PET_SIZE,
  );
  ctx.restore();
  view.dataset.state = state;
}

function publishMask(): void {
  if (!bridge) return;
  draw(performance.now(), false);
  const pixels = ctx.getImageData(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE).data;
  const alpha = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
  bridge.hitMask(alpha);
}

function frame(): void {
  clearTimeout(timer);
  if (disposed) return;
  draw();
  // The tiny media canvas animates at 25 fps; the main app and task stream stay idle.
  if (!reducedMotion) timer = setTimeout(frame, 40);
}

function update(snapshot: DesktopPetSnapshot): void {
  if (state !== snapshot.state && snapshot.state === DesktopPetState.Greeting)
    squashAt = performance.now();
  state = snapshot.state;
  reducedMotion = snapshot.reducedMotion || reduced.matches;
  view.setAttribute('aria-label', snapshot.label);
  view.title = snapshot.label;
  publishMask();
  frame();
}

const unsubscribe = bridge?.onState(update);
const onMotionChange = (): void => {
  reducedMotion = reduced.matches;
  bridge?.motion(reduced.matches);
  frame();
};
reduced.addEventListener('change', onMotionChange);

view.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  view.setPointerCapture(event.pointerId);
  bridge?.dragStart();
});
const endDrag = (): void => {
  bridge?.dragEnd();
};
view.addEventListener('pointerup', endDrag);
view.addEventListener('pointercancel', endDrag);
view.addEventListener('lostpointercapture', endDrag);
view.addEventListener('dblclick', () => bridge?.open());
view.addEventListener('contextmenu', event => {
  event.preventDefault();
  bridge?.menu();
});
// Browser preview exercises the same renderer without an Electron bridge.
view.addEventListener('click', () => {
  if (!bridge) {
    state = DesktopPetState.Greeting;
    squashAt = performance.now();
    frame();
  }
});

image.onload = () => {
  if (import.meta.env.DEV && !bridge) {
    const requested = new URLSearchParams(location.search).get('state');
    if (Object.values(DesktopPetState).includes(requested as DesktopPetState))
      state = requested as DesktopPetState;
  }
  view.setAttribute('aria-label', document.title);
  publishMask();
  frame();
  bridge?.motion(reduced.matches);
  bridge?.ready();
};
image.onerror = () => {
  console.error('[DesktopPet] Character atlas failed to load');
};
image.src = atlasUrl;

window.addEventListener('pagehide', () => {
  disposed = true;
  clearTimeout(timer);
  unsubscribe?.();
  reduced.removeEventListener('change', onMotionChange);
});
