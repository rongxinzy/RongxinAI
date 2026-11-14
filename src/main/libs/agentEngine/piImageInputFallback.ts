import { ModelCapabilityStatus } from '../../../shared/providers';

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

/** Capabilities come from configuration, never inferred from a failed turn. */
export const ImageInputVerdict = {
  Supported: 'supported',
  Unknown: 'unknown',
  Unsupported: 'unsupported',
} as const;

export type ImageInputVerdict = (typeof ImageInputVerdict)[keyof typeof ImageInputVerdict];

export function imageInputVerdict(status: ModelCapabilityStatus | undefined): ImageInputVerdict {
  if (status === ModelCapabilityStatus.Supported) return ImageInputVerdict.Supported;
  if (status === ModelCapabilityStatus.Unsupported) return ImageInputVerdict.Unsupported;
  return ImageInputVerdict.Unknown;
}

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
