interface Draft {
  text: string;
  requestId: string;
}
const PREFIX = 'zhiyuan-companion-draft:';

/** The same draft keeps its request key until its durable admission is acknowledged. */
export function readCompanionDraft(petId: string): Draft {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFIX + petId) ?? 'null');
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
      return { text: value.text, requestId: value.requestId };
  } catch {
    /* Keep the window usable when browser storage is unavailable. */
  }
  return { text: '', requestId: crypto.randomUUID() };
}

export function writeCompanionDraft(petId: string, draft: Draft): void {
  try {
    localStorage.setItem(PREFIX + petId, JSON.stringify(draft));
  } catch {
    /* The mounted window still owns the draft; hiding does not unmount it. */
  }
}
