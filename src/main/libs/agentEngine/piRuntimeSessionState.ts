/** Prompt preparation and application resource entry points. */
import path from 'node:path';
import { getModel, completeSimple } from '@earendil-works/pi-ai/compat';
import { readCoworkImageBase64 } from '../../coworkImageAttachments';
import { createDurableSession } from './durableSession.mjs';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import {
  buildImageOmittedNotice,
  ImageInputVerdict,
  type ImageInputAttachmentRef,
} from './piImageInputFallback';
import type { PiStartOptions } from './piRuntimeTypes';
import type { PiModules, PiSession } from './piRuntimeContracts';
export type * from './piRuntimeContracts';
export type { ActivePiSession } from './piActiveSession';
export function preparePiPrompt(
  text: string,
  attachments: PiStartOptions['imageAttachments'] | undefined,
  verdict: ImageInputVerdict,
  ocrCommandFor?: (imagePath: string) => string,
  pathImageReferences: readonly ImageInputAttachmentRef[] = [],
): {
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  hasImages: boolean;
  sentImages: ImageInputAttachmentRef[];
  omittedImages: ImageInputAttachmentRef[];
} {
  const sendImages = verdict === ImageInputVerdict.Supported;
  // A path-only image is only worth explaining when the model cannot open it as
  // an image: a vision-capable model just reads the file.
  const pathOnly = sendImages ? [] : pathImageReferences;
  if (!attachments?.length && pathOnly.length === 0) {
    return { content: text, hasImages: false, sentImages: [], omittedImages: [] };
  }
  const imageAttachments = (attachments ?? []).filter(item => item.mimeType.startsWith('image/'));
  const references = imageAttachments.map(item => ({ name: item.name, path: item.path }));
  if (sendImages) {
    const images = imageAttachments
      .filter(item => item.base64Data || item.path)
      .map(item => ({
        type: 'image' as const,
        data: readCoworkImageBase64(item),
        mimeType: item.mimeType,
      }))
      .filter(item => item.data.length > 0);
    if (images.length > 0) {
      return {
        content: [{ type: 'text', text }, ...images],
        hasImages: true,
        sentImages: references,
        omittedImages: [],
      };
    }
  }
  // Pi answers a non-vision model's `read` with an in-band note instead of a
  // failed request; Cowork images never pass through `read`, so the same facts
  // (why the picture is absent, plus the file paths) have to travel with the
  // prompt itself. Images withheld by capability and images the UI could only
  // attach by path share one note: in both cases the model holds a path, not
  // pixels.
  const notice = buildImageOmittedNotice([...references, ...pathOnly], { verdict, ocrCommandFor });
  return {
    content: text.trim() ? `${text}\n\n${notice}` : notice,
    hasImages: false,
    sentImages: [],
    omittedImages: references,
  };
}

/** Yields one macrotask so settling bookkeeping (e.g. a cancelled retry) can run. */
export const yieldToEventLoop = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
};

/**
 * Prompt content prepared for one Pi turn: the text, plus image blocks when the
 * model may receive them, and the attachment bookkeeping the failure path needs.
 */
export interface PreparedPiPrompt {
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  hasImages: boolean;
  sentImages: ImageInputAttachmentRef[];
  omittedImages: ImageInputAttachmentRef[];
}

/**
 * Sends a prompt that was already prepared (and recorded) by the caller.
 *
 * Preparation is deliberately separated from sending: the SDK can report a
 * rejected payload through events that land before the send promise settles, so
 * the turn's image state must be recorded *before* the request leaves.
 */
export async function sendPiPrompt(
  session: PiSession,
  prepared: PreparedPiPrompt,
  streamingBehavior?: 'steer' | 'followUp',
): Promise<void> {
  if (prepared.hasImages) {
    if (!session.sendUserMessage) {
      throw new Error('The installed agent runtime cannot send image attachments.');
    }
    await session.sendUserMessage(
      prepared.content,
      streamingBehavior ? { deliverAs: streamingBehavior } : undefined,
    );
    return;
  }
  if (streamingBehavior) {
    await session.prompt(prepared.content as string, { streamingBehavior });
  } else {
    await session.prompt(prepared.content as string);
  }
}

/** The application owns providers; Durable is the only execution implementation. */
export async function getPiModules(): Promise<PiModules> {
  return {
    createAgentSession: options => createDurableSession(options ?? {}),
    ModelRuntime: { create: () => DurableModelCatalog.create() },
    getAgentDir: () => process.env.ZHIYUAN_AGENT_DIR ?? path.join(process.cwd(), '.zhiyuan-agent'),
    getModel,
    completeSimple: (model, context, options) =>
      completeSimple(model as Parameters<typeof completeSimple>[0], context, options),
  };
}

// ── Constants ──

/**
 * How much a streaming body must grow before its next SQLite checkpoint.
 * better-sqlite3 is synchronous and blocks the main-process event loop, so
 * writing the accumulated body on a timer made a turn's write cost quadratic
 * in message length. Checkpoints persist only crash protection for the
 * in-flight turn; the finalize write is authoritative.
 */
export const STREAM_CHECKPOINT_GROWTH_CHARS = 32_768;

/**
 * Time floor between SQLite checkpoints. Most replies never grow past
 * {@link STREAM_CHECKPOINT_GROWTH_CHARS}, and without this floor a crash
 * mid-stream would leave the row at the first delta — the old 250 ms timer
 * bounded the loss to one tick. A body that keeps growing gets a checkpoint
 * at least this often; an unchanged body is never rewritten.
 */
export const STREAM_CHECKPOINT_MIN_INTERVAL_MS = 3_000;

/**
 * This throttles the in-process bus event `messageUpdate` for IM/coding-room
 * consumers only. It never reaches renderer IPC (piUiForwarder drops
 * non-final messageUpdate), so it is not a second UI throttle.
 */
export const MESSAGE_UPDATE_THROTTLE_MS = 200;

export const normalizeSkillIds = (skillIds: string[] | undefined): string[] | undefined =>
  skillIds === undefined
    ? undefined
    : [...new Set(skillIds.map(skillId => skillId.trim()).filter(Boolean))].sort();

/**
 * Skills are additive: a queued turn keeps whatever the session already runs
 * and adds the ones the user attached to that queued input. Both sides unknown
 * keeps the session's implicit "no explicit skill set" state instead of
 * materializing an empty list, which would force a session rebuild.
 */
export const mergeSkillIds = (
  base: string[] | undefined,
  added: string[] | undefined,
): string[] | undefined =>
  base === undefined && added === undefined
    ? undefined
    : [...new Set([...(base ?? []), ...(added ?? [])])];

export const haveSameStringList = (
  left: string[] | undefined,
  right: string[] | undefined,
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]));
