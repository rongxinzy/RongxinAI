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
type Pending = Playing & { abort: AbortController; deferred: boolean };
interface Options {
  changed(): void;
  ended(): void;
  failed(clip: DesktopPetMediaClip): void;
  started?(clip: DesktopPetMediaClip): void;
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
  private pending: Pending | undefined;
  private prepared: Playing | undefined;
  private queued: DesktopPetMediaClip | undefined;
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
    this.pending?.abort.abort();
    this.pending = undefined;
    this.prepared = this.queued = undefined;
    this.active = this.previous = undefined;
    this.requested = undefined;
    this.state = PetVideoState.Empty;
    this.slots.forEach((_slot, index) => this.clear(index));
  }

  play(clip: DesktopPetMediaClip, restart = false): void {
    if (this.disposed || (!restart && this.requested === clip.id)) return;
    this.queued = undefined;
    if (this.pending?.deferred && this.pending.clip.id === clip.id) {
      // The real end arrived before preparation finished. Reuse that load.
      this.pending.deferred = false;
      this.requested = clip.id;
      this.state = PetVideoState.Loading;
      return;
    }
    if (this.prepared?.clip.id === clip.id) {
      const prepared = this.prepared;
      this.prepared = undefined;
      const abort = this.slots[prepared.slot].abort!;
      const pending = { ...prepared, abort, deferred: false };
      this.pending = pending;
      this.requested = clip.id;
      this.state = PetVideoState.Loading;
      this.slots[prepared.slot].stalled = setTimeout(() => {
        if (this.pending === pending) this.fail(pending);
      }, LOAD_TIMEOUT_MS);
      void this.slots[prepared.slot].video.play().then(
        () => {
          if (this.pending === pending && !abort.signal.aborted) this.promote(pending);
        },
        () => {
          if (this.pending === pending) this.fail(pending);
        },
      );
      return;
    }
    this.pending?.abort.abort();
    this.prepared = undefined;
    if (this.previous) this.clear(this.previous.slot);
    this.previous = undefined;
    this.requested = clip.id;
    this.state = PetVideoState.Loading;
    this.load(clip, false);
  }

  /** Uses only the spare slot; never replaces the visible clip before its real end. */
  prepare(clip: DesktopPetMediaClip): void {
    if (this.disposed || !this.active) return;
    this.queued = clip;
    this.prepareNext();
  }

  private prepareNext(): void {
    if (!this.queued || this.previous || this.pending || this.prepared || !this.active) return;
    const clip = this.queued;
    this.queued = undefined;
    this.load(clip, true);
  }

  private fail(pending: Pending): void {
    if (pending.deferred) {
      // Speculation may fail without interrupting the current action. A later
      // explicit play can try normally and retain the existing static fallback.
      this.pending = undefined;
      this.clear(pending.slot);
      return;
    }
    this.stop();
    this.state = PetVideoState.Failed;
    this.options.failed(pending.clip);
    this.options.changed();
  }

  private load(clip: DesktopPetMediaClip, deferred: boolean): void {
    const generation = ++this.generation;
    const request = new AbortController();
    const slot = this.active?.slot === 0 ? 1 : 0;
    this.clear(slot);
    const pending = { clip, slot, abort: request, deferred };
    this.pending = pending;
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
        if (pending.deferred) {
          video.pause();
          this.prepared = { slot, clip };
          this.pending = undefined;
        } else this.promote(pending);
      } catch {
        if (generation !== this.generation || this.disposed) return;
        this.fail(pending);
      } finally {
        clearTimeout(timer);
        if (frameId !== undefined) video.cancelVideoFrameCallback(frameId);
      }
    })();
  }

  private promote({ slot, clip }: Playing): void {
    const { video, abort } = this.slots[slot];
    clearTimeout(this.slots[slot].stalled);
    this.previous = this.active;
    if (this.previous) this.slots[this.previous.slot].video.pause();
    this.active = { slot, clip };
    this.switchedAt = this.options.now?.() ?? performance.now();
    this.pending = undefined;
    this.state = PetVideoState.Playing;
    const current = () => this.active?.slot === slot && this.active.clip === clip;
    const transitioning = () => Boolean(this.pending && !this.pending.deferred);
    const failed = () => {
      if (!current() || transitioning()) return;
      this.stop();
      this.state = PetVideoState.Failed;
      this.options.failed(clip);
      this.options.changed();
    };
    video.onended = () => {
      if (!current() || transitioning()) return;
      this.requested = undefined;
      clearTimeout(this.slots[slot].stalled);
      video.onended = null;
      this.options.ended();
    };
    video.addEventListener('error', failed, { once: true, signal: abort!.signal });
    const stalled = () => {
      if (!current() || transitioning()) return;
      clearTimeout(this.slots[slot].stalled);
      this.slots[slot].stalled = setTimeout(failed, LOAD_TIMEOUT_MS);
    };
    video.addEventListener('waiting', stalled, { signal: abort!.signal });
    video.addEventListener('stalled', stalled, { signal: abort!.signal });
    video.addEventListener('playing', () => clearTimeout(this.slots[slot].stalled), {
      signal: abort!.signal,
    });
    this.options.started?.(clip);
    this.options.changed();
  }

  sample(now: number) {
    if (!this.active) return null;
    const mix = Math.min(1, Math.max(0, (now - this.switchedAt) / FADE_MS));
    if (mix >= 1 && this.previous) {
      this.clear(this.previous.slot);
      this.previous = undefined;
      this.prepareNext();
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
