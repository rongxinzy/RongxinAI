/**
 * Double-buffer switch adapted from dsh-pet PetSprite.switchTo.
 * Copyright (c) 2026 PC2005-cloud. MIT; full text: public/licenses/dsh-pet.txt.
 * Source: 4eb75e6a5779ee7dccbed29dc83a621c1876d2f9,
 * dsh-pet/runtime/electron-helper/sprite.js.
 * Host adaptation uses first decoded frames, cancellable generations and two owned slots.
 */
import type { DesktopPetMediaClip } from './mediaPack';

const FADE_MS = 120;
const LOAD_TIMEOUT_MS = 8000;
export const PetVideoState = {
  Empty: 'empty',
  Loading: 'loading',
  Playing: 'playing',
  Failed: 'failed',
} as const;
type Slot = {
  video: HTMLVideoElement;
  mask: HTMLImageElement;
  abort?: AbortController;
  stalled?: ReturnType<typeof setTimeout>;
};
type Playing = { slot: number; clip: DesktopPetMediaClip };
interface Options {
  changed(): void;
  ended(): void;
  failed(clip: DesktopPetMediaClip): void;
  video?(): HTMLVideoElement;
  image?(): HTMLImageElement;
  now?(): number;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('Media load cancelled'));
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener('abort', cancel, { once: true });
    work.then(
      value => {
        signal.removeEventListener('abort', cancel);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', cancel);
        reject(error);
      },
    );
  });
}

export class PetVideoPlayer {
  private readonly slots: Slot[];
  private generation = 0;
  private pending: AbortController | undefined;
  private active: Playing | undefined;
  private previous: Playing | undefined;
  private switchedAt = 0;
  private disposed = false;
  private requested: string | undefined;
  state: (typeof PetVideoState)[keyof typeof PetVideoState] = PetVideoState.Empty;
  constructor(private readonly options: Options) {
    this.slots = [0, 1].map(() => ({
      video: options.video?.() ?? document.createElement('video'),
      mask: options.image?.() ?? new Image(),
    }));
    for (const { video } of this.slots) {
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
    }
  }

  private clear(slot: number): void {
    const { video, mask } = this.slots[slot];
    clearTimeout(this.slots[slot].stalled);
    this.slots[slot].abort?.abort();
    this.slots[slot].abort = undefined;
    video.onended = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
    mask.removeAttribute('src');
  }

  stop(): void {
    this.generation++;
    this.pending?.abort();
    this.pending = undefined;
    this.active = this.previous = undefined;
    this.requested = undefined;
    this.state = PetVideoState.Empty;
    this.slots.forEach((_slot, index) => this.clear(index));
  }

  play(clip: DesktopPetMediaClip, restart = false): void {
    if (this.disposed || (!restart && this.requested === clip.id)) return;
    this.pending?.abort();
    if (this.previous) this.clear(this.previous.slot);
    this.previous = undefined;
    const generation = ++this.generation;
    const request = new AbortController();
    this.pending = request;
    this.requested = clip.id;
    this.state = PetVideoState.Loading;
    const slot = this.active?.slot === 0 ? 1 : 0;
    this.clear(slot);
    this.slots[slot].abort = request;
    const { video, mask } = this.slots[slot];
    let frameId: number | undefined;
    const timer = setTimeout(() => request.abort(), LOAD_TIMEOUT_MS);
    const current = () =>
      !this.disposed && generation === this.generation && !request.signal.aborted;
    const loaded = new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true, signal: request.signal });
      video.addEventListener('error', () => reject(new Error('Media decode failed')), {
        once: true,
        signal: request.signal,
      });
      request.signal.addEventListener('abort', () => reject(new Error('Media load cancelled')), {
        once: true,
      });
    });
    video.loop = clip.loop;
    video.src = clip.url;
    mask.src = clip.maskUrl;
    video.load();
    void (async () => {
      try {
        await abortable(Promise.all([loaded, mask.decode()]), request.signal);
        if (!current()) return;
        const decoded = new Promise<void>((resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => {
              if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
              reject(new Error('Media frame cancelled'));
            },
            { once: true },
          );
          frameId = video.requestVideoFrameCallback(() => resolve());
        });
        await Promise.all([video.play(), decoded]);
        if (!current()) return;
        clearTimeout(timer);
        this.previous = this.active;
        if (this.previous) this.slots[this.previous.slot].video.pause();
        this.active = { slot, clip };
        this.switchedAt = this.options.now?.() ?? performance.now();
        this.pending = undefined;
        this.state = PetVideoState.Playing;
        video.onended = () => {
          if (this.active?.slot !== slot || this.active.clip !== clip || this.pending) return;
          this.requested = undefined;
          clearTimeout(this.slots[slot].stalled);
          video.onended = null;
          this.options.ended();
        };
        video.addEventListener(
          'error',
          () => {
            if (this.active?.slot !== slot || this.active.clip !== clip || this.pending) return;
            this.stop();
            this.state = PetVideoState.Failed;
            this.options.failed(clip);
            this.options.changed();
          },
          { once: true, signal: request.signal },
        );
        const stalled = () => {
          if (this.active?.slot !== slot || this.pending) return;
          clearTimeout(this.slots[slot].stalled);
          this.slots[slot].stalled = setTimeout(() => {
            if (this.active?.slot !== slot || this.active.clip !== clip || this.pending) return;
            this.stop();
            this.state = PetVideoState.Failed;
            this.options.failed(clip);
            this.options.changed();
          }, LOAD_TIMEOUT_MS);
        };
        video.addEventListener('waiting', stalled, { signal: request.signal });
        video.addEventListener('stalled', stalled, { signal: request.signal });
        video.addEventListener('playing', () => clearTimeout(this.slots[slot].stalled), {
          signal: request.signal,
        });
        this.options.changed();
      } catch {
        if (generation !== this.generation || this.disposed) return;
        this.stop();
        this.state = PetVideoState.Failed;
        this.options.failed(clip);
        this.options.changed();
      } finally {
        clearTimeout(timer);
        if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      }
    })();
  }

  sample(now: number) {
    if (!this.active) return null;
    const mix = Math.min(1, Math.max(0, (now - this.switchedAt) / FADE_MS));
    if (mix >= 1 && this.previous) {
      this.clear(this.previous.slot);
      this.previous = undefined;
    }
    return {
      clip: this.active.clip,
      current: this.slots[this.active.slot],
      previous: this.previous ? this.slots[this.previous.slot] : undefined,
      mix,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}
