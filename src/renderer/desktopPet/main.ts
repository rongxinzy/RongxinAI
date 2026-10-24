import {
  DESKTOP_PET_SIZE,
  DesktopPetEffectKind,
  DesktopPetPlayableAction,
  DesktopPetState,
} from '../../shared/desktopPet/constants';
import type { DesktopPetBridge, DesktopPetSnapshot } from '../../shared/desktopPet/types';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import stylesheetUrl from './desktop-pet.css?url';
import { DesktopPetAnimation } from './animation';
import { DesktopPetAtlas } from './atlas';
import { drawPetPose, petHitMask, drawPetMedia, petMediaHitMask } from './draw';
import { DesktopPetMediaController } from './mediaController';

declare global {
  interface Window {
    desktopPet?: DesktopPetBridge;
  }
}

const bubble = document.querySelector<HTMLDivElement>('#desktop-pet-bubble');
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
const atlas = new DesktopPetAtlas();
const animation = new DesktopPetAnimation();
let state: DesktopPetState = DesktopPetState.Idle;
let reducedMotion = reduced.matches;
let systemReducedMotion = false;
let frameId: number | undefined;
let maskDirty = true;
let maskKey = '';
let pointerActive = false;
let disposed = false;
let nativeVisible = true;
const media = new DesktopPetMediaController(() => {
  maskDirty = true;
  refresh();
});

function draw(now: number): void {
  if (!atlas.image) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const size = Math.round(DESKTOP_PET_SIZE * ratio);
  if (view.width !== size || view.height !== size) view.width = view.height = size;
  ctx.setTransform(size / DESKTOP_PET_SIZE, 0, 0, size / DESKTOP_PET_SIZE, 0, 0);
  ctx.clearRect(0, 0, DESKTOP_PET_SIZE, DESKTOP_PET_SIZE);
  const pose = animation.sample(now);
  const clip = media.sample(now);
  const drawable = !reducedMotion ? clip.playing : null;
  const poster = !reducedMotion ? clip.poster : undefined;
  // Add premultiplied layers to preserve opaque body pixels through the crossfade.
  ctx.globalCompositeOperation = 'lighter';
  if (drawable || poster) {
    const draw = (image: CanvasImageSource, weight: number) => {
      ctx.globalAlpha = weight;
      drawPetMedia(ctx, image, pose.scaleY, pose.facing, pose.rotate, pose.offsetX, pose.offsetY);
    };
    if (drawable) {
      if (drawable.previous) draw(drawable.previous.video, 1 - drawable.mix);
      draw(drawable.current.video, drawable.previous ? drawable.mix : 1);
    } else if (poster) draw(poster, 1);
  } else
    pose.weights.forEach((weight, index) => {
      if (weight <= 0) return;
      ctx.globalAlpha = weight;
      drawPetPose(
        ctx,
        atlas,
        index,
        reducedMotion ? 1 : pose.scaleY,
        pose.facing,
        reducedMotion ? 0 : pose.rotate,
        reducedMotion ? 0 : pose.offsetX,
        reducedMotion ? 0 : pose.offsetY,
      );
    });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  view.dataset.state = state;
  view.dataset.reducedMotion = String(reducedMotion);
  view.dataset.character = atlas.character.id;
  view.dataset.sequence = pose.sequence ?? '';
  view.dataset.progress = String(pose.progress);
  view.dataset.mediaState = clip.state;
  view.dataset.mediaClip = drawable?.clip.id ?? '';
  if (import.meta.env.DEV)
    view.dataset.mediaTime = String(drawable?.current.video.currentTime ?? 0);
  const mediaImages = drawable
    ? [drawable.current.mask, ...(drawable.previous ? [drawable.previous.mask] : [])]
    : poster
      ? [poster]
      : [];
  const indices = pose.weights.flatMap((weight, index) => (weight > 0 ? [index] : []));
  const nextMaskKey = mediaImages.length
    ? mediaImages.map(image => image.src).join('|')
    : `${reducedMotion}:${indices.join(',')}`;
  if (maskDirty || nextMaskKey !== maskKey) {
    bridge?.hitMask(
      mediaImages.length ? petMediaHitMask(mediaImages) : petHitMask(atlas, reducedMotion, indices),
    );
    maskDirty = false;
    maskKey = nextMaskKey;
  }
}

function frame(now: number): void {
  frameId = undefined;
  if (disposed || document.hidden || !nativeVisible) return;
  draw(now);
  if (!reducedMotion) frameId = requestAnimationFrame(frame);
}

function refresh(): void {
  if (frameId !== undefined) cancelAnimationFrame(frameId);
  frameId = undefined;
  animation.setReducedMotion(reducedMotion, performance.now());
  animation.setContinuousMedia(media.supported, performance.now());
  frame(performance.now());
}

function updateBubble(text: string | null): void {
  if (!bubble) return;
  if (!text) {
    bubble.hidden = true;
    bubble.dataset.visible = 'false';
    bubble.textContent = '';
    return;
  }
  bubble.hidden = false;
  bubble.textContent = text;
  bubble.dataset.visible = 'true';
}

function update(snapshot: DesktopPetSnapshot): void {
  animation.setState(snapshot.state, performance.now());
  state = snapshot.state;
  systemReducedMotion = snapshot.reducedMotion;
  reducedMotion = systemReducedMotion || reduced.matches;
  media.update({ state, reduced: reducedMotion });
  view.setAttribute('aria-label', snapshot.label);
  view.title = snapshot.label;
  updateBubble(snapshot.bubble);
  if (reducedMotion) maskDirty = true;
  void selectCharacter(snapshot.characterId);
  refresh();
}

async function selectCharacter(id: string): Promise<void> {
  try {
    if (!(await atlas.select(id))) return;
    const { columns, rows, tempo, energy } = atlas.character;
    animation.configure(columns * rows, tempo, energy);
    media.update({
      characterId: atlas.character.id,
      state,
      reduced: reducedMotion,
      visible: nativeVisible && !document.hidden,
    });
    maskDirty = true;
    refresh();
  } catch (error) {
    console.error('[DesktopPet] Character atlas failed to load:', error);
  }
}

const unsubscribe = bridge?.onState(update);
const unsubscribePose = bridge?.onPose(pose => {
  animation.setPose(pose.facing, pose.walking);
  media.update({ walking: pose.walking });
});
const unsubscribeEffect = bridge?.onEffect(effect => {
  if (effect.kind === DesktopPetEffectKind.Visibility) {
    nativeVisible = effect.visible;
    view.dataset.visible = String(nativeVisible);
    animation.setPaused(!nativeVisible || document.hidden, performance.now());
    media.update({ visible: nativeVisible && !document.hidden });
    refresh();
  } else if (effect.kind === DesktopPetEffectKind.Drag) {
    animation.setDragging(effect.active);
    media.update({ dragging: effect.active });
  } else if (reducedMotion) return;
  else if (effect.kind === DesktopPetEffectKind.Action) {
    if (!media.playAction(effect.action)) animation.playAction(effect.action, performance.now());
  } else {
    animation.impact(effect.strength);
    media.impact(effect.strength);
  }
});
const onMotionChange = (): void => {
  reducedMotion = systemReducedMotion || reduced.matches;
  media.update({ reduced: reducedMotion });
  bridge?.motion(reduced.matches);
  maskDirty = true;
  refresh();
};
reduced.addEventListener('change', onMotionChange);
const onVisibilityChange = (): void => {
  animation.setPaused(document.hidden || !nativeVisible, performance.now());
  media.update({ visible: nativeVisible && !document.hidden });
  refresh();
};
document.addEventListener('visibilitychange', onVisibilityChange);
window.addEventListener('resize', refresh);

view.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointerActive = true;
  view.setPointerCapture(event.pointerId);
  bridge?.dragStart();
  if (!bridge) animation.setDragging(true);
  if (!bridge) media.update({ dragging: true });
});
const endDrag = (): void => {
  if (!pointerActive) return;
  pointerActive = false;
  bridge?.dragEnd();
  if (!bridge) animation.setDragging(false);
  if (!bridge) media.update({ dragging: false });
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
    media.update({ state });
    if (!reducedMotion && !media.playAction(DesktopPetPlayableAction.Happy))
      animation.playAction(DesktopPetPlayableAction.Happy, performance.now());
    maskDirty = true;
    refresh();
  }
});

async function initialize(): Promise<void> {
  const parameters = new URLSearchParams(location.search);
  if (import.meta.env.DEV && !bridge) {
    const requested = parameters.get('state');
    if (Object.values(DesktopPetState).includes(requested as DesktopPetState))
      state = requested as DesktopPetState;
  }
  await selectCharacter(
    import.meta.env.DEV && !bridge
      ? (parameters.get('character') ?? DesktopPetBuiltinId.Xiaoyuan)
      : DesktopPetBuiltinId.Xiaoyuan,
  );
  animation.setState(state, performance.now());
  media.update({ state, reduced: reducedMotion, visible: !document.hidden && nativeVisible });
  animation.setReducedMotion(reducedMotion, performance.now());
  if (import.meta.env.DEV && !bridge) {
    const action = parameters.get('action') as DesktopPetPlayableAction;
    if (Object.values(DesktopPetPlayableAction).includes(action))
      if (!media.playAction(action)) animation.playAction(action, performance.now());
  }
  view.setAttribute('aria-label', document.title);
  refresh();
  bridge?.motion(reduced.matches);
  bridge?.ready();
}
void initialize();

window.addEventListener('pagehide', () => {
  disposed = true;
  media.dispose();
  if (frameId !== undefined) cancelAnimationFrame(frameId);
  unsubscribe?.();
  unsubscribePose?.();
  unsubscribeEffect?.();
  reduced.removeEventListener('change', onMotionChange);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('resize', refresh);
});
