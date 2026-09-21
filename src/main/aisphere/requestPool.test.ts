import { expect, test } from 'vitest';

import { AISphereError } from '../../shared/aisphere';
import { AISphereRequestPool, prepareAISphereRequest } from './requestPool';

const signal = new AbortController().signal;

test('prepareAISphereRequest keeps a valid body and reports its model', () => {
  const body = JSON.stringify({ model: 'model-a', messages: [] });
  expect(prepareAISphereRequest(body)).toEqual({ model: 'model-a', body });
});

test('prepareAISphereRequest clamps output token fields above the model limit', () => {
  const prepared = prepareAISphereRequest(
    JSON.stringify({ model: 'model-a', max_tokens: 99999, max_completion_tokens: 10 }),
    128,
  );
  expect(JSON.parse(prepared.body)).toMatchObject({
    model: 'model-a',
    max_tokens: 128,
    max_completion_tokens: 10,
  });
});

test('prepareAISphereRequest rejects malformed bodies', () => {
  expect(() => prepareAISphereRequest('not-json')).toThrow(AISphereError.RequestRejected);
  expect(() => prepareAISphereRequest('{"messages":[]}')).toThrow(AISphereError.RequestRejected);
});

test('AISphereRequestPool rejects work after close or abort', async () => {
  const pool = new AISphereRequestPool();
  const body = JSON.stringify({ model: 'model-a' });
  await expect(pool.run(body, signal)).resolves.toMatchObject({ model: 'model-a' });
  pool.close();
  await expect(pool.run(body, signal)).rejects.toThrow(AISphereError.RequestRejected);

  const aborted = new AbortController();
  aborted.abort();
  await expect(new AISphereRequestPool().run(body, aborted.signal)).rejects.toThrow(
    AISphereError.RequestRejected,
  );
});
