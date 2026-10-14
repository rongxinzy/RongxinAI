import { describe, expect, test, beforeEach } from 'vitest';

import { ModelCapabilityStatus, type ModelCapabilities } from '../../../shared/providers';
import {
  buildImageOmittedNotice,
  clearImageInputObservations,
  collectImagePathReferences,
  isImageCapabilityError,
  imageCapabilityFingerprint,
  ImageInputVerdict,
  imageInputVerdict,
  isImageInputRejected,
  isImagePayloadRejection,
  markImageInputRejected,
  shouldSendImageInput,
} from './piImageInputFallback';

const capabilities = (imageInput: ModelCapabilityStatus): ModelCapabilities => ({
  toolCalling: ModelCapabilityStatus.Unknown,
  imageInput,
  videoInput: ModelCapabilityStatus.Unknown,
  audioInput: ModelCapabilityStatus.Unknown,
  documentInput: ModelCapabilityStatus.Unknown,
  reasoning: ModelCapabilityStatus.Unknown,
});

beforeEach(() => {
  clearImageInputObservations();
});

describe('shouldSendImageInput', () => {
  test('sends only when the model is confirmed image-capable', () => {
    expect(
      shouldSendImageInput(capabilities(ModelCapabilityStatus.Supported), 'openai', 'gpt-5.6', {
        imageInput: ModelCapabilityStatus.Supported,
      }),
    ).toBe(true);
    expect(
      shouldSendImageInput(capabilities(ModelCapabilityStatus.Unsupported), 'openai', 'gpt-5.6', {
        imageInput: ModelCapabilityStatus.Unsupported,
      }),
    ).toBe(false);
    // Unknown is a "no verdict" residue: shipping bytes costs a failed turn,
    // omitting them costs only a note, so unknown must not send.
    expect(
      shouldSendImageInput(capabilities(ModelCapabilityStatus.Unknown), 'openai', 'gpt-5.6', {
        imageInput: ModelCapabilityStatus.Unknown,
      }),
    ).toBe(false);
  });

  test('stops sending after a rejection observation, until the verdict changes', () => {
    const provider = 'custom_0';
    const model = 'GLM-5.3-Flash';
    const configured = { imageInput: ModelCapabilityStatus.Supported };
    const fingerprint = imageCapabilityFingerprint(configured);

    expect(
      shouldSendImageInput(
        capabilities(ModelCapabilityStatus.Supported),
        provider,
        model,
        configured,
      ),
    ).toBe(true);

    markImageInputRejected(provider, model, fingerprint);
    expect(isImageInputRejected(provider, model, fingerprint)).toBe(true);
    expect(
      shouldSendImageInput(
        capabilities(ModelCapabilityStatus.Supported),
        provider,
        model,
        configured,
      ),
    ).toBe(false);

    // The user re-marking the model (verdict changed) invalidates the observation.
    const changed = { imageInput: ModelCapabilityStatus.Unsupported };
    expect(
      shouldSendImageInput(capabilities(ModelCapabilityStatus.Supported), provider, model, changed),
    ).toBe(true);
  });

  test('keys observations per provider and model, case-insensitively on the model id', () => {
    markImageInputRejected('custom_0', 'GLM-5.3-Flash', 'x');
    expect(isImageInputRejected('custom_0', 'glm-5.3-flash', 'x')).toBe(true);
    expect(isImageInputRejected('custom_1', 'GLM-5.3-Flash', 'x')).toBe(false);
    expect(isImageInputRejected('custom_0', 'other-model', 'x')).toBe(false);
  });
  test('scopes a rejection to the endpoint and configuration that produced it', () => {
    const configuration = {
      supportsImage: true,
      imageInput: ModelCapabilityStatus.Supported,
      endpointKey: 'https://a.example/v1',
    };
    markImageInputRejected('custom_0', 'glm-4v', imageCapabilityFingerprint(configuration));
    expect(
      imageInputVerdict(ModelCapabilityStatus.Supported, 'custom_0', 'glm-4v', configuration),
    ).toBe(ImageInputVerdict.Rejected);
    // A different endpoint for the same model is a different server.
    expect(
      imageInputVerdict(ModelCapabilityStatus.Supported, 'custom_0', 'glm-4v', {
        ...configuration,
        endpointKey: 'https://b.example/v1',
      }),
    ).toBe(ImageInputVerdict.Supported);
    // A widened config edit invalidates it as well.
    expect(
      imageInputVerdict(ModelCapabilityStatus.Unsupported, 'custom_0', 'glm-4v', {
        ...configuration,
        imageInput: ModelCapabilityStatus.Unsupported,
      }),
    ).toBe(ImageInputVerdict.Unsupported);
    // And the settings screen's own escape hatch clears it.
    clearImageInputObservations();
    expect(
      imageInputVerdict(ModelCapabilityStatus.Supported, 'custom_0', 'glm-4v', configuration),
    ).toBe(ImageInputVerdict.Supported);
  });
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
    expect(reason(ImageInputVerdict.Rejected)).toMatch(/rejected an image request/i);
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

describe('isImagePayloadRejection', () => {
  test('treats a 400-class rejection that mentions images as a capability rejection', () => {
    const gatewayError =
      '400: {"message":"this server was started without the vision encoder (run setup again and choose \'vision\'), so it cannot read images"}';
    expect(isImagePayloadRejection(gatewayError, true)).toBe(true);
    expect(
      isImagePayloadRejection('invalid_request_error: image input is not supported', true),
    ).toBe(true);
    // Images in flight are what makes the rejection about images.
    expect(isImagePayloadRejection(gatewayError, false)).toBe(false);
  });

  test('ignores failures that are not about images', () => {
    expect(isImagePayloadRejection('502 Bad Gateway', true)).toBe(false);
    expect(isImagePayloadRejection('500 internal server error', true)).toBe(false);
    // A 400 with no image hint must not disable the model's image input.
    expect(isImagePayloadRejection('400 invalid_request_error: too many tokens', true)).toBe(false);
    expect(
      isImagePayloadRejection('400 invalid_request_error: audio input is not supported', true),
    ).toBe(false);
  });
});

describe('isImageCapabilityError wording boundaries', () => {
  test('separates a refused format or payload from a missing capability', () => {
    // A refused container says nothing about the model's vision in general.
    expect(isImageCapabilityError('400 this model does not support image format image/webp')).toBe(
      false,
    );
    expect(isImageCapabilityError('400 invalid image data')).toBe(false);
    expect(isImageCapabilityError('400 image too large')).toBe(false);
    // Real capability wording still counts.
    expect(
      isImageCapabilityError(
        "400 this server was started without the vision encoder (run setup again and choose 'vision'), so it cannot read images",
      ),
    ).toBe(true);
    expect(isImageCapabilityError('400 image input is not supported - hint: mmproj')).toBe(true);
  });
});

describe('isImagePayloadRejection wording boundaries', () => {
  test('keeps capability wording and drops payload errors', () => {
    // Real capability rejections (llama.cpp without the vision encoder, hints).
    expect(
      isImagePayloadRejection(
        '400: {"message":"this server was started without the vision encoder (run setup again and choose \'vision\'), so it cannot read images"}',
        true,
      ),
    ).toBe(true);
    expect(
      isImagePayloadRejection(
        '400 {"message":"image input is not supported - hint: the mmproj file is missing"}',
        true,
      ),
    ).toBe(true);
    expect(isImagePayloadRejection('400 当前模型不支持图片输入', true)).toBe(true);

    // Payload problems are input errors, not capability verdicts.
    expect(isImagePayloadRejection('400 invalid_request_error: invalid image data', true)).toBe(
      false,
    );
    expect(isImagePayloadRejection('400 image too large: exceeds 20MB limit', true)).toBe(false);
    expect(isImagePayloadRejection('400 failed to decode image', true)).toBe(false);

    // Unrelated 400s stay unrelated.
    expect(isImagePayloadRejection('400 too many tokens in request', true)).toBe(false);
    // The turn must actually have carried images.
    expect(
      isImagePayloadRejection('400 this server was started without the vision encoder', false),
    ).toBe(false);
  });
});
