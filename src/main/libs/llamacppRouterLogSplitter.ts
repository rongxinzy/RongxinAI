import { createLlamaCppModelRuntimeLogWriter } from './llamacppModelRuntimeLog';

/**
 * Child output is forwarded by the router as LOG("[%5d] %s", port, line), so a
 * five-digit port reads `[33623] ` and a shorter one is space-padded (`[ 8081] `).
 */
const CHILD_LINE_PATTERN = /^\[\s?(\d{1,5})\]\s?(.*)$/;
/** Router spawn notice: `... load: spawning server instance with name=smol on port 49651`. */
const SPAWN_LINE_PATTERN = /spawning server instance with name=(\S+) on port (\d+)/;
const SPAWN_ARGS_HEADER_PATTERN = /spawning server instance with args:/;
/** Arg block lines look like `... load:   --host` (the value is indented past `load:`). */
const SPAWN_ARGS_CONTINUATION_PATTERN = /\bload:\s{2,}\S/;

export const DEFAULT_LLAMACPP_ROUTER_LOG_TAIL_LINES = 200;

export type LlamaCppRouterModelLogWriter = {
  filePath: string;
  append: (text: string) => Promise<void>;
};

export type LlamaCppRouterLogSplitterOptions = {
  userDataPath: string;
  /** In-memory tail capacity per model spawn; defaults to DEFAULT_LLAMACPP_ROUTER_LOG_TAIL_LINES. */
  tailLines?: number;
  /** Overrides the file writer for tests. */
  createWriter?: (input: { modelName: string }) => LlamaCppRouterModelLogWriter;
  /** Receives router lines and unknown-port lines that cannot be attributed to a model. */
  onUnattributedLine?: (line: string) => void;
};

type ActiveSpawn = {
  modelName: string;
  writer: LlamaCppRouterModelLogWriter;
  tail: string[];
};

/**
 * Splits llama-server router stdout into per-model launch logs. The router
 * prefixes every child line with the child's port and announces spawns with a
 * `spawning server instance with name=X on port P` line, so the port->model
 * mapping is rebuilt in arrival order; ports are reused over time and each new
 * spawn line supersedes the previous mapping. Each spawn opens a new log file
 * via createLlamaCppModelRuntimeLogWriter, so files land in
 * logs/llamacpp/model-launch/<model>_<ts>.txt exactly like the per-model daemon
 * path, and the in-memory tail of the most recent spawn feeds the load-error
 * classifier.
 */
export class LlamaCppRouterLogSplitter {
  private readonly options: LlamaCppRouterLogSplitterOptions;
  private readonly tailCapacity: number;
  private readonly createWriter: (input: { modelName: string }) => LlamaCppRouterModelLogWriter;
  private readonly portToSpawn = new Map<number, ActiveSpawn>();
  private readonly modelToSpawn = new Map<string, ActiveSpawn>();
  private readonly pendingWrites = new Set<Promise<void>>();
  private argsBlockSpawn: ActiveSpawn | null = null;
  private partialLine = '';

  constructor(options: LlamaCppRouterLogSplitterOptions) {
    this.options = options;
    this.tailCapacity = options.tailLines ?? DEFAULT_LLAMACPP_ROUTER_LOG_TAIL_LINES;
    this.createWriter =
      options.createWriter ??
      (input =>
        createLlamaCppModelRuntimeLogWriter({ userDataPath: options.userDataPath, ...input }));
  }

  /** Accepts router stdout/stderr chunks; chunks may split lines at any boundary. */
  appendChunk(chunk: string): void {
    if (!chunk) return;
    this.partialLine += chunk;
    const lines = this.partialLine.split(/\r?\n/);
    this.partialLine = lines.pop() ?? '';
    for (const line of lines) {
      this.processLine(line);
    }
  }

  /** Processes a trailing partial line once the stream ends. */
  flush(): void {
    if (!this.partialLine) return;
    const line = this.partialLine;
    this.partialLine = '';
    this.processLine(line);
  }

  /** Resolves when every queued file append has settled. */
  async idle(): Promise<void> {
    while (this.pendingWrites.size > 0) {
      await Promise.all(Array.from(this.pendingWrites));
    }
  }

  /** Tail of the most recent spawn of a model, in chronological order. */
  getRecentLines(modelName: string, maxLines: number = this.tailCapacity): string[] {
    const spawn = this.modelToSpawn.get(modelName.trim());
    if (!spawn) return [];
    const limit = Math.max(0, maxLines);
    return spawn.tail.slice(Math.max(0, spawn.tail.length - limit));
  }

  getCurrentLogFilePath(modelName: string): string | undefined {
    return this.modelToSpawn.get(modelName.trim())?.writer.filePath;
  }

  private processLine(line: string): void {
    const spawnMatch = SPAWN_LINE_PATTERN.exec(line);
    if (spawnMatch) {
      this.beginSpawn(spawnMatch[1], Number.parseInt(spawnMatch[2], 10), line);
      return;
    }

    const childMatch = CHILD_LINE_PATTERN.exec(line);
    if (childMatch) {
      const spawn = this.portToSpawn.get(Number.parseInt(childMatch[1], 10));
      if (spawn) {
        this.writeLine(spawn, childMatch[2]);
      } else {
        this.options.onUnattributedLine?.(line);
      }
      return;
    }

    if (this.argsBlockSpawn) {
      if (SPAWN_ARGS_HEADER_PATTERN.test(line) || SPAWN_ARGS_CONTINUATION_PATTERN.test(line)) {
        this.writeLine(this.argsBlockSpawn, line);
        return;
      }
      // First router line outside the args block ends the spawn context.
      this.argsBlockSpawn = null;
    }

    this.options.onUnattributedLine?.(line);
  }

  private beginSpawn(modelName: string, port: number, spawnLine: string): void {
    // A new spawn on this port supersedes the previous mapping; the previous
    // model's log for the port simply stops receiving lines.
    const writer = this.createWriter({ modelName });
    const spawn: ActiveSpawn = { modelName, writer, tail: [] };
    this.portToSpawn.set(port, spawn);
    this.modelToSpawn.set(modelName, spawn);
    this.argsBlockSpawn = spawn;
    this.writeLine(spawn, spawnLine);
  }

  private writeLine(spawn: ActiveSpawn, line: string): void {
    spawn.tail.push(line);
    if (spawn.tail.length > this.tailCapacity) {
      spawn.tail.splice(0, spawn.tail.length - this.tailCapacity);
    }
    const append = spawn.writer
      .append(`${line}\n`)
      .catch(error => {
        console.warn('[LlamaCppRouterLog] failed to append model log line:', error);
      })
      .then(() => {
        this.pendingWrites.delete(append);
      });
    this.pendingWrites.add(append);
  }
}
