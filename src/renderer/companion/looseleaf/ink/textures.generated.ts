import texture0 from './assets/textures.generated-0.png';
import texture1 from './assets/textures.generated-1.png';
import texture2 from './assets/textures.generated-2.png';
import texture3 from './assets/textures.generated-3.png';
import texture4 from './assets/textures.generated-4.png';
export type GrainMaskKind = 'felt' | 'marker' | 'graphite' | 'waxy' | 'stamp';

export interface GrainTile {
  uri: string;
  size: number;
  density: number;
  css: number;
  bytes: number;
  mean: number;
}

export const GRAIN_TILES: Record<GrainMaskKind, GrainTile> = {
  felt: {
    uri: texture0,
    size: 224,
    density: 2,
    css: 112,
    bytes: 14622,
    mean: 0.897,
  },
  marker: {
    uri: texture1,
    size: 256,
    density: 2,
    css: 128,
    bytes: 19041,
    mean: 0.932,
  },
  graphite: {
    uri: texture2,
    size: 224,
    density: 2,
    css: 112,
    bytes: 13207,
    mean: 0.866,
  },
  waxy: {
    uri: texture3,
    size: 224,
    density: 2,
    css: 112,
    bytes: 10023,
    mean: 0.931,
  },
  stamp: {
    uri: texture4,
    size: 320,
    density: 2,
    css: 160,
    bytes: 12359,
    mean: 0.928,
  },
};
