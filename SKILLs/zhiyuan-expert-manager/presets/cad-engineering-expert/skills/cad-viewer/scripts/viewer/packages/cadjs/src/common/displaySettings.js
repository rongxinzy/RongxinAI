import {
  DEFAULT_STEP_CLIP_SETTINGS,
  normalizeStepClipSettings,
  stepClipSettingsEqual
} from "../lib/viewer/clipPlane.js";
// Camera projection and the display-edge primitives are shared theme-engine
// primitives owned by implicitjs (single source of truth, camera.js precedent);
// everything viewer-specific below stays local.
export {
  CAMERA_PROJECTION,
  CAD_EDGE_COLOR,
  CAD_EDGE_HIGHLIGHT_COLOR,
  CAD_EDGE_CLASS_IDS,
  DEFAULT_DISPLAY_EDGE_CLASS_SETTINGS,
  DEFAULT_DISPLAY_EDGE_SETTINGS,
  DISABLED_DISPLAY_EDGE_SETTINGS,
  normalizeCameraProjection,
  normalizeDisplayEdgeClassSettings,
  normalizeDisplayEdgeSettings
} from "implicitjs/common/displaySettings.js";
import {
  DEFAULT_DISPLAY_EDGE_SETTINGS,
  normalizeDisplayEdgeSettings
} from "implicitjs/common/displaySettings.js";

export const CAD_DISPLAY_MODE = Object.freeze({
  HIDDEN_EDGES: "hidden_edges",
  HIDDEN_LINES_REMOVED: "hidden_lines_removed",
  RENDERED: "rendered",
  SOLID: "solid",
  TRANSPARENT: "transparent",
  UNSHADED: "unshaded",
  WIREFRAME: "wireframe"
});

export const CAD_DISPLAY_MODE_VALUES = Object.freeze(Object.values(CAD_DISPLAY_MODE));

// The exploded view is a single slider: `amount` is the 0..1 spread and 0
// means assembled (`enabled` mirrors amount > 0 for consumers that gate on
// it). The layout itself is always computed automatically (see
// lib/viewer/explodedView.js) — there is nothing else to configure.
export const DEFAULT_EXPLODED_VIEW_SETTINGS = Object.freeze({
  enabled: false,
  amount: 0
});

export const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
  mode: CAD_DISPLAY_MODE.SOLID,
  clip: DEFAULT_STEP_CLIP_SETTINGS,
  exploded: DEFAULT_EXPLODED_VIEW_SETTINGS,
  edges: DEFAULT_DISPLAY_EDGE_SETTINGS
});

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

function normalizeModeText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

export function normalizeDisplayMode(value) {
  const normalized = normalizeModeText(value);
  if (!normalized) {
    return CAD_DISPLAY_MODE.SOLID;
  }
  if (normalized === "wire" || normalized === "wire_frame") {
    return CAD_DISPLAY_MODE.WIREFRAME;
  }
  if (
    normalized === "edges" ||
    normalized === "edge" ||
    normalized === "shaded_edges" ||
    normalized === "shaded_with_edges" ||
    normalized === "with_edges"
  ) {
    return CAD_DISPLAY_MODE.SOLID;
  }
  if (
    normalized === "shaded" ||
    normalized === "shaded_without_edges" ||
    normalized === "without_edges"
  ) {
    return CAD_DISPLAY_MODE.RENDERED;
  }
  if (
    normalized === "translucent" ||
    normalized === "xray" ||
    normalized === "x_ray" ||
    normalized === "see_through"
  ) {
    return CAD_DISPLAY_MODE.TRANSPARENT;
  }
  if (
    normalized === "hidden_edge" ||
    normalized === "hidden_edges_visible" ||
    normalized === "hidden_edge_display" ||
    normalized === "shaded_hidden_edges"
  ) {
    return CAD_DISPLAY_MODE.HIDDEN_EDGES;
  }
  if (
    normalized === "visible_edges" ||
    normalized === "visible_edges_only" ||
    normalized === "hidden_lines" ||
    normalized === "hidden_line_removed" ||
    normalized === "hidden_lines_removed" ||
    normalized === "hidden_edges_removed"
  ) {
    return CAD_DISPLAY_MODE.HIDDEN_LINES_REMOVED;
  }
  if (normalized === "flat") {
    return CAD_DISPLAY_MODE.UNSHADED;
  }
  if (normalized === "theme" || normalized === "material" || normalized === "materials") {
    return CAD_DISPLAY_MODE.RENDERED;
  }
  return CAD_DISPLAY_MODE_VALUES.includes(normalized)
    ? normalized
    : CAD_DISPLAY_MODE.SOLID;
}

export function normalizeExplodedViewSettings(value = null) {
  const source = isObject(value) ? value : {};
  return {
    enabled: Boolean(source.enabled),
    amount: normalizeNumber(source.amount, DEFAULT_EXPLODED_VIEW_SETTINGS.amount, 0, 1)
  };
}

export function normalizeDisplaySettings(value = null) {
  const source = isObject(value) ? value : {};
  return {
    mode: normalizeDisplayMode(source.mode),
    clip: normalizeStepClipSettings(source.clip),
    exploded: normalizeExplodedViewSettings(source.exploded),
    edges: normalizeDisplayEdgeSettings(source.edges)
  };
}

export function cloneDisplaySettings(value = DEFAULT_DISPLAY_SETTINGS) {
  return normalizeDisplaySettings(value);
}

export function displaySettingsEqual(left, right) {
  const a = normalizeDisplaySettings(left);
  const b = normalizeDisplaySettings(right);
  return a.mode === b.mode &&
    stepClipSettingsEqual(a.clip, b.clip) &&
    JSON.stringify(a.exploded) === JSON.stringify(b.exploded) &&
    JSON.stringify(a.edges) === JSON.stringify(b.edges);
}

export function resolveDisplayMode(displaySettings) {
  return normalizeDisplaySettings(displaySettings).mode;
}

export function resolveDisplayEdgeSettings(displaySettings) {
  return normalizeDisplaySettings(displaySettings).edges;
}

export function displayModeIsWireframe(value) {
  return normalizeDisplayMode(value) === CAD_DISPLAY_MODE.WIREFRAME;
}

export function displayModeForcesEdges(value) {
  return [
    CAD_DISPLAY_MODE.SOLID,
    CAD_DISPLAY_MODE.TRANSPARENT,
    CAD_DISPLAY_MODE.HIDDEN_EDGES,
    CAD_DISPLAY_MODE.HIDDEN_LINES_REMOVED
  ].includes(normalizeDisplayMode(value));
}

export function displayModeAllowsEdges(value) {
  return ![
    CAD_DISPLAY_MODE.RENDERED,
    CAD_DISPLAY_MODE.UNSHADED
  ].includes(normalizeDisplayMode(value));
}

export function displayModeShowsEdges(value, edgeSettings = null) {
  const mode = normalizeDisplayMode(value);
  return mode === CAD_DISPLAY_MODE.WIREFRAME ||
    displayModeForcesEdges(mode);
}

export function displayModeShowsThroughEdges(value) {
  return [
    CAD_DISPLAY_MODE.TRANSPARENT,
    CAD_DISPLAY_MODE.HIDDEN_EDGES
  ].includes(normalizeDisplayMode(value));
}

export function displayModeUsesTransparentSurfaces(value) {
  return [
    CAD_DISPLAY_MODE.TRANSPARENT,
    CAD_DISPLAY_MODE.HIDDEN_LINES_REMOVED,
    CAD_DISPLAY_MODE.WIREFRAME
  ].includes(normalizeDisplayMode(value));
}

export function displayModeUsesUnlitSurfaces(value) {
  return [
    CAD_DISPLAY_MODE.UNSHADED,
    CAD_DISPLAY_MODE.HIDDEN_LINES_REMOVED,
    CAD_DISPLAY_MODE.WIREFRAME
  ].includes(normalizeDisplayMode(value));
}

export function displayModeSurfaceOpacity(value, fallback = 1) {
  const mode = normalizeDisplayMode(value);
  if (mode === CAD_DISPLAY_MODE.WIREFRAME) {
    return 0.035;
  }
  if (mode === CAD_DISPLAY_MODE.TRANSPARENT) {
    return 0.22;
  }
  if (mode === CAD_DISPLAY_MODE.HIDDEN_LINES_REMOVED) {
    return 0.045;
  }
  const numericFallback = Number(fallback);
  return Number.isFinite(numericFallback) ? numericFallback : 1;
}
