import { CompanionComposerMode, CompanionSurface } from '../../shared/companion/constants';
interface Draft {
  text: string;
  requestId: string;
  mode?: CompanionComposerMode;
  workspaceId?: string;
}
const PREFIX = 'zhiyuan-companion-draft:';

/** The same draft keeps its request key until its durable admission is acknowledged. */
const draftKey = (petId: string, surface: CompanionSurface) =>
  PREFIX + (surface === CompanionSurface.Home ? 'home:' : '') + petId;

export function readCompanionDraft(
  petId: string,
  surface: CompanionSurface = CompanionSurface.Quick,
): Draft {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(draftKey(petId, surface)) ?? 'null');
    if (
      value &&
      typeof value === 'object' &&
      'text' in value &&
      typeof value.text === 'string' &&
      value.text.length <= 32_000 &&
      'requestId' in value &&
      typeof value.requestId === 'string' &&
      value.requestId.length <= 128 &&
      value.requestId.length > 0
    )
      return {
        text: value.text,
        requestId: value.requestId,
        mode:
          'mode' in value && value.mode === CompanionComposerMode.Task
            ? CompanionComposerMode.Task
            : CompanionComposerMode.Chat,
        workspaceId:
          'workspaceId' in value &&
          typeof value.workspaceId === 'string' &&
          value.workspaceId.length <= 128
            ? value.workspaceId
            : undefined,
      };
  } catch {
    /* Keep the window usable when browser storage is unavailable. */
  }
  return { text: '', requestId: crypto.randomUUID() };
}

export function writeCompanionDraft(
  petId: string,
  draft: Draft,
  surface: CompanionSurface = CompanionSurface.Quick,
): void {
  try {
    localStorage.setItem(draftKey(petId, surface), JSON.stringify(draft));
  } catch {
    /* The mounted window still owns the draft; hiding does not unmount it. */
  }
}
