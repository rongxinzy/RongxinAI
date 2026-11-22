/**
 * Web Search Skill - Bridge Server
 * Provides HTTP API for browser control and search operations
 */

import express, { NextFunction, Request, Response } from 'express';
import { Server } from 'http';
import path from 'node:path';
import { PlaywrightManager } from './playwright/manager';
import {
  launchBrowser,
  closeBrowser,
  isBrowserRunning,
  isOwnedCdpReachable,
  BrowserInstance,
} from './playwright/browser';
import { BingSearch } from './search/bing';
import { GoogleSearch } from './search/google';
import { navigate, screenshot, getContent, getTextContent } from './playwright/operations';
import { Config, mergeConfig } from './config';
import { SearchResponse } from './search/types';
import { openStandaloneControl } from './standaloneControl.cjs';

type SearchEngine = 'google' | 'bing';
type SearchEnginePreference = SearchEngine | 'auto';

const ALLOWED_URL_SCHEMES = ['http:', 'https:'];

function validateNavigationUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol)) {
    throw new Error(`Blocked URL scheme "${parsed.protocol}" — only http/https allowed`);
  }
}

function decodeJsonRequestBody(raw: Buffer): string {
  if (raw.length === 0) {
    return '';
  }

  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return new TextDecoder('utf-8', { fatal: false }).decode(raw.subarray(3));
  }
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return new TextDecoder('utf-16le', { fatal: false }).decode(raw.subarray(2));
  }
  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    return new TextDecoder('utf-16be', { fatal: false }).decode(raw.subarray(2));
  }

  // Per RFC 8259, JSON must be UTF-8. Prefer UTF-8 when it decodes cleanly.
  // The scoring heuristic (scoreDecodedJsonText) is unreliable for CJK text:
  // gb18030 uses 2 bytes per CJK char vs UTF-8's 3 bytes, so the same bytes
  // decoded as gb18030 produce more CJK chars → higher score → wrong choice.
  try {
    const utf8Decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    JSON.parse(utf8Decoded);
    return utf8Decoded;
  } catch {
    // UTF-8 decoding or JSON parsing failed
  }

  // Fallback: try gb18030 for clients that send non-UTF-8 bodies (e.g. Windows GBK)
  try {
    const gbDecoded = new TextDecoder('gb18030', { fatal: true }).decode(raw);
    console.warn('[Bridge Server] Request body decoded using gb18030 fallback');
    return gbDecoded;
  } catch {
    // gb18030 also failed
  }

  return new TextDecoder('utf-8', { fatal: false }).decode(raw);
}

export class BridgeServer {
  private app: express.Application;
  private playwrightManager: PlaywrightManager;
  private bingSearch: BingSearch;
  private googleSearch: GoogleSearch;
  private browserInstance: BrowserInstance | null = null;
  private httpServer: Server | null = null;
  private ready = false;
  private readonly shutdown = new AbortController();
  private browserTransition = Promise.resolve();
  private config: Config;

  constructor(config?: Partial<Config>) {
    this.config = mergeConfig(config);
    this.app = express();
    this.playwrightManager = new PlaywrightManager();
    this.bingSearch = new BingSearch(this.playwrightManager);
    this.googleSearch = new GoogleSearch(this.playwrightManager);

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(
      express.raw({
        type: ['application/json', 'application/*+json'],
        limit: '2mb',
      }),
    );

    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const contentType = req.headers['content-type'];
      const isJsonRequest = Array.isArray(contentType)
        ? contentType.some(value => value.includes('application/json') || value.includes('+json'))
        : typeof contentType === 'string'
          ? contentType.includes('application/json') || contentType.includes('+json')
          : false;

      if (!isJsonRequest) {
        if (!req.body || typeof req.body !== 'object' || Buffer.isBuffer(req.body)) {
          req.body = {};
        }
        next();
        return;
      }

      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (rawBody.length === 0) {
        req.body = {};
        next();
        return;
      }

      try {
        const decoded = decodeJsonRequestBody(rawBody);
        req.body = JSON.parse(decoded) as Record<string, unknown>;
        next();
      } catch (error) {
        res.status(400).json({
          success: false,
          error: `Invalid JSON body: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });

    // CORS for localhost only
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;
      const isLocalhost = origin && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);

      if (isLocalhost) {
        res.header('Access-Control-Allow-Origin', origin);
      }

      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Vary', 'Origin');

      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }

      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`[API] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/api/health', this.handleHealth.bind(this));

    // Browser management
    this.app.post('/api/browser/launch', this.handleBrowserLaunch.bind(this));
    this.app.post('/api/browser/connect', this.handleBrowserConnect.bind(this));
    this.app.post('/api/browser/disconnect', this.handleBrowserDisconnect.bind(this));
    this.app.post('/api/browser/close', this.handleBrowserClose.bind(this));
    this.app.get('/api/browser/status', this.handleBrowserStatus.bind(this));

    // Search operations
    this.app.post('/api/search', this.handleSearch.bind(this));
    this.app.post('/api/search/content', this.handleGetContent.bind(this));

    // Page operations
    this.app.post('/api/page/navigate', this.handleNavigate.bind(this));
    this.app.post('/api/page/screenshot', this.handleScreenshot.bind(this));
    this.app.post('/api/page/content', this.handlePageContent.bind(this));
    this.app.post('/api/page/text', this.handlePageText.bind(this));

    // Connection management
    this.app.get('/api/connections', this.handleListConnections.bind(this));
  }

  private async resetBrowserState(): Promise<void> {
    await this.playwrightManager.disconnectAll();

    if (this.browserInstance) {
      await closeBrowser(this.browserInstance);
      this.browserInstance = null;
    }
  }

  private runBrowserTransition<T>(transition: () => Promise<T>): Promise<T> {
    const next = this.browserTransition.then(() => {
      this.shutdown.signal.throwIfAborted();
      return transition();
    });
    this.browserTransition = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  private async relaunchHeadfulBrowser(): Promise<string> {
    const instance = await this.runBrowserTransition(async () => {
      await this.resetBrowserState();
      this.browserInstance = await launchBrowser(
        { ...this.config.browser, headless: false },
        this.shutdown.signal,
      );
      return this.browserInstance;
    });
    return this.playwrightManager.connectToCDP(instance.cdpPort, instance.cdpWebSocketUrl);
  }

  private ensureBrowserReady(): Promise<{ instance: BrowserInstance; reused: boolean }> {
    return this.runBrowserTransition(async () => {
      if (this.browserInstance) {
        if (await isOwnedCdpReachable(this.browserInstance, this.shutdown.signal))
          return { instance: this.browserInstance, reused: true };

        console.warn('[Bridge Server] Detected stale browser instance, relaunching...');
        await this.resetBrowserState();
      }

      this.browserInstance = await launchBrowser(this.config.browser, this.shutdown.signal);
      return { instance: this.browserInstance, reused: false };
    });
  }

  // Health check endpoint
  private handleHealth(req: Request, res: Response): void {
    if (!this.ready) {
      res.status(503).json({ success: false });
      return;
    }
    res.json({
      success: true,
      data: {
        status: 'healthy',
        uptime: process.uptime(),
        connections: this.playwrightManager.getConnectionCount(),
      },
    });
  }

  // Launch browser
  private async handleBrowserLaunch(req: Request, res: Response): Promise<void> {
    try {
      const { instance, reused } = await this.ensureBrowserReady();

      if (reused) {
        res.json({
          success: true,
          data: {
            message: 'Browser already running',
            pid: instance.pid,
            cdpPort: instance.cdpPort,
          },
        });
        return;
      }

      res.json({
        success: true,
        data: {
          pid: instance.pid,
          cdpPort: instance.cdpPort,
          startTime: instance.startTime,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Connect to browser via Playwright
  private async handleBrowserConnect(req: Request, res: Response): Promise<void> {
    try {
      const { cdpPort } = req.body;
      const instance = cdpPort ? undefined : (await this.ensureBrowserReady()).instance;
      const port = instance?.cdpPort ?? (cdpPort as number);
      const connectionId = await this.playwrightManager.connectToCDP(
        port,
        instance?.cdpWebSocketUrl,
      );

      res.json({
        success: true,
        data: {
          connectionId,
          cdpPort: port,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Disconnect from browser
  private async handleBrowserDisconnect(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId is required',
        });
        return;
      }

      await this.playwrightManager.disconnect(connectionId);

      res.json({
        success: true,
        data: { message: 'Disconnected successfully' },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Close browser and disconnect all connections
  private async handleBrowserClose(req: Request, res: Response): Promise<void> {
    try {
      await this.runBrowserTransition(() => this.resetBrowserState());

      res.json({
        success: true,
        data: { message: 'Browser closed successfully' },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Get browser status
  private async handleBrowserStatus(req: Request, res: Response): Promise<void> {
    const instance = this.browserInstance;
    const cdpReachable = instance ? await isOwnedCdpReachable(instance, this.shutdown.signal) : false;
    const processAlive = isBrowserRunning(instance);

    res.json({
      success: true,
      data: {
        browserRunning: processAlive && cdpReachable,
        processAlive,
        cdpReachable,
        connections: this.playwrightManager.getConnectionCount(),
        pid: instance?.pid,
        cdpPort: instance?.cdpPort,
      },
    });
  }

  // Search operation
  private async handleSearch(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, query, maxResults, engine } = req.body;

      if (!connectionId || !query) {
        res.status(400).json({
          success: false,
          error: 'connectionId and query are required',
        });
        return;
      }

      const preferredEngine = this.normalizeEnginePreference(engine);
      let results: SearchResponse;
      try {
        results = await this.searchWithFallback(connectionId, query, maxResults, preferredEngine);
      } catch (error) {
        const isHeadless = this.browserInstance?.headless === true;
        if (!isHeadless || !this.config.browser.fallbackToHeadful) {
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Search] Headless search failed, retrying with visible browser: ${message}`);
        const fallbackConnectionId = await this.relaunchHeadfulBrowser();
        results = await this.searchWithFallback(
          fallbackConnectionId,
          query,
          maxResults,
          preferredEngine,
        );
      }

      res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private normalizeEnginePreference(engine: unknown): SearchEnginePreference {
    if (engine === 'google' || engine === 'bing' || engine === 'auto') {
      return engine;
    }

    return this.config.search.defaultEngine;
  }

  private resolveSearchEngineOrder(preferredEngine: SearchEnginePreference): SearchEngine[] {
    if (preferredEngine === 'google' || preferredEngine === 'bing') {
      return [preferredEngine];
    }

    const configuredOrder = this.config.search.fallbackOrder.filter(
      (item): item is SearchEngine => item === 'google' || item === 'bing',
    );
    const fullOrder: SearchEngine[] = [...configuredOrder, 'google', 'bing'];
    return Array.from(new Set<SearchEngine>(fullOrder));
  }

  private async searchWithFallback(
    connectionId: string,
    query: string,
    maxResults: number | undefined,
    preferredEngine: SearchEnginePreference,
  ): Promise<SearchResponse> {
    const engineOrder = this.resolveSearchEngineOrder(preferredEngine);
    const errors: string[] = [];

    for (const engine of engineOrder) {
      try {
        console.log(`[Search] Trying engine: ${engine}`);
        let response: SearchResponse;
        if (engine === 'google') {
          response = await this.googleSearch.search(connectionId, query, { maxResults });
        } else {
          response = await this.bingSearch.search(connectionId, query, { maxResults });
        }

        if (response.results.length === 0) {
          throw new Error(`${engine} returned no results`);
        }

        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${engine}: ${message}`);
        console.warn(`[Search] Engine failed (${engine}): ${message}`);
      }
    }

    throw new Error(`All configured search engines failed. ${errors.join(' | ')}`);
  }

  // Get content from URL
  private async handleGetContent(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, url } = req.body;

      if (!connectionId || !url) {
        res.status(400).json({
          success: false,
          error: 'connectionId and url are required',
        });
        return;
      }

      validateNavigationUrl(url);

      const content = await this.bingSearch.getResultContent(connectionId, url);

      res.json({
        success: true,
        data: { content },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Navigate to URL
  private async handleNavigate(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, url, waitUntil, timeout } = req.body;

      if (!connectionId || !url) {
        res.status(400).json({
          success: false,
          error: 'connectionId and url are required',
        });
        return;
      }

      validateNavigationUrl(url);

      const page = await this.playwrightManager.getPage(connectionId);
      await navigate(page, { url, waitUntil, timeout });

      res.json({
        success: true,
        data: { url: page.url() },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Take screenshot
  private async handleScreenshot(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId, format = 'png', fullPage = false } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId is required',
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const buffer = await screenshot(page, { format, fullPage });

      res.json({
        success: true,
        data: {
          screenshot: buffer.toString('base64'),
          format,
          size: buffer.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Get page HTML content
  private async handlePageContent(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId is required',
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const content = await getContent(page);

      res.json({
        success: true,
        data: { content },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Get page text content
  private async handlePageText(req: Request, res: Response): Promise<void> {
    try {
      const { connectionId } = req.body;

      if (!connectionId) {
        res.status(400).json({
          success: false,
          error: 'connectionId is required',
        });
        return;
      }

      const page = await this.playwrightManager.getPage(connectionId);
      const text = await getTextContent(page);

      res.json({
        success: true,
        data: { text },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // List all connections
  private handleListConnections(req: Request, res: Response): void {
    const connections = this.playwrightManager.listConnections();

    res.json({
      success: true,
      data: { connections },
    });
  }

  /**
   * Start the server
   */
  async start(afterListen?: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.config.server.port, this.config.server.host);
      this.httpServer = server;

      server.once('error', error => {
        this.httpServer = null;
        reject(error);
      });

      server.once('listening', async () => {
        try {
          await afterListen?.();
        } catch (error) {
          server.close();
          server.closeAllConnections();
          reject(error);
          return;
        }
        this.ready = true;
        console.log(
          `\n[Bridge Server] Started on http://${this.config.server.host}:${this.config.server.port}`,
        );
        console.log(
          `[Bridge Server] Health check: http://${this.config.server.host}:${this.config.server.port}/api/health\n`,
        );
        resolve();
      });
    });
  }

  /**
   * Stop the server and cleanup
   */
  async stop(): Promise<void> {
    console.log('\n[Bridge Server] Shutting down...');
    this.ready = false;
    this.shutdown.abort();
    const httpServer = this.httpServer;
    this.httpServer = null;
    const closed =
      httpServer &&
      new Promise<void>((resolve, reject) => {
        httpServer.close(error => (error ? reject(error) : resolve()));
        httpServer.closeAllConnections();
      });
    await Promise.all([closed, this.browserTransition.then(() => this.resetBrowserState())]);
    console.log('[Bridge Server] Shutdown complete\n');
  }
}

export async function runBridgeProcess(server: BridgeServer, skillRoot: string): Promise<void> {
  const managed = typeof process.send === 'function';
  let closeControl: (() => void) | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= startup.then(() => {
      closeControl?.();
      return server.stop();
    }));
  const quit = () => {
    void stop().then(
      () => process.exit(0),
      error => {
        console.error('[Bridge Server] Failed to stop:', error);
        process.exit(1);
      },
    );
  };
  const startup = server.start(async () => {
    if (!managed && !stopping) closeControl = await openStandaloneControl(skillRoot, stop);
  });
  process.once('SIGINT', quit);
  process.once('SIGTERM', quit);
  if (managed) {
    process.once('disconnect', quit);
    if (!process.connected) quit();
  }
  await startup;
}

if (require.main === module) {
  runBridgeProcess(new BridgeServer(), path.resolve(__dirname, '../..')).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export default BridgeServer;
