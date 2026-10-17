import JSZip from 'jszip';
import { expect, test } from 'vitest';

import { parsePptxSlides } from './pptxTextExtraction';

async function buildPptx(files: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
}

test('parsePptxSlides extracts slide texts in numeric order', async () => {
  const data = await buildPptx({
    'ppt/slides/slide1.xml': '<sld><a:t>Hello</a:t><a:t> </a:t><a:t>World</a:t></sld>',
    'ppt/slides/slide2.xml': '<sld><a:t>Two</a:t></sld>',
    'ppt/slides/slide10.xml': '<sld><a:t>Ten</a:t></sld>',
    'ppt/notesSlides/notesSlide1.xml': '<a:t>Ignored</a:t>',
    'other/file.xml': '<a:t>Ignored</a:t>',
  });

  const slides = await parsePptxSlides(data);

  expect(slides.map(slide => slide.index)).toEqual([1, 2, 3]);
  expect(slides[0].texts).toEqual(['Hello', 'World']);
  expect(slides[1].texts).toEqual(['Two']);
  expect(slides[2].texts).toEqual(['Ten']);
});

test('parsePptxSlides returns an empty text list for slides without text', async () => {
  const data = await buildPptx({
    'ppt/slides/slide1.xml': '<sld/>',
    'ppt/slides/slide2.xml': '<sld><a:t>   </a:t></sld>',
  });

  const slides = await parsePptxSlides(data);

  expect(slides).toEqual([
    { index: 1, texts: [] },
    { index: 2, texts: [] },
  ]);
});

test('parsePptxSlides returns nothing for archives without slides', async () => {
  const data = await buildPptx({ '[Content_Types].xml': '<Types/>' });

  await expect(parsePptxSlides(data)).resolves.toEqual([]);
});
