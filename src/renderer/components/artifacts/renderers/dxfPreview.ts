/**
 * Minimal DXF geometry extraction for in-app preview.
 * Covers the common text-to-cad / drafting entities: LINE, CIRCLE, ARC, LWPOLYLINE.
 */

export type DxfPoint = { x: number; y: number };

export type DxfSegment =
  | { kind: 'line'; from: DxfPoint; to: DxfPoint }
  | { kind: 'circle'; center: DxfPoint; radius: number }
  | { kind: 'arc'; center: DxfPoint; radius: number; startDeg: number; endDeg: number }
  | { kind: 'polyline'; points: DxfPoint[]; closed: boolean };

export type DxfPreviewModel = {
  segments: DxfSegment[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
};

type DxfGroup = { code: number; value: string };

function parseGroups(text: string): DxfGroup[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const groups: DxfGroup[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) continue;
    groups.push({ code, value: lines[i + 1] ?? '' });
  }
  return groups;
}

function readNumber(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function expandBounds(
  bounds: DxfPreviewModel['bounds'],
  x: number,
  y: number,
): NonNullable<DxfPreviewModel['bounds']> {
  if (!bounds) return { minX: x, minY: y, maxX: x, maxY: y };
  return {
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  };
}

function includePoint(
  bounds: DxfPreviewModel['bounds'],
  point: DxfPoint,
): NonNullable<DxfPreviewModel['bounds']> {
  return expandBounds(bounds, point.x, point.y);
}

function includeCircle(
  bounds: DxfPreviewModel['bounds'],
  center: DxfPoint,
  radius: number,
): NonNullable<DxfPreviewModel['bounds']> {
  return expandBounds(
    expandBounds(bounds, center.x - radius, center.y - radius),
    center.x + radius,
    center.y + radius,
  );
}

function groupsToEntityMap(groups: DxfGroup[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const group of groups) {
    const values = map.get(group.code);
    if (values) values.push(group.value);
    else map.set(group.code, [group.value]);
  }
  return map;
}

function firstNumber(map: Map<number, string[]>, code: number, fallback = 0): number {
  const value = map.get(code)?.[0];
  return value === undefined ? fallback : readNumber(value);
}

function pairNumbers(xs: string[] | undefined, ys: string[] | undefined): DxfPoint[] {
  if (!xs || !ys) return [];
  const count = Math.min(xs.length, ys.length);
  const points: DxfPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({ x: readNumber(xs[i]), y: readNumber(ys[i]) });
  }
  return points;
}

export function parseDxfPreview(text: string): DxfPreviewModel {
  const groups = parseGroups(text);
  const segments: DxfSegment[] = [];
  let bounds: DxfPreviewModel['bounds'] = null;

  let index = 0;
  while (index < groups.length) {
    const group = groups[index];
    if (group.code !== 0) {
      index += 1;
      continue;
    }

    const entityType = group.value.trim().toUpperCase();
    index += 1;
    const entityGroups: DxfGroup[] = [];
    while (index < groups.length && groups[index].code !== 0) {
      entityGroups.push(groups[index]);
      index += 1;
    }

    const map = groupsToEntityMap(entityGroups);
    switch (entityType) {
      case 'LINE': {
        const from = { x: firstNumber(map, 10), y: firstNumber(map, 20) };
        const to = { x: firstNumber(map, 11), y: firstNumber(map, 21) };
        segments.push({ kind: 'line', from, to });
        bounds = includePoint(includePoint(bounds, from), to);
        break;
      }
      case 'CIRCLE': {
        const center = { x: firstNumber(map, 10), y: firstNumber(map, 20) };
        const radius = Math.abs(firstNumber(map, 40));
        segments.push({ kind: 'circle', center, radius });
        bounds = includeCircle(bounds, center, radius);
        break;
      }
      case 'ARC': {
        const center = { x: firstNumber(map, 10), y: firstNumber(map, 20) };
        const radius = Math.abs(firstNumber(map, 40));
        const startDeg = firstNumber(map, 50);
        const endDeg = firstNumber(map, 51);
        segments.push({ kind: 'arc', center, radius, startDeg, endDeg });
        bounds = includeCircle(bounds, center, radius);
        break;
      }
      case 'LWPOLYLINE': {
        const points = pairNumbers(map.get(10), map.get(20));
        if (points.length === 0) break;
        const closed = (firstNumber(map, 70) & 1) === 1;
        segments.push({ kind: 'polyline', points, closed });
        for (const point of points) bounds = includePoint(bounds, point);
        break;
      }
      default:
        break;
    }
  }

  return { segments, bounds };
}

function polar(center: DxfPoint, radius: number, deg: number): DxfPoint {
  const rad = (deg * Math.PI) / 180;
  return { x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) };
}

function arcPath(center: DxfPoint, radius: number, startDeg: number, endDeg: number): string {
  let sweep = endDeg - startDeg;
  while (sweep <= 0) sweep += 360;
  while (sweep > 360) sweep -= 360;
  const largeArc = sweep > 180 ? 1 : 0;
  const start = polar(center, radius, startDeg);
  const end = polar(center, radius, endDeg);
  // SVG y-axis is flipped later via viewBox transform; keep CAD angles as-is.
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export function dxfPreviewToSvg(model: DxfPreviewModel, padding = 16): string | null {
  if (!model.bounds || model.segments.length === 0) return null;

  const width = Math.max(model.bounds.maxX - model.bounds.minX, 1);
  const height = Math.max(model.bounds.maxY - model.bounds.minY, 1);
  const viewMinX = model.bounds.minX - padding;
  const viewMinY = model.bounds.minY - padding;
  const viewWidth = width + padding * 2;
  const viewHeight = height + padding * 2;

  const parts: string[] = [];
  for (const segment of model.segments) {
    switch (segment.kind) {
      case 'line':
        parts.push(
          `<line x1="${segment.from.x}" y1="${segment.from.y}" x2="${segment.to.x}" y2="${segment.to.y}" />`,
        );
        break;
      case 'circle':
        parts.push(
          `<circle cx="${segment.center.x}" cy="${segment.center.y}" r="${segment.radius}" />`,
        );
        break;
      case 'arc':
        parts.push(
          `<path d="${arcPath(segment.center, segment.radius, segment.startDeg, segment.endDeg)}" />`,
        );
        break;
      case 'polyline': {
        if (segment.points.length === 0) break;
        const [first, ...rest] = segment.points;
        const d = [
          `M ${first.x} ${first.y}`,
          ...rest.map(point => `L ${point.x} ${point.y}`),
          segment.closed ? 'Z' : '',
        ]
          .filter(Boolean)
          .join(' ');
        parts.push(`<path d="${d}" />`);
        break;
      }
      default:
        break;
    }
  }

  // Flip Y so CAD coordinates (Y up) match SVG (Y down).
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewMinX} ${viewMinY} ${viewWidth} ${viewHeight}" preserveAspectRatio="xMidYMid meet">`,
    `<g fill="none" stroke="currentColor" stroke-width="${Math.max(width, height) / 400}" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 ${viewMinY * 2 + viewHeight}) scale(1 -1)">`,
    ...parts,
    '</g>',
    '</svg>',
  ].join('');
}
