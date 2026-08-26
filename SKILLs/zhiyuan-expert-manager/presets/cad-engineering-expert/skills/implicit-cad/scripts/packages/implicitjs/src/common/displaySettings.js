// Display-setting primitives shared by the theme engine, sourced here (single source
// of truth in implicitjs per the repo dependency rule; cadjs re-exports these — see
// camera.js for the same arrangement).
//
// Scope: only the primitives the theme settings need — the camera projection enum and
// the CAD display-edge defaults/normalizer. The wider viewer display surface (display
// modes, STEP clip planes, exploded view) stays in cadjs, where its consumers live.

export const CAMERA_PROJECTION = Object.freeze({
  PERSPECTIVE: "perspective",
  ORTHOGRAPHIC: "orthographic"
});

export function normalizeCameraProjection(value, fallback = CAMERA_PROJECTION.PERSPECTIVE) {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === CAMERA_PROJECTION.ORTHOGRAPHIC) {
    return CAMERA_PROJECTION.ORTHOGRAPHIC;
  }
  if (normalizedValue === CAMERA_PROJECTION.PERSPECTIVE) {
    return CAMERA_PROJECTION.PERSPECTIVE;
  }
  return fallback === CAMERA_PROJECTION.ORTHOGRAPHIC
    ? CAMERA_PROJECTION.ORTHOGRAPHIC
    : CAMERA_PROJECTION.PERSPECTIVE;
}

export const CAD_EDGE_COLOR = "#132232";
export const CAD_EDGE_HIGHLIGHT_COLOR = "#8dc5ff";
export const CAD_EDGE_CLASS_IDS = Object.freeze(["feature", "tangent", "seam", "degenerate"]);

export const DEFAULT_DISPLAY_EDGE_CLASS_SETTINGS = Object.freeze({
  feature: Object.freeze({
    color: CAD_EDGE_COLOR,
    opacity: 1,
    thickness: 1.15
  }),
  tangent: Object.freeze({
    color: CAD_EDGE_COLOR,
    opacity: 0.5,
    thickness: 1.15
  }),
  seam: Object.freeze({
    color: CAD_EDGE_COLOR,
    opacity: 0.85,
    thickness: 1.15
  }),
  degenerate: Object.freeze({
    color: CAD_EDGE_COLOR,
    opacity: 1,
    thickness: 0
  })
});

export const DEFAULT_DISPLAY_EDGE_SETTINGS = Object.freeze({
  enabled: true,
  color: CAD_EDGE_COLOR,
  thickness: 1,
  classes: DEFAULT_DISPLAY_EDGE_CLASS_SETTINGS,
  highlightColor: CAD_EDGE_HIGHLIGHT_COLOR,
  highlightOpacity: 1,
  highlightThickness: 3,
  silhouette: false,
  silhouetteScale: 0
});

export const DISABLED_DISPLAY_EDGE_SETTINGS = Object.freeze({
  ...DEFAULT_DISPLAY_EDGE_SETTINGS,
  enabled: false
});

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeNumber(value, fallback, min = -Infinity, max = Infinity) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return clamp(numericValue, min, max);
}

function normalizeColor(value, fallback) {
  const normalized = String(value || "").trim();
  if (!HEX_COLOR_PATTERN.test(normalized)) {
    return fallback;
  }
  return normalized.length === 4
    ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`.toLowerCase()
    : normalized.toLowerCase();
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeDisplayEdgeClassSettings(
  value = {},
  fallback = DEFAULT_DISPLAY_EDGE_CLASS_SETTINGS,
  colorFallback = CAD_EDGE_COLOR
) {
  const source = isObject(value) ? value : {};
  const fallbackColor = normalizeColor(colorFallback, CAD_EDGE_COLOR);
  return Object.fromEntries(CAD_EDGE_CLASS_IDS.map((classId) => {
    const classSource = isObject(source[classId]) ? source[classId] : {};
    const classFallback = fallback?.[classId] || DEFAULT_DISPLAY_EDGE_CLASS_SETTINGS[classId];
    return [classId, {
      color: normalizeColor(classSource.color, fallbackColor),
      opacity: normalizeNumber(classSource.opacity, classFallback.opacity, 0, 1),
      thickness: normalizeNumber(classSource.thickness, classFallback.thickness, 0, 6)
    }];
  }));
}

export function normalizeDisplayEdgeSettings(value = null, fallback = DEFAULT_DISPLAY_EDGE_SETTINGS) {
  const source = isObject(value) ? value : {};
  const color = normalizeColor(source.color, fallback.color);
  const normalized = {
    enabled: normalizeBoolean(source.enabled, fallback.enabled),
    color,
    thickness: normalizeNumber(source.thickness, fallback.thickness, 0.5, 6),
    classes: normalizeDisplayEdgeClassSettings(source.classes, fallback.classes, color),
    highlightColor: normalizeColor(source.highlightColor, fallback.highlightColor || CAD_EDGE_HIGHLIGHT_COLOR),
    highlightOpacity: normalizeNumber(source.highlightOpacity, fallback.highlightOpacity || 1, 0, 1),
    highlightThickness: normalizeNumber(source.highlightThickness, fallback.highlightThickness || 3, 0.5, 6),
    silhouette: normalizeBoolean(source.silhouette, fallback.silhouette || false),
    silhouetteScale: normalizeNumber(source.silhouetteScale, fallback.silhouetteScale || 0, 0, 0.04)
  };
  if (typeof source.depthTest === "boolean") {
    normalized.depthTest = source.depthTest;
  }
  return normalized;
}
