export const ModelFileExtension = {
  Stl: '.stl',
  Ply: '.ply',
  Obj: '.obj',
  Gltf: '.gltf',
  Glb: '.glb',
  ThreeMf: '.3mf',
} as const;

export type ModelFileExtension = (typeof ModelFileExtension)[keyof typeof ModelFileExtension];

// OrbitControls rotates the camera, so a negative orbit makes the model appear clockwise.
export const MODEL_AUTO_ROTATE_SPEED = -2;
