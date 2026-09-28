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

/**
 * A saved web page can be several megabytes (plus every asset it references).
 * Beyond this size the HTML preview is skipped: decoding and inlining it would
 * block the renderer for a long time and the page would take over the app.
 */
export const MAX_PREVIEW_HTML_CHARS = 1_000_000;

/** Upper bound for the local resources inlined into a path-backed preview. */
export const MAX_INLINE_PREVIEW_RESOURCES = 24;
