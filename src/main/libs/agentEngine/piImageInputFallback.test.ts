import { describe, expect, test, beforeEach } from 'vitest';

import { ModelCapabilityStatus, type ModelCapabilities } from '../../../shared/providers';
import {
  buildImageOmittedNotice,
  clearImageInputObservations,
  imageCapabilityFingerprint,
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
});

describe('buildImageOmittedNotice', () => {
  test('lists every persisted path, says the image was not sent, and steers away from tool spelunking', () => {
    const notice = buildImageOmittedNotice([
      { name: 'a.png', path: 'C:\\images\\a.png' },
      { name: 'b.png', path: 'C:\\images\\b.png' },
    ]);
    expect(notice).toContain('not sent');
    expect(notice).toContain('cannot read images');
    expect(notice).toContain('C:\\images\\a.png');
    expect(notice).toContain('C:\\images\\b.png');
    // Tell the user, then either write a system-OCR script or ask for the text.
    expect(notice).toContain('tell the user plainly');
    expect(notice).toMatch(/ask the user to paste/i);
    // The known dead ends (probing for installed OCR tools, retrying the same
    // command) cost several turns in the field, so the note rules them out.
    expect(notice).toMatch(/do not search the machine/i);
    expect(notice).toMatch(/Windows\.Media\.Ocr/);
  });

  test('omits the path list when no persisted path is known', () => {
    const notice = buildImageOmittedNotice([{ name: 'pasted.png' }]);
    expect(notice).toContain('not sent');
    expect(notice).not.toContain('at:\n');
  });

  test('returns an empty string without attachments', () => {
    expect(buildImageOmittedNotice([])).toBe('');
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
