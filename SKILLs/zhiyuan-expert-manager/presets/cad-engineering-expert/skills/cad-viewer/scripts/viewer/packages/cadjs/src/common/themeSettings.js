// Theme settings live in implicitjs as the single source of truth (camera.js
// precedent): cadjs depends on implicitjs and re-exports the module here so
// existing `cadjs/common/themeSettings.js` importers keep working without
// maintaining a second diverging copy. The historical cadjs copy was the rich
// one and became this shared module verbatim; the stale implicitjs copy it
// replaced is gone.
export * from "implicitjs/common/themeSettings.js";
