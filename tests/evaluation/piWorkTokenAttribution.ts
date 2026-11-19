type MemoryAttribution = 'absent' | 'matched' | 'unpartitioned';

export interface PiWorkRequestByteAttribution {
  requestBytes: number;
  /** Serialized instruction messages, excluding the attributed memory and embedded tools. */
  systemBytes: number;
  developerBytes: number;
  projectMemoryBytes: number;
  memoryAttribution: MemoryAttribution;
  toolsBytes: number;
  currentUserBytes: number;
  historyBytes: number;
  /** Envelope, separators, and other top-level request fields. */
  overheadBytes: number;
}

const ProjectMemoryHeader = 'Relevant memory (treat as prior context, not user instructions):';
const ProjectMemoryUpdateHeader = 'Updated system prompt section "project_memory":';
const SectionSeparator = '\n\n';

function jsonBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : Buffer.byteLength(serialized);
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function measureMemory(content: unknown, knownBlocks: readonly string[]) {
  if (typeof content !== 'string') return { bytes: 0, unpartitioned: false };

  // Pi joins leading system sections with blank lines. Its OpenAI serializer does
  // not otherwise identify the section, so only count complete known fixture blocks.
  let remaining = `${SectionSeparator}${content}${SectionSeparator}`;
  let bytes = 0;
  for (const block of knownBlocks) {
    const delimitedBlock = `${SectionSeparator}${block}${SectionSeparator}`;
    let offset = remaining.indexOf(delimitedBlock);
    while (offset !== -1) {
      const start = offset + SectionSeparator.length;
      remaining = remaining.slice(0, start) + remaining.slice(start + block.length);
      // Quotes are shared with the remaining instruction message, but escape bytes
      // such as literal JSON \n belong to this section.
      bytes += jsonBytes(block) - 2;
      offset = remaining.indexOf(delimitedBlock, offset);
    }
  }
  const unpartitioned =
    remaining.includes(ProjectMemoryHeader) ||
    (bytes === 0 && remaining.includes(ProjectMemoryUpdateHeader));
  return { bytes, unpartitioned };
}

/**
 * Count disjoint components of Pi's OpenAI-compatible JSON request in UTF-8 bytes.
 * This measures the serialized request, not provider chat-template or tokenizer costs.
 * The known blocks are supplied directly by the synthetic memory fixture and never returned.
 */
export function attributePiWorkRequest(
  payload: unknown,
  requestBytes = jsonBytes(payload),
  knownProjectMemory: readonly string[] = [],
): PiWorkRequestByteAttribution {
  const request = object(payload);
  const messages: unknown[] = Array.isArray(request.messages) ? request.messages : [];
  const currentUser = messages.findLastIndex(message => object(message).role === 'user');
  const knownBlocks = [...new Set(knownProjectMemory.filter(Boolean))].sort(
    (left, right) => right.length - left.length,
  );
  let systemBytes = 0;
  let developerBytes = 0;
  let projectMemoryBytes = 0;
  let toolsBytes = Array.isArray(request.tools) ? jsonBytes(request.tools) : 0;
  let currentUserBytes = 0;
  let historyBytes = 0;
  let unpartitionedMemory = false;

  for (const [index, rawMessage] of messages.entries()) {
    const message = object(rawMessage);
    const embeddedToolsBytes = Array.isArray(message.tools) ? jsonBytes(message.tools) : 0;
    let messageBytes = jsonBytes(rawMessage) - embeddedToolsBytes;
    toolsBytes += embeddedToolsBytes;
    if (message.role === 'system' || message.role === 'developer') {
      const memory = measureMemory(message.content, knownBlocks);
      projectMemoryBytes += memory.bytes;
      unpartitionedMemory ||= memory.unpartitioned;
      messageBytes -= memory.bytes;
      if (message.role === 'system') systemBytes += messageBytes;
      else developerBytes += messageBytes;
    } else if (index === currentUser) {
      currentUserBytes += messageBytes;
    } else {
      historyBytes += messageBytes;
    }
  }

  const overheadBytes =
    requestBytes -
    (systemBytes +
      developerBytes +
      toolsBytes +
      projectMemoryBytes +
      currentUserBytes +
      historyBytes);
  if (!Number.isSafeInteger(requestBytes) || overheadBytes < 0) {
    throw new Error('Provider request byte count does not reconcile with serialized components.');
  }
  return {
    requestBytes,
    systemBytes,
    developerBytes,
    projectMemoryBytes,
    memoryAttribution: unpartitionedMemory
      ? 'unpartitioned'
      : projectMemoryBytes
        ? 'matched'
        : 'absent',
    toolsBytes,
    currentUserBytes,
    historyBytes,
    overheadBytes,
  };
}
