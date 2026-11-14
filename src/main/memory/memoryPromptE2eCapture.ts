import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { app } from 'electron';
import type { Message } from '@earendil-works/pi-ai';
import { getSystemMessageText, contentText } from '@earendil-works/pi-ai/utils/text';

/** Captures exactly the native request's rendered sections, only in explicit E2E mode. */
export async function captureNativeMemoryRequestForE2e(input: {
  sessionId: string;
  messages: readonly Message[];
}): Promise<void> {
  if (process.env.ZHIYUAN_E2E_CAPTURE_MEMORY_PROMPT !== '1') return;
  if (path.basename(input.sessionId) !== input.sessionId || !input.sessionId.trim()) return;
  const userData = resolveCaptureRoot();
  if (!userData) return;
  const system = input.messages.flatMap(message =>
    message.role === 'system' ? [getSystemMessageText(message)] : [],
  );
  const sections = new Map<string, string>();
  for (const text of system) {
    for (const match of text.matchAll(
      /<(long-term-memory|personal-long-term-memory)>[\s\S]*?<\/\1>/g,
    ))
      sections.set(match[1], match[0]);
  }
  const user = input.messages.findLast(message => message.role === 'user');
  const userPrompt = user?.role === 'user' ? contentText(user.content) : '';
  const directory = path.join(userData, 'e2e-memory-prompt-captures');
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${input.sessionId}.json`);
  const staging = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      staging,
      JSON.stringify({
        source: 'durable-before-request',
        sessionId: input.sessionId,
        userPrompt,
        memoryContext: [...sections.values()].join('\n\n'),
        initialPromptExcerpt: [...system, userPrompt].join('\n\n').slice(0, 12000),
        capturedAt: new Date().toISOString(),
      }),
      'utf8',
    );
    await rename(staging, target);
  } finally {
    await rm(staging, { force: true });
  }
}

function resolveCaptureRoot(): string | null {
  const override = process.env.ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA?.trim();
  if (override) return override;
  try {
    return app.getPath('userData');
  } catch {
    return null;
  }
}
