import { createScreenSpaceLineSegments } from "../../common/renderEdges.js";

export const URDF_POSE_PICKER_SHELL_WIDTH_SEGMENTS = 100;
export const URDF_POSE_PICKER_SHELL_HEIGHT_SEGMENTS = 50;

const URDF_POSE_PICKER_MARKER_COLOR = "#38bdf8";
const URDF_POSE_PICKER_HOVER_FILL_COLOR = "#1e3a8a";
const URDF_POSE_PICKER_HOVER_OUTLINE_COLOR = "#bae6fd";
const URDF_POSE_PICKER_HOVER_OUTLINE_WIDTH = 3.25;
const URDF_POSE_PICKER_GRID_OPACITY = 0.155;
const URDF_POSE_PICKER_SHELL_RADIUS_SCALE = 0.238;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeUrdfPosePickerCenter(picker) {
  const center = Array.isArray(picker?.center) ? picker.center : [0, 0, 0];
  const point = [Number(center[0]), Number(center[1]), Number(center[2])];
  return point.every(Number.isFinite) ? point : [0, 0, 0];
}

export function resolveUrdfPosePickerCenterWorld(runtime, picker) {
  if (!runtime?.THREE || !runtime?.modelGroup) {
    return null;
  }
  const { THREE } = runtime;
  runtime.modelGroup.updateMatrixWorld(true);
  const target = runtime.controls?.target;
  if (
    target &&
    Number.isFinite(target.x) &&
    Number.isFinite(target.y) &&
    Number.isFinite(target.z)
  ) {
    return target.clone();
  }
  const centerLocal = normalizeUrdfPosePickerCenter(picker);
  const centerWorld = new THREE.Vector3(...centerLocal);
  runtime.modelGroup.localToWorld(centerWorld);
  return centerWorld;
}

export function resolveUrdfPosePickerShell(runtime, picker) {
  if (!runtime?.THREE || !runtime?.camera || !runtime?.modelGroup) {
    return null;
  }
  const centerWorld = resolveUrdfPosePickerCenterWorld(runtime, picker);
  if (!centerWorld) {
    return null;
  }
  const centerLocalVector = runtime.modelGroup.worldToLocal(centerWorld.clone());
  const centerLocal = [centerLocalVector.x, centerLocalVector.y, centerLocalVector.z];
  const cameraDistance = runtime.camera.position.distanceTo(centerWorld);
  const modelRadius = Math.max(Number(runtime.modelRadius || 0), 0.08);
  const minRadius = Math.max(modelRadius * 0.12, 0.025);
  const maxRadius = Math.max(modelRadius * 3.2, minRadius * 3);
  const clampedRadius = clamp(cameraDistance * URDF_POSE_PICKER_SHELL_RADIUS_SCALE, minRadius, maxRadius);
  const radius = cameraDistance > 1e-4 ? Math.min(clampedRadius, cameraDistance * 0.92) : clampedRadius;
  return {
    centerLocal,
    centerWorld,
    radius
  };
}

export function intersectUrdfPosePickerShell(runtime, picker, ray = runtime?.raycaster?.ray) {
  if (!runtime?.THREE || !runtime?.modelGroup || !ray) {
    return null;
  }
  const shell = resolveUrdfPosePickerShell(runtime, picker);
  if (!shell) {
    return null;
  }
  const { THREE } = runtime;
  const hitPoint = new THREE.Vector3();
  const sphere = new THREE.Sphere(shell.centerWorld, shell.radius);
  if (!ray.intersectSphere(sphere, hitPoint)) {
    return null;
  }
  const modelPoint = runtime.modelGroup.worldToLocal(hitPoint.clone());
  return {
    point: [modelPoint.x, modelPoint.y, modelPoint.z],
    source: "sphere"
  };
}

export function intersectUrdfPosePickerShellAtNdc(runtime, picker, ndc) {
  if (!runtime?.THREE || !runtime?.camera || !ndc) {
    return null;
  }
  const { THREE } = runtime;
  const cameraPosition = new THREE.Vector3();
  runtime.camera.getWorldPosition(cameraPosition);
  const worldPoint = new THREE.Vector3(Number(ndc.x) || 0, Number(ndc.y) || 0, 0.5).unproject(runtime.camera);
  const direction = worldPoint.sub(cameraPosition).normalize();
  return intersectUrdfPosePickerShell(runtime, picker, new THREE.Ray(cameraPosition, direction));
}

export function urdfPosePickerCellKey(cell) {
  return cell ? `${cell.x}:${cell.y}` : "";
}

export function isValidUrdfPosePickerCell(cell) {
  return (
    cell &&
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.x < URDF_POSE_PICKER_SHELL_WIDTH_SEGMENTS &&
    cell.y >= 0 &&
    cell.y < URDF_POSE_PICKER_SHELL_HEIGHT_SEGMENTS
  );
}

export function urdfPosePickerCellForModelPoint(runtime, picker, point) {
  if (!runtime?.THREE || !runtime?.camera || !runtime?.modelGroup || !Array.isArray(point) || point.length < 3) {
    return null;
  }
  const shell = resolveUrdfPosePickerShell(runtime, picker);
  if (!shell) {
    return null;
  }
  const { THREE } = runtime;
  const worldPoint = new THREE.Vector3(Number(point[0]), Number(point[1]), Number(point[2]));
  if (![worldPoint.x, worldPoint.y, worldPoint.z].every(Number.isFinite)) {
    return null;
  }
  runtime.modelGroup.updateMatrixWorld(true);
  runtime.modelGroup.localToWorld(worldPoint);
  const direction = worldPoint.sub(shell.centerWorld);
  if (direction.lengthSq() <= 1e-12) {
    return null;
  }
  direction.normalize();

  let longitude = Math.atan2(direction.z, -direction.x);
  if (longitude < 0) {
    longitude += Math.PI * 2;
  }
  const latitude = Math.acos(clamp(direction.y, -1, 1));
  const u = clamp(longitude / (Math.PI * 2), 0, 0.999999);
  const v = clamp(latitude / Math.PI, 0, 0.999999);
  return {
    x: Math.floor(u * URDF_POSE_PICKER_SHELL_WIDTH_SEGMENTS),
    y: Math.floor(v * URDF_POSE_PICKER_SHELL_HEIGHT_SEGMENTS)
  };
}

export function resolveUrdfPosePickerHoverCell(runtime, picker) {
  const pick = intersectUrdfPosePickerShellAtNdc(runtime, picker, runtime?.urdfPosePickerPointerNdc);
  if (pick?.point) {
    return urdfPosePickerCellForModelPoint(runtime, picker, pick.point);
  }
  return null;
}

export function urdfPosePickerSphereDirection(THREE, u, v) {
  const longitude = u * Math.PI * 2;
  const latitude = v * Math.PI;
  const horizontal = Math.sin(latitude);
  return new THREE.Vector3(
    -Math.cos(longitude) * horizontal,
    Math.cos(latitude),
    Math.sin(longitude) * horizontal
  );
}

export function urdfPosePickerCellCornerDirection(THREE, cell, xOffset, yOffset) {
  return urdfPosePickerSphereDirection(
    THREE,
    (cell.x + xOffset) / URDF_POSE_PICKER_SHELL_WIDTH_SEGMENTS,
    (cell.y + yOffset) / URDF_POSE_PICKER_SHELL_HEIGHT_SEGMENTS
  );
}

export function createUrdfPosePickerShellGridGeometry(THREE) {
  const positions = [];
  const pushPoint = (point) => {
    positions.push(point.x, point.y, point.z);
  };
  for (let y = 1; y < URDF_POSE_PICKER_SHELL_HEIGHT_SEGMENTS; y += 1) {
    const v = y / URDF_POSE_PICKER_SHELL_HEIGHT_SEGMENTS;
    for (let x = 0; x < URDF_POSE_PICKER_SHELL_WIDTH_SEGMENTS; x += 1) {
      pushPoint(urdfPosePickerSphereDirection(THREE, x / URDF_POSE_PICKER_SHELL_WIDTH_SEGMENTS, v));
      pushPoint(urdfPosePickerSphereDirection(THREE, (x + 1) / URDF_POSE_PICKER_SHELL_WIDTH_SEGMENTS, v));
    }
  }
  for (let x = 0; x < URDF_POSE_PICKER_SHELL_WIDTH_SEGMENTS; x += 1) {
    const u = x / URDF_POSE_PICKER_SHELL_WIDTH_SEGMENTS;
    for (let y = 0; y < URDF_POSE_PICKER_SHELL_HEIGHT_SEGMENTS; y += 1) {
      pushPoint(urdfPosePickerSphereDirection(THREE, u, y / URDF_POSE_PICKER_SHELL_HEIGHT_SEGMENTS));
      pushPoint(urdfPosePickerSphereDirection(THREE, u, (y + 1) / URDF_POSE_PICKER_SHELL_HEIGHT_SEGMENTS));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  return geometry;
}

export function createUrdfPosePickerCellGeometry(runtime, cell) {
  if (!runtime?.THREE || !isValidUrdfPosePickerCell(cell)) {
    return null;
  }
  const { THREE } = runtime;
  const surfaceOffset = 1.0015;
  const corners = [
    urdfPosePickerCellCornerDirection(THREE, cell, 0, 0),
    urdfPosePickerCellCornerDirection(THREE, cell, 1, 0),
    urdfPosePickerCellCornerDirection(THREE, cell, 1, 1),
    urdfPosePickerCellCornerDirection(THREE, cell, 0, 1)
  ].map((direction) => direction.multiplyScalar(surfaceOffset));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        corners[0].x, corners[0].y, corners[0].z,
        corners[1].x, corners[1].y, corners[1].z,
        corners[2].x, corners[2].y, corners[2].z,
        corners[0].x, corners[0].y, corners[0].z,
        corners[2].x, corners[2].y, corners[2].z,
        corners[3].x, corners[3].y, corners[3].z
      ]),
      3
    )
  );
  geometry.computeVertexNormals();
  return geometry;
}

export function createUrdfPosePickerCellOutlinePositions(runtime, cell) {
  if (!runtime?.THREE || !isValidUrdfPosePickerCell(cell)) {
    return null;
  }
  const { THREE } = runtime;
  const surfaceOffset = 1.0045;
  const corners = [
    urdfPosePickerCellCornerDirection(THREE, cell, 0, 0),
    urdfPosePickerCellCornerDirection(THREE, cell, 1, 0),
    urdfPosePickerCellCornerDirection(THREE, cell, 1, 1),
    urdfPosePickerCellCornerDirection(THREE, cell, 0, 1)
  ].map((direction) => direction.multiplyScalar(surfaceOffset));
  return new Float32Array([
    corners[0].x, corners[0].y, corners[0].z,
    corners[1].x, corners[1].y, corners[1].z,
    corners[1].x, corners[1].y, corners[1].z,
    corners[2].x, corners[2].y, corners[2].z,
    corners[2].x, corners[2].y, corners[2].z,
    corners[3].x, corners[3].y, corners[3].z,
    corners[3].x, corners[3].y, corners[3].z,
    corners[0].x, corners[0].y, corners[0].z
  ]);
}

export function createUrdfPosePickerShell(runtime, picker) {
  const shell = resolveUrdfPosePickerShell(runtime, picker);
  if (!runtime?.THREE || !shell) {
    return null;
  }
  const { THREE } = runtime;
  const geometry = createUrdfPosePickerShellGridGeometry(THREE);
  const material = new THREE.LineBasicMaterial({
    color: URDF_POSE_PICKER_MARKER_COLOR,
    transparent: true,
    opacity: URDF_POSE_PICKER_GRID_OPACITY,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const lineSegments = new THREE.LineSegments(geometry, material);
  lineSegments.position.set(...shell.centerLocal);
  lineSegments.scale.setScalar(shell.radius);
  lineSegments.renderOrder = 28;
  lineSegments.frustumCulled = false;
  lineSegments.onBeforeRender = () => {
    const nextShell = resolveUrdfPosePickerShell(runtime, picker);
    if (!nextShell) {
      return;
    }
    lineSegments.position.set(...nextShell.centerLocal);
    lineSegments.scale.setScalar(nextShell.radius);
  };
  lineSegments.userData.disposeGeometry = true;
  lineSegments.userData.disposeMaterial = true;
  return lineSegments;
}

export function createUrdfPosePickerHoverCellMesh(runtime, picker) {
  const shell = resolveUrdfPosePickerShell(runtime, picker);
  const cell = resolveUrdfPosePickerHoverCell(runtime, picker);
  const geometry = createUrdfPosePickerCellGeometry(runtime, cell) || createUrdfPosePickerCellGeometry(runtime, { x: 0, y: 0 });
  if (!runtime?.THREE || !shell || !geometry) {
    return null;
  }
  const { THREE } = runtime;
  const material = new THREE.MeshBasicMaterial({
    color: URDF_POSE_PICKER_HOVER_FILL_COLOR,
    transparent: false,
    opacity: 1,
    side: THREE.DoubleSide,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...shell.centerLocal);
  mesh.scale.setScalar(shell.radius);
  mesh.renderOrder = 80;
  mesh.frustumCulled = false;
  mesh.visible = isValidUrdfPosePickerCell(cell);
  mesh.userData.lastHoverCellKey = urdfPosePickerCellKey(cell);
  runtime.urdfPosePickerHoverCellMesh = mesh;
  mesh.onBeforeRender = () => {
    const nextShell = resolveUrdfPosePickerShell(runtime, picker);
    const nextCell = resolveUrdfPosePickerHoverCell(runtime, picker);
    const nextCellKey = urdfPosePickerCellKey(nextCell);
    mesh.visible = isValidUrdfPosePickerCell(nextCell);
    if (!nextShell || !mesh.visible) {
      return;
    }
    mesh.position.set(...nextShell.centerLocal);
    mesh.scale.setScalar(nextShell.radius);
    if (mesh.userData.lastHoverCellKey !== nextCellKey) {
      const nextGeometry = createUrdfPosePickerCellGeometry(runtime, nextCell);
      if (!nextGeometry) {
        return;
      }
      mesh.geometry?.dispose?.();
      mesh.geometry = nextGeometry;
    }
    mesh.userData.lastHoverCellKey = nextCellKey;
  };
  mesh.userData.disposeGeometry = true;
  mesh.userData.disposeMaterial = true;
  return mesh;
}

export function createUrdfPosePickerHoverCellOutline(runtime, picker) {
  const shell = resolveUrdfPosePickerShell(runtime, picker);
  const cell = resolveUrdfPosePickerHoverCell(runtime, picker);
  const positions =
    createUrdfPosePickerCellOutlinePositions(runtime, cell) ||
    createUrdfPosePickerCellOutlinePositions(runtime, { x: 0, y: 0 });
  if (!runtime?.THREE || !shell || !positions) {
    return null;
  }
  const line = createScreenSpaceLineSegments(runtime, positions, {
    color: URDF_POSE_PICKER_HOVER_OUTLINE_COLOR,
    opacity: 0.98,
    lineWidth: URDF_POSE_PICKER_HOVER_OUTLINE_WIDTH,
    renderOrder: 82,
    depthTest: false,
    depthWrite: false
  });
  if (!line) {
    return null;
  }
  line.position.set(...shell.centerLocal);
  line.scale.setScalar(shell.radius);
  line.visible = isValidUrdfPosePickerCell(cell);
  line.userData.lastHoverCellKey = urdfPosePickerCellKey(cell);
  runtime.urdfPosePickerHoverCellOutline = line;
  line.onBeforeRender = () => {
    const nextShell = resolveUrdfPosePickerShell(runtime, picker);
    const nextCell = resolveUrdfPosePickerHoverCell(runtime, picker);
    const nextCellKey = urdfPosePickerCellKey(nextCell);
    line.visible = isValidUrdfPosePickerCell(nextCell);
    if (!nextShell || !line.visible) {
      return;
    }
    line.position.set(...nextShell.centerLocal);
    line.scale.setScalar(nextShell.radius);
    if (line.userData.lastHoverCellKey !== nextCellKey) {
      const nextPositions = createUrdfPosePickerCellOutlinePositions(runtime, nextCell);
      if (!nextPositions) {
        return;
      }
      line.geometry?.setPositions?.(nextPositions);
      line.geometry?.computeBoundingSphere?.();
    }
    line.userData.lastHoverCellKey = nextCellKey;
  };
  return line;
}

export function syncUrdfPosePickerHoverMesh(runtime, object, picker) {
  if (!runtime?.THREE || !object) {
    return false;
  }
  const shell = resolveUrdfPosePickerShell(runtime, picker);
  const cell = resolveUrdfPosePickerHoverCell(runtime, picker);
  const cellKey = urdfPosePickerCellKey(cell);
  object.visible = isValidUrdfPosePickerCell(cell);
  if (!shell || !object.visible) {
    object.userData.lastHoverCellKey = "";
    return false;
  }
  object.position.set(...shell.centerLocal);
  object.scale.setScalar(shell.radius);
  if (object.userData.lastHoverCellKey === cellKey) {
    return true;
  }
  const nextGeometry = createUrdfPosePickerCellGeometry(runtime, cell);
  if (!nextGeometry) {
    object.visible = false;
    object.userData.lastHoverCellKey = "";
    return false;
  }
  object.geometry?.dispose?.();
  object.geometry = nextGeometry;
  object.userData.lastHoverCellKey = cellKey;
  return true;
}

export function syncUrdfPosePickerHoverOutline(runtime, object, picker) {
  if (!runtime?.THREE || !object) {
    return false;
  }
  const shell = resolveUrdfPosePickerShell(runtime, picker);
  const cell = resolveUrdfPosePickerHoverCell(runtime, picker);
  const cellKey = urdfPosePickerCellKey(cell);
  object.visible = isValidUrdfPosePickerCell(cell);
  if (!shell || !object.visible) {
    object.userData.lastHoverCellKey = "";
    return false;
  }
  object.position.set(...shell.centerLocal);
  object.scale.setScalar(shell.radius);
  if (object.userData.lastHoverCellKey === cellKey) {
    return true;
  }
  const nextPositions = createUrdfPosePickerCellOutlinePositions(runtime, cell);
  if (!nextPositions) {
    object.visible = false;
    object.userData.lastHoverCellKey = "";
    return false;
  }
  object.geometry?.setPositions?.(nextPositions);
  object.geometry?.computeBoundingSphere?.();
  object.userData.lastHoverCellKey = cellKey;
  return true;
}

export function syncUrdfPosePickerHoverObjects(runtime, picker) {
  const meshVisible = syncUrdfPosePickerHoverMesh(
    runtime,
    runtime?.urdfPosePickerHoverCellMesh,
    picker
  );
  const outlineVisible = syncUrdfPosePickerHoverOutline(
    runtime,
    runtime?.urdfPosePickerHoverCellOutline,
    picker
  );
  return meshVisible || outlineVisible;
}
