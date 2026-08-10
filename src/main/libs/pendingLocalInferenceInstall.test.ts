import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, test } from 'vitest';

import {
  consumePendingLocalInferenceInstall,
  PENDING_LOCAL_INFERENCE_INSTALL_FILE,
} from './pendingLocalInferenceInstall';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('pending local inference installer request', () => {
  test('returns and removes a one-time request marker', () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-llama-request-'));
    temporaryDirectories.push(userDataPath);
    const markerPath = path.join(userDataPath, PENDING_LOCAL_INFERENCE_INSTALL_FILE);
    fs.writeFileSync(markerPath, 'resource-pack-id');

    expect(consumePendingLocalInferenceInstall(userDataPath)).toBe('resource-pack-id');
    expect(fs.existsSync(markerPath)).toBe(false);
    expect(consumePendingLocalInferenceInstall(userDataPath)).toBeNull();
  });
});
