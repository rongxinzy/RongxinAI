// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';
import { petMediaHitMask } from './draw';

test('repeated decoded masks reuse one scratch surface without ghosts or an unbounded cache', () => {
  const center = 96 * DESKTOP_PET_SIZE + 96;
  const other = 64 * DESKTOP_PET_SIZE + 64;
  const pixels = new Uint8ClampedArray(DESKTOP_PET_SIZE * DESKTOP_PET_SIZE * 4);
  const read = vi.fn(() => ({ data: pixels.slice() }) as ImageData);
  // Geometry and real decoded alpha are covered by the browser media tests.
  const context = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    clearRect() {
      pixels.fill(0);
    },
    drawImage(image: HTMLImageElement) {
      pixels[(image.src.endsWith('beta.png') ? other : center) * 4 + 3] = 255;
    },
    getImageData: read,
  } as unknown as CanvasRenderingContext2D;
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const image = (name: string) => {
    const item = new Image();
    item.src = `https://assets.invalid/${name}.png`;
    return item;
  };
  try {
    const alpha = petMediaHitMask([image('alpha')]);
    expect(alpha[center]).toBe(255);
    expect(alpha[other]).toBe(0);
    const beta = petMediaHitMask([image('beta')]);
    expect(beta[center]).toBe(0);
    expect(beta[other]).toBe(255);
    const union = petMediaHitMask([image('alpha'), image('beta')]);
    expect(union[center]).toBe(255);
    expect(union[other]).toBe(255);
    union.fill(0);
    expect(petMediaHitMask([image('alpha')])[center]).toBe(255);
    expect(read).toHaveBeenCalledTimes(2);

    for (let index = 0; index < 49; index++) petMediaHitMask([image(`new-${index}`)]);
    const before = read.mock.calls.length;
    petMediaHitMask([image('alpha')]);
    expect(read.mock.calls.length).toBe(before + 1);
    expect(getContext).toHaveBeenCalledTimes(1);
  } finally {
    getContext.mockRestore();
  }
});
