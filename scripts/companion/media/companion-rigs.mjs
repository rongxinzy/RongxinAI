import { createCanvas, loadImage } from '@napi-rs/canvas';
import { DesktopPetBuiltinId as Character } from '../../../src/shared/desktopPet/catalog.ts';

const common = {
  body: [256, 352, 172, 184],
  head: [256, 222, 232, 180],
  face: [0, 14, 202, 132],
  eyeBand: [0.22, 0.65],
  arms: [188, 324, 66, 108],
  armPivots: [
    [0.8, 0.85],
    [0.2, 0.85],
  ],
  armTips: [
    [0.23, 0.2],
    [0.77, 0.2],
  ],
  feet: [222, 450, 50, 58],
  bandana: [256, 306, 150, 74],
  ears: [76, -61, 86, 94, 0.85],
  tail: [228, 426, 153, 166, 0.5, 0.88],
  tailSwing: 0.13,
  energy: 1,
  walkCycles: 4,
};

/** Joint geometry is media authoring data, independent of product UI themes. */
export const COMPANION_RIGS = {
  [Character.Youli]: {
    ...common,
    id: Character.Youli,
    ears: [76, -50, 86, 94, 0.85],
    tail: [224, 427, 180, 180, 0.7, 0.95],
    armPivots: [
      [0.74, 0.1],
      [0.26, 0.1],
    ],
    armTips: [
      [0.28, 0.88],
      [0.72, 0.88],
    ],
  },
  [Character.Tuantuan]: {
    ...common,
    id: Character.Tuantuan,
    head: [256, 230, 222, 188],
    ears: [82, -53, 58, 58, 0.85],
    tail: [305, 425, 133, 116, 0.5, 0.86],
    energy: 0.82,
    tailSwing: 0.07,
    walkCycles: 3,
  },
  [Character.Mianmian]: {
    ...common,
    id: Character.Mianmian,
    head: [256, 218, 205, 195],
    face: [0, 17, 179, 137],
    ears: [86, -33, 68, 179, 0.1],
    body: [256, 352, 151, 182],
    arms: [198, 323, 56, 101],
    tail: [314, 416, 63, 62, 0.5, 0.5],
    feet: [224, 450, 55, 53],
    tailSwing: 0.04,
  },
  [Character.Zhuli]: {
    ...common,
    id: Character.Zhuli,
    head: [256, 224, 232, 187],
    ears: [80, -58, 71, 74, 0.85],
    tail: [313, 430, 175, 157, 0.5, 0.88],
    energy: 0.85,
    walkCycles: 3,
  },
  [Character.Yunmo]: {
    ...common,
    id: Character.Yunmo,
    head: [256, 218, 225, 198],
    face: [0, 21, 185, 133],
    ears: [94, -6, 68, 83, 0.5],
    body: [256, 356, 177, 188],
    tail: [306, 426, 153, 125, 0.5, 0.88],
    wings: [188, 312, 135, 135],
    tailSwing: 0.1,
  },
  [Character.Maixiao]: {
    ...common,
    id: Character.Maixiao,
    head: [256, 236, 234, 179],
    ears: [77, -59, 82, 99, 0.85],
    body: [256, 361, 188, 159],
    arms: [187, 332, 60, 88],
    feet: [220, 450, 56, 48],
    tail: [330, 406, 58, 61, 0.5, 0.75],
    energy: 1.08,
    tailSwing: 0.32,
    walkCycles: 6,
  },
};

const names = [
  'body',
  'head',
  'leftArm',
  'rightArm',
  'leftFoot',
  'rightFoot',
  'tail',
  'bandana',
  'face',
  'blink',
  'happy',
  'worried',
  'leftEar',
  'rightEar',
  'leftWing',
  'rightWing',
];

/** Pieces can cross a nominal cell boundary; locate whole alpha components before grouping. */
function locateComponents(pixels, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const groups = Array.from({ length: names.length }, () => []);
  for (let seed = 0; seed < visited.length; seed++) {
    if (visited[seed] || pixels[seed * 4 + 3] <= 32) continue;
    visited[seed] = 1;
    let read = 0,
      write = 1,
      sumX = 0,
      sumY = 0;
    let left = width,
      top = height,
      right = -1,
      bottom = -1;
    queue[0] = seed;
    while (read < write) {
      const index = queue[read++];
      const x = index % width,
        y = Math.floor(index / width);
      sumX += x;
      sumY += y;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (visited[neighbor] || pixels[neighbor * 4 + 3] <= 32) continue;
          visited[neighbor] = 1;
          queue[write++] = neighbor;
        }
    }
    // Ignore detached subpixel fur/noise while retaining small brows and facial features.
    if (write < 24) continue;
    const column = Math.min(3, Math.floor(((sumX / write) * 4) / width));
    const row = Math.min(3, Math.floor(((sumY / write) * 4) / height));
    groups[row * 4 + column].push([left, top, right, bottom]);
  }
  return groups;
}

/** Locate source rectangles without altering the generated source image or its alpha. */
export async function companionRigFrames(source, rig) {
  const image = await loadImage(source);
  if (image.width > 2048 || image.height > 2048 || image.width !== image.height)
    throw new Error('Companion rig must be a bounded square atlas');
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, image.width, image.height).data;
  const components = locateComponents(pixels, image.width, image.height);
  const frames = {};
  const faceBounds = [];
  for (let cell = 0; cell < names.length; cell++) {
    const x0 = Math.round(((cell % 4) * image.width) / 4);
    const y0 = Math.round((Math.floor(cell / 4) * image.height) / 4);
    const pieces = components[cell];
    if (!pieces.length) {
      if (cell < 14 || rig.wings) throw new Error(`Missing authored rig part: ${names[cell]}`);
      continue;
    }
    if (cell >= 14 && !rig.wings) throw new Error('Mammal atlas contains unexpected wing pieces');
    const left = Math.min(...pieces.map(piece => piece[0]));
    const top = Math.min(...pieces.map(piece => piece[1]));
    const right = Math.max(...pieces.map(piece => piece[2]));
    const bottom = Math.max(...pieces.map(piece => piece[3]));
    frames[names[cell]] = [left, top, right - left + 1, bottom - top + 1];
    if (cell >= 8 && cell <= 11) faceBounds.push([left - x0, top - y0, right - x0, bottom - y0]);
  }
  // Expressions share a crop origin, preserving feature alignment across blinking and emotion.
  const left = Math.min(...faceBounds.map(bounds => bounds[0]));
  const top = Math.min(...faceBounds.map(bounds => bounds[1]));
  const right = Math.max(...faceBounds.map(bounds => bounds[2]));
  const bottom = Math.max(...faceBounds.map(bounds => bounds[3]));
  for (let column = 0; column < 4; column++)
    frames[names[8 + column]] = [
      Math.round((column * image.width) / 4) + left,
      Math.round(image.height / 2) + top,
      right - left + 1,
      bottom - top + 1,
    ];
  return frames;
}
