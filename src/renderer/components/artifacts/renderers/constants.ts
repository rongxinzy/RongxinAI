export const ModelFileExtension = {
  Stl: '.stl',
  Ply: '.ply',
  Obj: '.obj',
  Gltf: '.gltf',
  Glb: '.glb',
  ThreeMf: '.3mf',
} as const;

export type ModelFileExtension = (typeof ModelFileExtension)[keyof typeof ModelFileExtension];
