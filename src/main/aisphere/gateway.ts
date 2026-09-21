import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { AISphere, AISphereError } from '../../shared/aisphere';
import { aisphereService, type AISphereService } from './service';
import { platformFetch, type PlatformFetch } from './transport';
import { AISphereRequestPool } from './requestPool';
import { t } from '../i18n';

export async function startAISphereGateway(
  service: AISphereService = aisphereService,
  fetcher: PlatformFetch = platformFetch,
  pool = new AISphereRequestPool(),
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (request, response) => {
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    const timeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    let release: (() => void) | undefined;
    try {
      if (
        request.method !== 'POST' ||
        request.url !== AISphere.ChatPath ||
        request.headers.authorization !== `Bearer ${service.token}`
      ) {
        response.writeHead(403).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 16 * 1024 * 1024) throw new Error(AISphereError.RequestRejected);
        chunks.push(bytes);
      }
      const started = performance.now();
      const prepared = await pool.run(Buffer.concat(chunks).toString('utf8'), controller.signal);
      console.debug(
        `[AISphere] Validated request body in ${Math.round(performance.now() - started)}ms.`,
      );
      // A binding may have changed while the body was arriving or being validated.
      if (request.headers.authorization !== `Bearer ${service.token}`)
        throw new Error(AISphereError.RequestRejected);
      const acquired = await service.acquire(prepared.model);
      release = acquired.release;
      const limited = acquired.model.maxTokens
        ? await pool.run(prepared.body, controller.signal, acquired.model.maxTokens)
        : prepared;
      // Allow same-host http→https upgrades from platform catalogs; credentialed
      // redirects to other hosts remain rejected inside platformFetch.
      const upstream = await fetcher(acquired.model.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${acquired.model.apiKey}`,
        },
        body: limited.body,
        signal: controller.signal,
      });
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      });
      if (upstream.body) {
        const reader = upstream.body.getReader();
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (!response.write(chunk.value))
              await once(response, 'drain', { signal: controller.signal });
          }
        } finally {
          await reader.cancel().catch((): void => {});
        }
      }
      response.end();
    } catch (error) {
      if (!response.headersSent)
        response.writeHead(503, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            error: {
              message: t(
                error instanceof Error && error.message === AISphereError.MissingModel
                  ? AISphereError.MissingModel
                  : AISphereError.Unavailable,
              ),
            },
          }),
        );
      else response.destroy();
    } finally {
      clearTimeout(timeout);
      release?.();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('AISphere gateway failed to start.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      service.dispose();
      pool.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
