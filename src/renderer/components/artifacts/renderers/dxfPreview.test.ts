// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';

import { dxfPreviewToSvg, parseDxfPreview, sanitizeDxfSvg } from './dxfPreview';

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

describe('dxfPreview', () => {
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

  test('sanitizes SVG output and strips malicious script tags or attributes', () => {
    const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" onload="alert('xss')" />
      <script>alert(document.domain)</script>
      <a href="javascript:alert(1)"><line x1="0" y1="0" x2="100" y2="100" /></a>
    </svg>`;

    const cleaned = sanitizeDxfSvg(maliciousSvg);
    expect(cleaned).toContain('<svg');
    expect(cleaned).toContain('<circle');
    expect(cleaned).not.toContain('<script>');
    expect(cleaned).not.toContain('alert(document.domain)');
    expect(cleaned).not.toContain('onload=');
    expect(cleaned).not.toContain('javascript:');
  });

  test('preserves valid SVG geometry elements after sanitization', () => {
    const rawSvg = dxfPreviewToSvg(parseDxfPreview(SAMPLE_DXF));
    expect(rawSvg).not.toBeNull();
    const sanitized = sanitizeDxfSvg(rawSvg!);
    expect(sanitized).toContain('<svg');
    expect(sanitized).toContain('<line');
    expect(sanitized).toContain('<circle');
    expect(sanitized).toContain('<path');
  });
});
