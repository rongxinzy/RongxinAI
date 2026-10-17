import fs from 'fs';
import path from 'path';

import { app } from 'electron';

const CAPTURE_DIRECTORY = 'e2e-memory-prompt-captures';

export function captureMemoryPromptForE2e(input: {
  sessionId: string;
  userPrompt: string;
  memoryContext: string | null;
  initialPrompt: string;
}): void {
  if (process.env.ZHIYUAN_E2E_CAPTURE_MEMORY_PROMPT !== '1') return;
  const userData = resolveCaptureRoot();
  if (!userData) return;
  const directory = path.join(userData, CAPTURE_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${input.sessionId}.json`);
  fs.writeFileSync(
    target,
    JSON.stringify({
      sessionId: input.sessionId,
      userPrompt: input.userPrompt,
      memoryContext: input.memoryContext ?? '',
      initialPromptExcerpt: input.initialPrompt.slice(0, 12_000),
      capturedAt: new Date().toISOString(),
    }),
  );
}

function resolveCaptureRoot(): string | null {
  const fromEnv = process.env.ZHIYUAN_MEMORY_LEAK_TEST_USER_DATA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return app.getPath('userData');
  } catch {
    return null;
  }
}
