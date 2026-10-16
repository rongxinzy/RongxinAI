/**
 * Runtime image-input fallback.
 *
 * Cowork sends composer images as message attachments, so a model that cannot
 * read images shows up in two shapes:
 *
 * 1. The configured capability says "unsupported" (or is unknown): Pi must not
 *    receive image bytes. The model still needs to know what it is missing and
 *    where the file lives on this machine — otherwise the turn silently degrades
 *    into "I cannot see the image" with no path to recover from.
 * 2. The configured capability says "supported" but the provider/server
 *    rejects the payload (e.g. llama.cpp started without a vision encoder):
 *    the turn fails, and every following image turn fails the same way.
 *
 * Pi's own behavior is the reference for (1): the non-vision verdict turns into
 * an in-band note instead of a failed request. For (2) Pi has nothing, so this
 * module keeps the rejection as a *runtime observation* (never rewriting the
 * user's capability configuration) and reports it so the harness can strip the
 * images and retry the same turn as text.
 */

import { ModelCapabilityStatus, type ModelCapabilities } from '../../../shared/providers';

export interface ImageInputAttachmentRef {
  name: string;
  /** Absolute path of the persisted copy; absent when the bytes never landed. */
  path?: string;
}

export interface ImagePromptPreparation {
  hasImages: boolean;
  sentImages: ImageInputAttachmentRef[];
  omittedImages: ImageInputAttachmentRef[];
}

interface ImageInputObservation {
  /** Verdict of the user's configuration when the rejection was observed. */
  fingerprint: string;
}

const observations = new Map<string, ImageInputObservation>();

const observationKey = (providerName: string, modelId: string): string =>
  `${providerName.trim()}::${modelId.trim().toLowerCase()}`;

/**
 * Effective image-input verdict for one model.
 *
 * `Rejected` is a runtime observation (the provider refused a payload that
 * carried images); the other three come from configuration and provider
 * metadata. Callers must not conflate `Unknown` with a confirmed incapability.
 */
export const ImageInputVerdict = {
  Supported: 'supported',
  Unknown: 'unknown',
  Unsupported: 'unsupported',
  Rejected: 'rejected',
} as const;

export type ImageInputVerdict = (typeof ImageInputVerdict)[keyof typeof ImageInputVerdict];

export interface ImageCapabilityConfiguration {
  supportsImage?: boolean;
  imageInput?: ModelCapabilityStatus;
  /** Endpoint identity: a rejection belongs to the server that produced it. */
  endpointKey?: string;
}

/**
 * Fingerprint of the configuration a rejection was observed under. Any edit to
 * the capability verdict, or a different endpoint for the same model, makes the
 * observation stale so it can never outlive the setup that produced it.
 */
export function imageCapabilityFingerprint(configured?: ImageCapabilityConfiguration): string {
  return [
    configured?.supportsImage === true ? 'supports' : 'noSupports',
    configured?.imageInput ?? ModelCapabilityStatus.Unknown,
    configured?.endpointKey?.trim() || 'noEndpoint',
  ].join('|');
}

export function markImageInputRejected(
  providerName: string,
  modelId: string,
  fingerprint: string,
): void {
  if (!providerName.trim() || !modelId.trim()) return;
  observations.set(observationKey(providerName, modelId), { fingerprint });
}

export function isImageInputRejected(
  providerName: string,
  modelId: string,
  fingerprint: string,
): boolean {
  const observed = observations.get(observationKey(providerName, modelId));
  return observed !== undefined && observed.fingerprint === fingerprint;
}

/**
 * Test/QA helper — also used when the user edits provider or model settings:
 * an explicit config edit is a reason to try images again.
 */
export function clearImageInputObservations(): void {
  observations.clear();
}

/**
 * What this model can do with images right now, across configuration, provider
 * metadata, and runtime observations.
 *
 * A rejection only downgrades a set that claimed support: it can never upgrade
 * a model the catalog already knows is text-only.
 */
export function imageInputVerdict(
  configuredStatus: ModelCapabilityStatus | undefined,
  providerName: string,
  modelId: string,
  configured?: ImageCapabilityConfiguration,
): ImageInputVerdict {
  if (configuredStatus !== ModelCapabilityStatus.Supported) {
    return configuredStatus === ModelCapabilityStatus.Unsupported
      ? ImageInputVerdict.Unsupported
      : ImageInputVerdict.Unknown;
  }
  return isImageInputRejected(providerName, modelId, imageCapabilityFingerprint(configured))
    ? ImageInputVerdict.Rejected
    : ImageInputVerdict.Supported;
}

/**
 * Whether the current turn may carry image bytes. `Unknown` is deliberately
 * treated as "do not send": shipping an image the model may not accept costs a
 * failed turn, while omitting it costs the model a note plus a file path.
 */
export function shouldSendImageInput(
  capabilities: ModelCapabilities,
  providerName: string,
  modelId: string,
  configured?: ImageCapabilityConfiguration,
): boolean {
  return (
    imageInputVerdict(capabilities.imageInput, providerName, modelId, configured) ===
    ImageInputVerdict.Supported
  );
}

/**
 * Wording only a missing/disabled vision path produces. Deliberately narrower
 * than "the message mentions images": capability verdicts must not be derived
 * from payload errors.
 */
const VISION_CAPABILITY_WORDING = new RegExp(
  [
    'mmproj',
    'vision\\s+encoder',
    'vision\\s+(?:input|support|capabilit)',
    'cannot\\s+read\\s+images',
    "can't\\s+read\\s+images",
    'image(?:_url)?\\s+(?:input\\s+)?(?:is\\s+)?not\\s+support',
    'image\\s+input\\s+is\\s+not\\s+support',
    'not\\s+support(?:ed|s)?\\s+(?:image|vision|multimodal)',
    'unsupported\\s+(?:image|vision|multimodal)',
    'only\\s+supported\\s+by\\s+certain\\s+models',
    '不支持(?:图片|图像|多模态)',
    '未启用图片',
  ].join('|'),
  'i',
);

/** Wording that describes a bad image payload rather than a missing capability. */
const IMAGE_INPUT_ERROR_WORDING =
  /invalid\s+image|image\s+(?:data|bytes|content|size|dimensions|format|decoding)|corrupt|decode|too\s+(?:large|many)|exceeds?\s+\S{0,12}\s*limit/i;

/** Extensions the UI treats as image files when it cannot inline their bytes. */
const IMAGE_FILE_EXTENSIONS = new Set([
  'PNG',
  'JPG',
  'JPEG',
  'GIF',
  'WEBP',
  'BMP',
  'ICO',
  'TIF',
  'TIFF',
]);

/**
 * Image references that reach the model as bare paths.
 *
 * Two surfaces produce these: attachments the renderer could not inline (the
 * model gets an `input file: <path>` line and nothing else), and historical
 * attachments replayed when a session is rebuilt from the transcript. Both hand
 * the model an image it cannot open as bytes, so both deserve the same pointer
 * to the bundled OCR helper.
 */
export function collectImagePathReferences(
  attachments:
    | readonly {
        name?: string;
        path?: string;
        extension?: string;
        isImage?: boolean;
      }[]
    | undefined,
): ImageInputAttachmentRef[] {
  const references: ImageInputAttachmentRef[] = [];
  for (const attachment of attachments ?? []) {
    const attachmentPath = attachment.path?.trim();
    if (!attachmentPath || attachmentPath.startsWith('inline:')) continue;
    const dotIndex = attachmentPath.lastIndexOf('.');
    const extension = (
      attachment.extension ?? (dotIndex >= 0 ? attachmentPath.slice(dotIndex + 1) : '')
    )
      .replace(/^\./, '')
      .toUpperCase();
    if (attachment.isImage !== true && !IMAGE_FILE_EXTENSIONS.has(extension)) continue;
    references.push({ name: attachment.name?.trim() || attachmentPath, path: attachmentPath });
  }
  return references;
}

/**
 * Model-facing note used whenever images were present but not sent.
 *
 * Mirrors the in-band note Pi emits from `read` for non-vision models — the
 * image was omitted and nothing else needs inventing — plus the file paths and
 * just enough environment guidance to converge in a couple of attempts instead
 * of probing the machine for OCR tooling.
 */
export function buildImageOmittedNotice(
  attachments: readonly ImageInputAttachmentRef[],
  options: {
    verdict?: ImageInputVerdict;
    ocrCommandFor?: (imagePath: string) => string;
  } = {},
): string {
  if (attachments.length === 0) return '';
  const paths = attachments
    .map(attachment => attachment.path?.trim())
    .filter((path): path is string => Boolean(path));
  const commands = paths
    .map(path => (options.ocrCommandFor ? `  ${options.ocrCommandFor(path)}` : ''))
    .filter(Boolean);
  const lines = paths.map(path => `  - ${path}`);
  const reason =
    options.verdict === ImageInputVerdict.Unsupported
      ? 'the current model cannot read images'
      : options.verdict === ImageInputVerdict.Rejected
        ? 'this provider rejected an image request, so images are withheld from it'
        : options.verdict === ImageInputVerdict.Unknown
          ? 'image input for this model is not confirmed, so the picture was not sent'
          : 'the picture bytes could not be attached to this request';
  const header = `[Image not sent: ${reason}. The file stays on this machine`;
  const body = [
    'What to do: say plainly that the image was not sent.',
    ...(commands.length > 0
      ? [
          'If the text in the picture matters and the file cannot be opened as an image, the bundled helper extracts it — one command per image:',
          ...commands,
          'It returns text only: it cannot describe layout, photos, or charts, and it reports on stderr when the image has no machine-readable text — that is a result, not a broken script, so do not go looking for another OCR tool. Ask the user to paste or describe whatever the text does not cover.',
        ]
      : [
          'If the file cannot be opened as an image, ask the user to paste or describe what matters.',
        ]),
  ].join('\n');
  return lines.length > 0 ? `${header} at:\n${lines.join('\n')}\n${body}]` : `${header}.\n${body}]`;
}

/**
 * Structured counterpart to the wording-based capability classifier: a 400-class
 * rejection of a turn that actually carried images counts as an image-capability
 * rejection even when the server phrases it in a way the textual rules miss
 * (e.g. "started without the vision encoder ... cannot read images").
 *
 * Both halves are required. A 400 alone is not evidence — an unrelated bad
 * request would otherwise permanently mark the model as unable to read images
 * and silently strip every following turn.
 */
export function isImagePayloadRejection(message: string, carriedImages: boolean): boolean {
  if (!carriedImages) return false;
  const rejectedAsBadRequest =
    /\b400\b|invalid_request_error|BadRequestError|invalid\s+request/i.test(message);
  return rejectedAsBadRequest && isImageCapabilityError(message);
}

/**
 * Whether an error is about image-input capability at all — as opposed to a
 * problem with the image payload itself.
 *
 * Every branch that may record a capability verdict must go through this: a
 * refused format ("this model does not support image format image/webp") or a
 * corrupt file says nothing about whether the model can read images in general,
 * and one such message must not strip images from the model everywhere.
 */
export function isImageCapabilityError(message: string): boolean {
  if (IMAGE_INPUT_ERROR_WORDING.test(message)) return false;
  return VISION_CAPABILITY_WORDING.test(message);
}
