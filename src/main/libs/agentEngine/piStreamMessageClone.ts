import type { PiStreamMessage } from './piStreamAccumulator';

interface PiStreamContentBlock {
  type: string;
  text?: string;
  thinking?: string;
}

/** Deep-clone a Pi partial message so mutable SDK snapshots are never retained. */
export function clonePiStreamMessage(message?: PiStreamMessage): PiStreamMessage | undefined {
  if (!message) return undefined;
  const content = message.content;
  if (typeof content === 'string') {
    return { content };
  }
  if (!Array.isArray(content)) {
    return { content: content ?? null };
  }
  const cloned: PiStreamContentBlock[] = content.map(block => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text ?? '' };
    }
    if (block.type === 'thinking') {
      return { type: 'thinking', thinking: block.thinking ?? '' };
    }
    return { ...block };
  });
  return { content: cloned };
}
