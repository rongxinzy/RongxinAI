/**
 * VCR-style tape server for Pi provider HTTP traffic.
 *
 * Sits between the adapter stack and the model endpoint so long-task
 * scenarios can run in CI without a live model:
 *
 * - record mode: forwards every request to the real upstream and tees each
 *   request/response pair into a tape file (JSONL, optionally gzipped).
 * - replay mode: answers from the tape, never touching the network. Matching
 *   is strict by default — the Nth request must hash-match the Nth tape
 *   entry — so any drift in prompt assembly, tool results, or request
 *   ordering fails the run loudly.
 *
 * Machine independence: the workspace absolute path is normalized to a
 * placeholder before hashing, and recorded responses are rewritten from the
 * record-time workspace path to the replay-time one before serving.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';

export const WORK_DIR_PLACEHOLDER = '<PI_REPLAY_WORKDIR>';
export const REPO_ROOT_PLACEHOLDER = '<PI_REPLAY_REPOROOT>';
const REQUEST_SNIPPET_LENGTH = 4096;
/**
 * Stored body segments per entry: the head pins down request shape and the
 * tail is where fresh transcript content (and drift) appears. The hash
 * always covers the full normalized body; replay never reads the segments.
 */
const REQUEST_HEAD_STORAGE_LENGTH = 8_192;
const REQUEST_TAIL_STORAGE_LENGTH = 24_576;
/** Per-SSE-event delay when replaying, mimicking live streaming pace. */
const SSE_REPLAY_PACE_MS = 2;

export interface PiProviderTapeEntry {
  seq: number;
  method: string;
  path: string;
  requestBodyHash: string;
  /** Full body length before truncation. */
  requestBodyLength?: number;
  /** First bytes of the normalized request body (request shape, system prompt). */
  requestHead?: string;
  /** Last bytes of the normalized request body (where fresh drift appears). */
  requestTail?: string;
  /** Legacy single-segment body (v0/v1 tapes). */
  requestBody?: string;
  requestSnippet: string;
  status: number;
  contentType: string;
  responseBody: string;
}

export interface PiProviderTapeHeader {
  header: true;
  version: 1;
  scenario: string;
  recordedAt: string;
  upstream: string;
  workDir: string;
  /** Repo checkout root at record time; error text can embed it. */
  repoRoot?: string;
  entryCount: number;
}

export interface PiProviderTapeMiss {
  seq: number;
  reason: 'hash_mismatch' | 'out_of_tape';
  expectedSnippet: string;
  actualSnippet: string;
}

export interface PiProviderTapeServerOptions {
  mode: 'record' | 'replay';
  scenario: string;
  /** Replay-time workspace path; normalized away for hashing. */
  workDir: string;
  /** Record mode: real provider origin, e.g. http://172.18.6.119:8080. */
  upstream?: string;
  /**
   * Record mode: bearer token for the upstream provider. Sent as a request
   * header only — never written into the tape, so replays need no credential.
   */
  upstreamApiKey?: string;
  /** Tape file path (.jsonl or .jsonl.gz). Required in both modes. */
  tapePath: string;
  /** Replay mode: 'strict' requires seq+hash match; 'sequential' ignores hashes. */
  matchMode?: 'strict' | 'sequential';
  /** Repo checkout root at runtime; defaults to process.cwd(). */
  repoRoot?: string;
  /** Replay mode: dump actual request bodies here when a miss occurs. */
  debugDumpDir?: string;
  /** Replay mode: dump EVERY actual request body here (tape regeneration aid). */
  dumpAllRequestsDir?: string;
}

const hashBody = (body: string): string => createHash('sha256').update(body, 'utf8').digest('hex');

/**
 * Volatile metadata rows produced by the ls tool (permissions, link count,
 * owner, size, mtime) embedded in JSON-escaped form inside request bodies.
 * The file names that follow are the deterministic payload and stay intact.
 * The row may also open a tool-result string directly (no preceding newline),
 * so a JSON value boundary quotes in as an anchor too.
 */
const LS_METADATA_ROW_PATTERN =
  /((?:^|\\n|"))[dlbcdps-][rwxstST-]{9}\+?\s+\d+\s+\S+\s+\S+\s+\d+\s+\w{3}\s+\d{1,2}\s+[\d:]{4,5}/g;

/**
 * The `ls -l` block-total line (`total 12`) varies with the filesystem (block
 * size, allocation strategy) between the record and replay machines. The
 * metadata rows are already collapsed to <LS-META>; anchor on that placeholder
 * — or on a normalized directory header for empty listings — and blank the
 * number so only deterministic content reaches the hash.
 */
const LS_BLOCK_TOTAL_PATTERN =
  /total \d+(?=\\n(?:<LS-META>|<PI_REPLAY_WORKDIR>|<PI_REPLAY_REPOROOT>))/g;
const LS_BLOCK_TOTAL_PLACEHOLDER = 'total <LS-BLOCKS>';

/** Blank filesystem-dependent `ls -l` block totals after row normalization. */
export function normalizeLsBlockTotals(normalizedBody: string): string {
  return normalizedBody.replace(LS_BLOCK_TOTAL_PATTERN, LS_BLOCK_TOTAL_PLACEHOLDER);
}

const isGzipPath = (tapePath: string): boolean => tapePath.endsWith('.gz');

export class PiProviderTapeServer {
  private server: http.Server | null = null;
  private readonly entries: PiProviderTapeEntry[] = [];
  private readonly header: PiProviderTapeHeader;
  private readonly misses: PiProviderTapeMiss[] = [];
  private replayCursor = 0;

  private constructor(private readonly options: PiProviderTapeServerOptions) {
    this.header = {
      header: true,
      version: 1,
      scenario: options.scenario,
      recordedAt: new Date().toISOString(),
      upstream: options.upstream ?? '',
      workDir: options.workDir,
      repoRoot: process.cwd(),
      entryCount: 0,
    };
  }

  static async start(options: PiProviderTapeServerOptions): Promise<PiProviderTapeServer> {
    const tape = new PiProviderTapeServer(options);
    if (options.mode === 'replay') tape.loadTape();
    const server = http.createServer((req, res) => {
      void tape.handleRequest(req, res);
    });
    tape.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    return tape;
  }

  get port(): number {
    if (!this.server) throw new Error('tape server is not listening');
    return (this.server.address() as AddressInfo).port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}/v1`;
  }

  get missCount(): number {
    return this.misses.length;
  }

  get consumedEntries(): number {
    return this.replayCursor;
  }

  get totalEntries(): number {
    return this.entries.length;
  }

  describeMisses(): string {
    return this.misses
      .map(
        miss =>
          `seq ${miss.seq} ${miss.reason}: expected ${miss.expectedSnippet} | actual ${miss.actualSnippet}`,
      )
      .join('\n');
  }

  async close(): Promise<void> {
    if (this.options.mode === 'record') this.flushTape();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }

  private normalize(body: string): string {
    let normalized = body
      .split(this.options.workDir)
      .join(WORK_DIR_PLACEHOLDER)
      .replace(LS_METADATA_ROW_PATTERN, '$1<LS-META>');
    // Error text (module resolution failures, stack traces) can embed the
    // repo checkout path; it differs between record and replay machines.
    const recordedRepoRoot = this.header.repoRoot;
    if (recordedRepoRoot) {
      normalized = normalized.split(recordedRepoRoot).join(REPO_ROOT_PLACEHOLDER);
    }
    const runtimeRepoRoot = this.options.repoRoot ?? process.cwd();
    if (runtimeRepoRoot && runtimeRepoRoot !== recordedRepoRoot) {
      normalized = normalized.split(runtimeRepoRoot).join(REPO_ROOT_PLACEHOLDER);
    }
    return normalizeLsBlockTotals(normalized);
  }

  private loadTape(): void {
    const raw = fs.readFileSync(this.options.tapePath);
    const text = isGzipPath(this.options.tapePath)
      ? zlib.gunzipSync(raw).toString('utf8')
      : raw.toString('utf8');
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    for (const [index, line] of lines.entries()) {
      const parsed = JSON.parse(line) as PiProviderTapeHeader | PiProviderTapeEntry;
      if (index === 0 && 'header' in parsed) {
        this.header.upstream = parsed.upstream;
        this.header.workDir = parsed.workDir;
        this.header.scenario = parsed.scenario;
        this.header.recordedAt = parsed.recordedAt;
        this.header.repoRoot = parsed.repoRoot;
        continue;
      }
      this.entries.push(parsed as PiProviderTapeEntry);
    }
  }

  private flushTape(): void {
    this.header.entryCount = this.entries.length;
    const text =
      [JSON.stringify(this.header), ...this.entries.map(entry => JSON.stringify(entry))].join(
        '\n',
      ) + '\n';
    fs.mkdirSync(path.dirname(this.options.tapePath), { recursive: true });
    if (isGzipPath(this.options.tapePath)) {
      fs.writeFileSync(this.options.tapePath, zlib.gzipSync(Buffer.from(text, 'utf8')));
    } else {
      fs.writeFileSync(this.options.tapePath, text, 'utf8');
    }
  }

  private dumpActualBody(seq: number, body: string): void {
    const dir = this.options.debugDumpDir;
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `seq-${seq}-actual.json`), this.normalize(body), 'utf8');
    } catch (error) {
      console.warn(`[PiTape] failed to dump actual request body for seq ${seq}:`, error);
    }
  }

  private dumpEveryBody(seq: number, body: string): void {
    const dir = this.options.dumpAllRequestsDir;
    if (!dir) return;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `seq-${seq}.json`), this.normalize(body), 'utf8');
    } catch (error) {
      console.warn(`[PiTape] failed to dump request body for seq ${seq}:`, error);
    }
  }

  /**
   * Logs the tail messages of an actual request so CI logs reveal what
   * diverged even though the tape stores only truncated expected bodies.
   */
  private logRequestTail(seq: number, body: string): void {
    try {
      const parsed = JSON.parse(body) as { messages?: Array<Record<string, unknown>> };
      const messages = parsed.messages ?? [];
      console.error(
        `[PiTape] seq ${seq} actual request: ${messages.length} messages, ${body.length} chars; tail:`,
      );
      for (const message of messages.slice(-6)) {
        const content = message.content;
        const textValue = Array.isArray(content)
          ? content
              .map(part =>
                part && typeof part === 'object' && 'text' in part ? String(part.text) : '',
              )
              .join(' ')
          : String(content ?? '');
        console.error(
          `[PiTape]   role=${String(message.role)} name=${String(message.name ?? '')} len=${textValue.length} :: ${textValue.slice(0, 300).replaceAll('\n', ' | ')}`,
        );
      }
    } catch {
      console.error(
        `[PiTape] seq ${seq} actual request is not parseable JSON (${body.length} chars)`,
      );
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
    if (this.options.mode === 'record') {
      await this.forwardAndRecord(req, res, body);
      return;
    }
    await this.serveFromTape(req, res, body);
  }

  private async forwardAndRecord(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string,
  ): Promise<void> {
    const upstream = this.options.upstream;
    if (!upstream) throw new Error('record mode requires an upstream origin');
    const headers: Record<string, string> = {
      'content-type': req.headers['content-type'] ?? 'application/json',
    };
    if (this.options.upstreamApiKey)
      headers.authorization = `Bearer ${this.options.upstreamApiKey}`;
    const response = await fetch(`${upstream}${req.url}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const responseBody = await response.text();
    const contentType = response.headers.get('content-type') ?? 'application/json';
    const normalizedBody = this.normalize(body);
    this.entries.push({
      seq: this.entries.length,
      method: req.method ?? 'POST',
      path: req.url ?? '/',
      requestBodyHash: hashBody(normalizedBody),
      requestBodyLength: normalizedBody.length,
      requestHead: normalizedBody.slice(0, REQUEST_HEAD_STORAGE_LENGTH),
      requestTail: normalizedBody.slice(-REQUEST_TAIL_STORAGE_LENGTH),
      requestSnippet: normalizedBody.slice(0, REQUEST_SNIPPET_LENGTH),
      status: response.status,
      contentType,
      responseBody,
    });
    // A crashed recording must not lose everything captured so far: flush
    // incrementally instead of only at close.
    this.flushTape();
    res.writeHead(response.status, { 'content-type': contentType });
    res.end(responseBody);
  }

  private async serveFromTape(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: string,
  ): Promise<void> {
    const seq = this.replayCursor;
    this.dumpEveryBody(seq, body);
    const actualHash = hashBody(this.normalize(body));
    const entry = this.entries[seq];
    if (!entry) {
      this.misses.push({
        seq,
        reason: 'out_of_tape',
        expectedSnippet: '<none>',
        actualSnippet: this.normalize(body).slice(0, REQUEST_SNIPPET_LENGTH),
      });
      this.logRequestTail(seq, body);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `replay tape exhausted at seq ${seq}` }));
      return;
    }
    const strict = (this.options.matchMode ?? 'strict') === 'strict';
    if (entry.requestBodyHash !== actualHash) {
      if (!strict) {
        console.warn(
          `[PiTape] seq ${seq} hash mismatch tolerated in sequential mode (expected ${entry.requestBodyHash.slice(0, 12)}, actual ${actualHash.slice(0, 12)})`,
        );
      } else {
        this.misses.push({
          seq,
          reason: 'hash_mismatch',
          expectedSnippet: entry.requestTail ?? entry.requestSnippet,
          actualSnippet: this.normalize(body).slice(0, REQUEST_SNIPPET_LENGTH),
        });
        this.dumpActualBody(seq, body);
        this.logRequestTail(seq, body);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `replay request drifted at seq ${seq}` }));
        return;
      }
    }
    this.replayCursor += 1;
    // Rewrite record-time workspace paths so replayed tool calls (and any
    // model text echoing paths) target the replay-time workspace.
    const recorded = this.header.workDir;
    const responseBody =
      recorded && recorded !== this.options.workDir
        ? entry.responseBody.split(recorded).join(this.options.workDir)
        : entry.responseBody;
    // Pace SSE streams like a real model: serving 200 responses back-to-back
    // instantly floods the event projection queue (4096 backlog limit) in a
    // way no live provider can.
    if (entry.contentType.includes('text/event-stream')) {
      res.writeHead(entry.status, { 'content-type': entry.contentType });
      const chunks = responseBody.split('\n\n').filter(chunk => chunk.trim().length > 0);
      for (const chunk of chunks) {
        res.write(`${chunk}\n\n`);
        await new Promise(resolve => setTimeout(resolve, SSE_REPLAY_PACE_MS));
      }
      res.end();
      return;
    }
    res.writeHead(entry.status, { 'content-type': entry.contentType });
    res.end(responseBody);
  }
}
