import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type {
  Message,
  TextContent,
  ThinkingContent,
  ImageContent,
  ToolCall,
  JsonValue,
} from '@earendil-works/pi-ai';
import {
  arr,
  bool,
  compile,
  lit,
  map,
  nul,
  num,
  obj,
  opt,
  recursive,
  str,
  union,
  type Schema,
} from '@earendil-works/pi-schema';
import type { Conversation, EntryId, Harness } from '@earendil-works/pi-durable';
import { RuntimeConfiguration } from './durableSessionMetadata.mjs';

const context = BACKGROUND_CONTEXT;

// Mirrors pi-ai 1.5.2's content declarations and each role's allowed variants.
// The native schema validator narrows unknown input without coercion/casts.
const text: Schema<TextContent> = obj({
  type: lit('text'),
  text: str(),
  textSignature: opt(str()),
});
const image: Schema<ImageContent> = obj({ type: lit('image'), data: str(), mimeType: str() });
const thinking: Schema<ThinkingContent> = obj({
  type: lit('thinking'),
  thinking: str(),
  thinkingSignature: opt(str()),
  redacted: opt(bool()),
});
const json = recursive<JsonValue>('zhiyuan.context-edit.json', value =>
  union([nul(), bool(), num(), str(), arr(value), map(value)]),
);
const call: Schema<ToolCall> = obj({
  type: lit('toolCall'),
  id: str(),
  name: str(),
  arguments: map(json),
  thoughtSignature: opt(str()),
  namespace: opt(str()),
  argumentsError: opt(str()),
});
const systemContent = compile(arr(text));
const mediaContent = compile(arr(union([text, image])));
const assistantContent = compile(arr(union([text, thinking, call])));

function replaceContent(message: Message, input: unknown): Message {
  const content =
    typeof input === 'string' && (message.role === 'assistant' || message.role === 'toolResult')
      ? [{ type: 'text', text: input }]
      : input;
  switch (message.role) {
    case 'system':
      if (typeof content === 'string' || systemContent.check(content))
        return { ...message, content };
      break;
    case 'user':
      if (typeof content === 'string' || mediaContent.check(content))
        return { ...message, content };
      break;
    case 'toolResult':
      if (mediaContent.check(content)) return { ...message, content };
      break;
    case 'assistant':
      if (assistantContent.check(content)) return { ...message, content };
      break;
  }
  throw new Error(`Invalid replacement content for ${message.role} message.`);
}

function entryIdentity(value: string): EntryId {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid native entry identity.');
  return id as EntryId;
}

export async function appendDurableContextEdit(
  conversation: Conversation,
  targetId: string,
  replacement: { content: unknown } | null,
): Promise<string> {
  return conversation.commit(async tx => {
    const target = entryIdentity(targetId);
    const visible = await tx.scanEntries(
      { conversationId: conversation.id, minEntryId: target, maxEntryId: target },
      1,
    );
    const entry = visible.items[0];
    if (!entry)
      throw new Error('Entry belongs to another conversation or is outside the active branch.');
    const messages =
      replacement === null
        ? undefined
        : (entry.model ?? []).map(message => replaceContent(message, replacement.content));
    const edit = await tx.appendEntry(conversation.id, {
      kind: 'zhiyuan.context-edit',
      edits: messages ? [{ action: 'replace', target, messages }] : [{ action: 'omit', target }],
    });
    return String(edit.id);
  }, context);
}

export async function forkDurableConversation(
  harness: Harness,
  conversation: Conversation,
  targetId: string,
) {
  const fork = await conversation.fork(
    entryIdentity(targetId),
    { ownership: { kind: 'ownerless' } },
    context,
  );
  await harness.commit(async tx => {
    (await tx.doc(RuntimeConfiguration)).conversationId = fork.id;
  }, context);
  return fork;
}
