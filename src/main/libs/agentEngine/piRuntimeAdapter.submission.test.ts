import { expect, test, vi } from 'vitest';

import { PiRuntimeAdapter } from './piRuntimeAdapter';

test.each(['', ' \t\n', '\u200b\u200d\ufeff'])(
  'rejects empty runtime input before accessing session state: %j',
  async prompt => {
    const adapter = new PiRuntimeAdapter();
    const getSession = vi.fn(() => {
      throw new Error('Session state must not be accessed.');
    });
    Object.defineProperty(adapter, 'activeSessions', {
      value: { get: getSession, has: getSession },
    });
    await expect(adapter.startSession('session', prompt)).rejects.toThrow('Prompt is required.');
    await expect(adapter.continueSession('session', prompt)).rejects.toThrow('Prompt is required.');
    expect(getSession).not.toHaveBeenCalled();
  },
);

test('rejects empty images before initializing or reusing a runtime', async () => {
  const adapter = new PiRuntimeAdapter();
  const options = {
    imageAttachments: [{ name: 'broken.png', mimeType: 'image/png', base64Data: '' }],
  };
  await expect(adapter.startSession('session', '', options)).rejects.toThrow('Prompt is required.');
  await expect(adapter.continueSession('session', '', options)).rejects.toThrow(
    'Prompt is required.',
  );
});

test('image-only continuation reaches the normal session restoration path', async () => {
  const adapter = new PiRuntimeAdapter();
  const start = vi.spyOn(adapter, 'startSession').mockResolvedValue();
  const options = {
    imageAttachments: [{ name: 'example.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
  };
  await adapter.continueSession('session', '', options);
  expect(start).toHaveBeenCalledWith('session', '', expect.objectContaining(options));
});
