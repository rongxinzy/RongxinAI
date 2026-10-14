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
 * Fingerprint of the configured image verdict. A config edit (the user marking
 * the model as text-only, or back to image-capable) invalidates the observation
 * so a stale rejection can never outlive the setting that produced it.
 */
export function imageCapabilityFingerprint(configured?: {
  supportsImage?: boolean;
  imageInput?: ModelCapabilityStatus;
}): string {
  return `${configured?.supportsImage === true ? 'supports' : 'noSupports'}|${
    configured?.imageInput ?? ModelCapabilityStatus.Unknown
  }`;
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

/** Test/QA helper — also useful when a session is rebuilt from scratch. */
export function clearImageInputObservations(): void {
  observations.clear();
}

/**
 * Whether the current turn may carry image bytes.
 *
 * Unknown is deliberately treated as "do not send": silently shipping an image
 * the model may not accept costs a failed turn, while omitting it costs only a
 * note to the model.
 */
export function shouldSendImageInput(
  capabilities: ModelCapabilities,
  providerName: string,
  modelId: string,
  configured?: { supportsImage?: boolean; imageInput?: ModelCapabilityStatus },
): boolean {
  if (capabilities.imageInput !== ModelCapabilityStatus.Supported) return false;
  return !isImageInputRejected(providerName, modelId, imageCapabilityFingerprint(configured));
}

/**
 * Model-facing note used whenever images were present but not sent. Mirrors the
 * in-band note Pi emits from `read` for non-vision models, plus the file paths
 * so the model can act (read the file, run a local tool such as OCR, or ask the
 * user for the content) instead of guessing.
 */
export function buildImageOmittedNotice(attachments: readonly ImageInputAttachmentRef[]): string {
  if (attachments.length === 0) return '';
  const lines = attachments
    .map(attachment => attachment.path?.trim())
    .filter((path): path is string => Boolean(path))
    .map(path => `  - ${path}`);
  const header =
    '[Image attachments were not sent: the current model cannot read images. Images remain on this machine';
  const footer =
    'Read the file paths directly, process them with a local tool (for example a script that runs system OCR), or ask the user to paste the image content as text. Do not guess image content from file names.]';
  return lines.length > 0
    ? `${header} at:\n${lines.join('\n')}\n${footer}`
    : `${header}.\n${footer}`;
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
  const mentionsImages = /image|vision|mmproj|multimodal|图片|图像/i.test(message);
  return rejectedAsBadRequest && mentionsImages;
}
