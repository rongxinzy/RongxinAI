import { describe, expect, test } from 'vitest';
import { ModelCapabilityStatus } from '../../../shared/providers';
import {
  buildImageOmittedNotice,
  collectImagePathReferences,
  imageInputVerdict,
  ImageInputVerdict,
} from './piImageInputFallback';

test.each([
  [ModelCapabilityStatus.Supported, ImageInputVerdict.Supported],
  [ModelCapabilityStatus.Unsupported, ImageInputVerdict.Unsupported],
  [ModelCapabilityStatus.Unknown, ImageInputVerdict.Unknown],
  [undefined, ImageInputVerdict.Unknown],
] as const)('uses the configured capability %s', (status, verdict) => {
  expect(imageInputVerdict(status)).toBe(verdict);
});

describe('buildImageOmittedNotice', () => {
  const references = [
    { name: 'a.png', path: 'C:\\images\\a.png' },
    { name: 'b.png', path: 'C:\\images\\b.png' },
  ];

  test('lists every persisted path and offers the bundled helper', () => {
    const notice = buildImageOmittedNotice(references, {
      verdict: ImageInputVerdict.Unsupported,
      ocrCommandFor: path => `powershell -File "C:\\app\\ocr\\ocr-image.ps1" -Path "${path}"`,
    });
    expect(notice).toContain('not sent');
    expect(notice).toContain('cannot read images');
    expect(notice).toContain('C:\\images\\a.png');
    expect(notice).toContain('C:\\images\\b.png');
    expect(notice).toContain('ocr-image.ps1" -Path "C:\\images\\a.png"');
    // Offered, not enforced: extraction returns text only and the user can be
    // asked for whatever the text does not cover.
    expect(notice).toMatch(/text only/i);
    expect(notice).toMatch(/ask the user/i);
    expect(notice).not.toMatch(/run the bundled OCR helper first/i);
  });

  test('states the actual reason instead of guessing capability', () => {
    const reason = (verdict: ImageInputVerdict): string =>
      buildImageOmittedNotice([{ name: 'a.png', path: 'C:\\images\\a.png' }], { verdict });
    expect(reason(ImageInputVerdict.Unsupported)).toContain('cannot read images');
    // An unconfigured model is not a confirmed text-only model.
    expect(reason(ImageInputVerdict.Unknown)).toMatch(/not confirmed/i);
    expect(reason(ImageInputVerdict.Unknown)).not.toContain('cannot read images');
    // Bytes that could not be attached are not a capability problem either.
    const supported = reason(ImageInputVerdict.Supported);
    expect(supported).toMatch(/bytes could not be attached/i);
    expect(supported).not.toContain('cannot read images');
  });

  test('falls back to asking the user when no helper resolves', () => {
    const notice = buildImageOmittedNotice([{ name: 'a.png', path: 'C:\\images\\a.png' }], {
      verdict: ImageInputVerdict.Unsupported,
    });
    expect(notice).toMatch(/ask the user to paste or describe/i);
    expect(notice).not.toContain('ocr-image.ps1');
  });

  test('omits the path list when no persisted path is known', () => {
    const notice = buildImageOmittedNotice([{ name: 'pasted.png' }], {
      verdict: ImageInputVerdict.Unsupported,
    });
    expect(notice).toContain('not sent');
    expect(notice).not.toContain('at:\n');
  });

  test('returns an empty string without attachments', () => {
    expect(buildImageOmittedNotice([])).toBe('');
  });
});

describe('collectImagePathReferences', () => {
  test('keeps flagged images and image extensions, drops everything else', () => {
    expect(
      collectImagePathReferences([
        { name: 'shot.png', path: 'C:\\a\\shot.png' },
        { name: 'scan', path: 'C:\\a\\scan.JPEG' },
        { name: 'clip.png', path: 'inline:pasted', isImage: true },
        { name: 'notes.txt', path: 'C:\\a\\notes.txt' },
        { name: 'mystery', path: 'C:\\a\\mystery' },
        { name: 'ref.bin', path: 'C:\\a\\ref.bin', isImage: true },
        { name: 'noPath.png' },
      ]),
    ).toEqual([
      { name: 'shot.png', path: 'C:\\a\\shot.png' },
      { name: 'scan', path: 'C:\\a\\scan.JPEG' },
      { name: 'ref.bin', path: 'C:\\a\\ref.bin' },
    ]);
  });

  test('returns nothing for missing attachment lists', () => {
    expect(collectImagePathReferences(undefined)).toEqual([]);
    expect(collectImagePathReferences([])).toEqual([]);
  });
});
