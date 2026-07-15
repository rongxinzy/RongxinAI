import { expect, test } from 'vitest';

import { buildLlamaServerArgs } from './llamacppServe';

test('disables router model autoload by default', () => {
  expect(buildLlamaServerArgs({}, '/models', '/models-preset.ini')).toEqual(
    expect.arrayContaining(['--no-models-autoload']),
  );
});
