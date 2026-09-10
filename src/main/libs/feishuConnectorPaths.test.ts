import path from 'path';

import { expect, test } from 'vitest';

import {
  FeishuConnectorPath,
  getFeishuCliBinDirectory,
  getFeishuCliRoot,
  getFeishuConnectorSkillsRoot,
} from './feishuConnectorPaths';

test('keeps the CLI and Skills in distinct app-owned connector paths', () => {
  const userDataPath = path.join('D:', 'test-user-data');

  expect(getFeishuCliRoot(userDataPath)).toBe(path.join(userDataPath, 'MCPs', 'feishu', 'cli'));
  expect(getFeishuCliBinDirectory(userDataPath)).toBe(
    path.join(userDataPath, 'MCPs', 'feishu', 'cli', 'bin'),
  );
  expect(getFeishuConnectorSkillsRoot(userDataPath)).toBe(
    path.join(userDataPath, 'MCPs', 'feishu', 'skills'),
  );
  expect(FeishuConnectorPath.RuntimeManifestFile).toBe('runtime-manifest.json');
});
