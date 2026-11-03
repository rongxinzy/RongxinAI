import type { Rng } from '@/companion/looseleaf/ink/rng';

export function noise1(rng: Rng, length: number, wavelength: number): (s: number) => number {
  const n = Math.max(6, Math.ceil(length / wavelength) + 6);
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) k[i] = rng() * 2 - 1;
  const off = rng() * wavelength;
  const maxI = n - 3;
  return s => {
    const u = (s + off) / wavelength;
    const fl = Math.floor(u);
    const i = Math.max(1, Math.min(maxI, fl + 1));
    const t = fl + 1 > maxI ? 1 : u - fl;
    const p0 = k[i - 1],
      p1 = k[i],
      p2 = k[i + 1],
      p3 = k[i + 2];
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
    );
  };
}
