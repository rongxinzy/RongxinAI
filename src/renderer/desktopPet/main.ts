import {
  DESKTOP_PET_SIZE,
  DesktopPetEffectKind,
  DesktopPetSprite,
  DesktopPetState,
} from '../../shared/desktopPet/constants';
import type { DesktopPetBridge, DesktopPetSnapshot } from '../../shared/desktopPet/types';
import atlasUrl from '../assets/desktop-pet/xiaoyuan-atlas.png';
import stylesheetUrl from './desktop-pet.css?url';
import { DesktopPetAnimation } from './animation';

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
const context = canvas?.getContext('2d');
if (!canvas || !context) throw new Error('Desktop companion canvas is unavailable');
const view = canvas;
const ctx = context;
const bridge = window.desktopPet;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const image = new Image();
const animation = new DesktopPetAnimation();
// Readback stays off the visible canvas so Chromium can keep rendering on the GPU.
const maskCanvas = document.createElement('canvas');
maskCanvas.width = maskCanvas.height = DESKTOP_PET_SIZE;
const maskContext = maskCanvas.getContext('2d', { willReadFrequently: true });
let state: DesktopPetState = DesktopPetState.Idle;
let reducedMotion = reduced.matches;
let systemReducedMotion = false;
let frameId: number | undefined;
let maskDirty = true;
let transitionMask = false;
let pointerActive = false;
let disposed = false;

function drawPose(target: CanvasRenderingContext2D, index: number, scaleY: number): void {
  const cellWidth = image.naturalWidth / 3;
  const cellHeight = image.naturalHeight / 2;
  target.save();
  target.translate(DESKTOP_PET_SIZE / 2, DESKTOP_PET_SIZE);
  target.scale(1 / Math.sqrt(scaleY), scaleY);
  target.drawImage(
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
  target.restore();
}

function publishMask(weights: number[]): void {
  if (!bridge || !maskContext) return;
  maskContext.clearRect(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE);
  // Cover the small deformation envelope and both transition endpoints, once per change.
  weights.forEach((weight, index) => {
    if (weight === 0 && index !== DesktopPetSprite[state]) return;
    if (reducedMotion) drawPose(maskContext, index, 1);
    else for (let step = 0; step <= 15; step++) drawPose(maskContext, index, 0.92 + step * 0.01);
  });
  const pixels = maskContext.getImageData(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE).data;
  const alpha = new Uint8Array(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE);
  for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
  bridge.hitMask(alpha);
}

function draw(now: number): void {
  if (!image.complete || image.naturalWidth === 0) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.round(DESKTOP_PET_SIZE * ratio);
  if (view.width !== size || view.height !== size) view.width = view.height = size;
  ctx.setTransform(size / DESKTOP_PET_SIZE, 0, 0, size / DESKTOP_PET_SIZE, 0, 0);
  ctx.clearRect(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE);
  const pose = animation.sample(now);
  // Add premultiplied layers to preserve opaque body pixels through the crossfade.
  ctx.globalCompositeOperation = 'lighter';
  pose.weights.forEach((weight, index) => {
    if (weight <= 0) return;
    ctx.globalAlpha = weight;
    drawPose(ctx, index, reducedMotion ? 1 : pose.scaleY);
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  view.dataset.state = state;
  if (maskDirty || (transitionMask && !pose.transitioning)) {
    publishMask(pose.weights);
    maskDirty = false;
    transitionMask = pose.transitioning;
  }
}

function frame(now: number): void {
  frameId = undefined;
  if (disposed || document.hidden) return;
  draw(now);
  if (!reducedMotion) frameId = requestAnimationFrame(frame);
}

function refresh(): void {
  if (frameId !== undefined) cancelAnimationFrame(frameId);
  frameId = undefined;
  if (reducedMotion) animation.settle(performance.now());
  frame(performance.now());
}

function update(snapshot: DesktopPetSnapshot): void {
  animation.setState(snapshot.state, performance.now());
  state = snapshot.state;
  systemReducedMotion = snapshot.reducedMotion;
  reducedMotion = systemReducedMotion || reduced.matches;
  view.setAttribute('aria-label', snapshot.label);
  view.title = snapshot.label;
  maskDirty = true;
  refresh();
}

const unsubscribe = bridge?.onState(update);
const unsubscribeEffect = bridge?.onEffect(effect => {
  if (effect.kind === DesktopPetEffectKind.Drag) animation.setDragging(effect.active);
  else if (!reducedMotion) animation.impact(effect.strength);
});
const onMotionChange = (): void => {
  reducedMotion = systemReducedMotion || reduced.matches;
  bridge?.motion(reduced.matches);
  maskDirty = true;
  refresh();
};
reduced.addEventListener('change', onMotionChange);
document.addEventListener('visibilitychange', refresh);
window.addEventListener('resize', refresh);

view.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointerActive = true;
  view.setPointerCapture(event.pointerId);
  bridge?.dragStart();
  if (!bridge) animation.setDragging(true);
});
const endDrag = (): void => {
  if (!pointerActive) return;
  pointerActive = false;
  bridge?.dragEnd();
  if (!bridge) animation.setDragging(false);
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
    animation.setState(state, performance.now());
    maskDirty = true;
    refresh();
  }
});

image.onload = () => {
  if (import.meta.env.DEV && !bridge) {
    const requested = new URLSearchParams(location.search).get('state');
    if (Object.values(DesktopPetState).includes(requested as DesktopPetState))
      state = requested as DesktopPetState;
  }
  animation.setState(state, performance.now());
  animation.settle(performance.now());
  view.setAttribute('aria-label', document.title);
  refresh();
  bridge?.motion(reduced.matches);
  bridge?.ready();
};
image.onerror = () => {
  console.error('[DesktopPet] Character atlas failed to load');
};
image.src = atlasUrl;

window.addEventListener('pagehide', () => {
  disposed = true;
  if (frameId !== undefined) cancelAnimationFrame(frameId);
  unsubscribe?.();
  unsubscribeEffect?.();
  reduced.removeEventListener('change', onMotionChange);
  document.removeEventListener('visibilitychange', refresh);
  window.removeEventListener('resize', refresh);
});
