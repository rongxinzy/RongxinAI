import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { expect, test } from 'vitest';

import { materializeParagraphDefaultRunProperties } from './pptxDataNormalizer';

const DRAWINGML_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function normalize(xml: string): Document {
  const parser = new DOMParser();
  const serializer = new XMLSerializer();
  const result = materializeParagraphDefaultRunProperties(xml, parser, serializer);
  expect(result.changed).toBe(true);
  return parser.parseFromString(result.xml, 'application/xml') as unknown as Document;
}

test('materializes paragraph default text properties onto runs', () => {
  const document = normalize(`
    <a:txBody xmlns:a="${DRAWINGML_NAMESPACE}">
      <a:p>
        <a:pPr><a:defRPr sz="7200" b="1"><a:solidFill><a:srgbClr val="C9A84F"/></a:solidFill></a:defRPr></a:pPr>
        <a:r><a:t>Title</a:t></a:r>
      </a:p>
    </a:txBody>
  `);

  const runProperties = document.getElementsByTagNameNS(DRAWINGML_NAMESPACE, 'rPr')[0];
  expect(runProperties.getAttribute('sz')).toBe('7200');
  expect(runProperties.getAttribute('b')).toBe('1');
  expect(
    runProperties.getElementsByTagNameNS(DRAWINGML_NAMESPACE, 'srgbClr')[0].getAttribute('val'),
  ).toBe('C9A84F');
});

test('keeps explicit run formatting ahead of paragraph defaults', () => {
  const document = normalize(`
    <a:txBody xmlns:a="${DRAWINGML_NAMESPACE}">
      <a:p>
        <a:pPr><a:defRPr sz="2800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr>
        <a:r><a:rPr b="1"><a:solidFill><a:srgbClr val="C9A84F"/></a:solidFill></a:rPr><a:t>Label</a:t></a:r>
      </a:p>
    </a:txBody>
  `);

  const runProperties = document.getElementsByTagNameNS(DRAWINGML_NAMESPACE, 'rPr')[0];
  expect(runProperties.getAttribute('sz')).toBe('2800');
  expect(runProperties.getAttribute('b')).toBe('1');
  expect(
    runProperties.getElementsByTagNameNS(DRAWINGML_NAMESPACE, 'srgbClr')[0].getAttribute('val'),
  ).toBe('C9A84F');
});
