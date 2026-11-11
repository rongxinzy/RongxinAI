import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Forward bytes immediately, retaining a copy only for the test recording. */
export async function forwardTapeResponse(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; contentType: string; responseBody: string }> {
  const controller = new AbortController();
  const onClose = (): void => {
    if (!res.writableFinished) controller.abort();
  };
  res.on('close', onClose);
  res.on('error', onClose);
  req.on('aborted', onClose);
  if (res.destroyed || req.aborted) controller.abort();
  try {
    const response = await fetch(`${upstream}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? 'application/json';
    res.writeHead(response.status, { 'content-type': contentType });
    res.flushHeaders();
    const chunks: Buffer[] = [];
    if (response.body) {
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        chunks.push(bytes);
        if (!res.write(bytes)) await once(res, 'drain', { signal: controller.signal });
      }
    }
    return {
      status: response.status,
      contentType,
      responseBody: Buffer.concat(chunks).toString('utf8'),
    };
  } finally {
    res.off('close', onClose);
    res.off('error', onClose);
    req.off('aborted', onClose);
  }
}
