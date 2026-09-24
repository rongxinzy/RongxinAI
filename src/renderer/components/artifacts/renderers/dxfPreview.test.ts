import { expect, test } from 'vitest';

import { dxfPreviewToSvg, parseDxfPreview } from './dxfPreview';

const SAMPLE_DXF = `0
SECTION
2
ENTITIES
0
LINE
10
0
20
0
11
10
21
0
0
CIRCLE
10
5
20
5
40
2
0
LWPOLYLINE
70
1
10
0
20
0
10
4
20
0
10
4
20
3
10
0
20
3
0
ENDSEC
0
EOF
`;

test('parses common DXF drawing entities', () => {
  const model = parseDxfPreview(SAMPLE_DXF);
  expect(model.segments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'line' }),
      expect.objectContaining({ kind: 'circle' }),
      expect.objectContaining({ kind: 'polyline', closed: true }),
    ]),
  );
  expect(model.bounds).toMatchObject({
    minX: 0,
    minY: 0,
    maxX: 10,
    maxY: 7,
  });
});

test('renders a DXF preview as an SVG document', () => {
  const svg = dxfPreviewToSvg(parseDxfPreview(SAMPLE_DXF));
  expect(svg).toContain('<svg');
  expect(svg).toContain('<line');
  expect(svg).toContain('<circle');
  expect(svg).toContain('<path');
});
