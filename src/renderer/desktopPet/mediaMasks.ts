import { petMediaHitMask } from './draw';
import type { DesktopPetMediaMaskRequest, DesktopPetMediaMaskResponse } from './mediaMasks.worker';

const MAX_MEDIA_MASKS = 48;
const canUseWorker = () =>
  typeof Worker !== 'undefined' &&
  typeof OffscreenCanvas !== 'undefined' &&
  typeof createImageBitmap === 'function';

export class DesktopPetMediaMasks {
  private worker: Worker | undefined;
  private generation = 0;
  private pendingKey = '';
  private latestImages: HTMLImageElement[] = [];
  private failed = false;
  private disposed = false;
  private readonly values = new Map<string, Uint8Array>();

  constructor(private readonly ready: (key: string, mask: Uint8Array) => void) {}

  get(images: HTMLImageElement[]): Uint8Array | undefined {
    const key = images.map(image => image.src).join('|');
    const cached = this.values.get(key);
    if (cached) {
      this.values.delete(key);
      this.values.set(key, cached);
      return cached;
    }
    if (this.disposed || this.pendingKey === key) return undefined;
    this.pendingKey = key;
    this.latestImages = images;
    const generation = ++this.generation;
    if (this.failed || !canUseWorker()) this.fallback(generation, key, images);
    else void this.load(generation, key, images);
    return undefined;
  }

  private async load(generation: number, key: string, images: HTMLImageElement[]): Promise<void> {
    let bitmaps: ImageBitmap[] = [];
    try {
      bitmaps = await Promise.all(
        images.map(image =>
          createImageBitmap(image, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }),
        ),
      );
      if (this.disposed || generation !== this.generation) {
        bitmaps.forEach(bitmap => bitmap.close());
        return;
      }
      const worker = this.ensureWorker();
      const request: DesktopPetMediaMaskRequest = {
        id: generation,
        key,
        images: images.map((image, index) => ({ src: image.src, bitmap: bitmaps[index]! })),
      };
      worker.postMessage(
        request,
        request.images.map(image => image.bitmap),
      );
    } catch {
      bitmaps.forEach(bitmap => bitmap.close());
      this.fallback(generation, key, images);
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./mediaMasks.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<DesktopPetMediaMaskResponse>) => {
      const { id, key, mask } = event.data;
      if (this.disposed || id !== this.generation) return;
      this.pendingKey = '';
      const value = new Uint8Array(mask);
      this.store(key, value);
      this.ready(key, value);
    };
    worker.onerror = event => {
      event.preventDefault();
      this.failed = true;
      this.fallback(this.generation, this.pendingKey, this.latestImages);
    };
    this.worker = worker;
    return worker;
  }

  private fallback(generation: number, key: string, images: HTMLImageElement[]): void {
    if (this.disposed || generation !== this.generation || !key) return;
    this.pendingKey = '';
    const value = petMediaHitMask(images);
    this.store(key, value);
    this.ready(key, value);
  }

  private store(key: string, value: Uint8Array): void {
    if (this.values.size >= MAX_MEDIA_MASKS) this.values.delete(this.values.keys().next().value!);
    this.values.set(key, value);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.pendingKey = '';
    this.latestImages = [];
    this.worker?.terminate();
    this.worker = undefined;
    this.values.clear();
  }
}
