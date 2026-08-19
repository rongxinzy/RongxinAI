import { createModels } from '@earendil-works/pi-ai';
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
} from '@earendil-works/pi-ai/providers/faux';
import { expect, test } from 'vitest';

import { SessionMemoryCompletionRole } from '../../memory/sessionMemoryExtractor';
import {
  buildPiBackgroundCompletionContext,
  extractPiBackgroundCompletionText,
} from './piBackgroundCompletion';

test('builds a Pi context with system instructions outside conversation messages', () => {
  const context = buildPiBackgroundCompletionContext(
    [
      { role: SessionMemoryCompletionRole.System, content: 'Return JSON only.' },
      { role: SessionMemoryCompletionRole.System, content: 'Use supplied evidence.' },
      { role: SessionMemoryCompletionRole.User, content: '{"conversation":[]}' },
    ],
    () => 42,
  );

  expect(context).toEqual({
    systemPrompt: 'Return JSON only.\n\nUse supplied evidence.',
    messages: [
      {
        role: SessionMemoryCompletionRole.User,
        content: '{"conversation":[]}',
        timestamp: 42,
      },
    ],
  });
});

test('uses a context accepted by the real Pi faux provider', async () => {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses([
    context => {
      expect(context.systemPrompt).toBe('Extract semantic memory.');
      expect(context.messages).toEqual([
        {
          role: SessionMemoryCompletionRole.User,
          content: 'Conversation evidence',
          timestamp: 7,
        },
      ]);
      return fauxAssistantMessage('{"shouldSave":false}');
    },
  ]);

  const result = await models.completeSimple(
    faux.getModel(),
    buildPiBackgroundCompletionContext(
      [
        { role: SessionMemoryCompletionRole.System, content: 'Extract semantic memory.' },
        { role: SessionMemoryCompletionRole.User, content: 'Conversation evidence' },
      ],
      () => 7,
    ),
  );

  expect(extractPiBackgroundCompletionText(result)).toBe('{"shouldSave":false}');
});

test('surfaces Pi provider errors instead of reporting an empty extraction', () => {
  expect(() =>
    extractPiBackgroundCompletionText(
      fauxAssistantMessage([], {
        stopReason: 'error',
        errorMessage: 'Provider rejected the request.',
      }),
    ),
  ).toThrow('Provider rejected the request.');
});

test('rejects reasoning-only responses without treating them as empty provider errors', () => {
  expect(() =>
    extractPiBackgroundCompletionText(fauxAssistantMessage(fauxThinking('Internal reasoning'))),
  ).toThrow('Pi background completion returned reasoning without final text.');
});

test('rejects completion requests without a user message', () => {
  expect(() =>
    buildPiBackgroundCompletionContext([
      { role: SessionMemoryCompletionRole.System, content: 'Extract semantic memory.' },
    ]),
  ).toThrow('Background completion requires at least one user message.');
});
