import { DESKTOP_PET_SIZE } from '../../shared/desktopPet/constants';

// Alpha bounds of the unchanged 512px first-release cells, including feather fringes.
const ORIGINAL_BOUNDS = [
  [104, 38, 417, 487],
  [89, 28, 436, 488],
  [101, 43, 414, 489],
  [33, 22, 511, 454],
  [0, 12, 423, 454],
  [78, 12, 483, 455],
];

/** Fit only when a transformed pose would clip; neutral stays at original size. */
export function originalPoseGeometry(
  index: number,
  stretch: number,
  facing: number,
  angle: number,
  x: number,
  y: number,
) {
  const bounds = ORIGINAL_BOUNDS[index] ?? ORIGINAL_BOUNDS[0];
  const unit = DESKTOP_PET_SIZE / 512;
  const points = [bounds[0], bounds[2]].flatMap(px =>
    [bounds[1], bounds[3]].map(py => {
      const dx = ((px * unit - DESKTOP_PET_SIZE / 2) * facing) / Math.sqrt(stretch);
      const dy = (py * unit - DESKTOP_PET_SIZE) * stretch;
      return {
        x: dx * Math.cos(angle) - dy * Math.sin(angle),
        y: dx * Math.sin(angle) + dy * Math.cos(angle),
      };
    }),
  );
  const minX = Math.min(...points.map(p => p.x)),
    maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y)),
    maxY = Math.max(...points.map(p => p.y));
  const margin = 2;
  const span = DESKTOP_PET_SIZE - margin * 2;
  const scale = Math.min(1, span / (maxX - minX), span / (maxY - minY));
  return {
    scale,
    x: Math.max(
      margin - minX * scale,
      Math.min(DESKTOP_PET_SIZE - margin - maxX * scale, DESKTOP_PET_SIZE / 2 + x),
    ),
    y: Math.max(
      margin - minY * scale,
      Math.min(DESKTOP_PET_SIZE - margin - maxY * scale, DESKTOP_PET_SIZE + y),
    ),
  };
}
