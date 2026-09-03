import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export type Variant = 'baseline' | 'compiler';

interface HistoricalTurn {
  readonly body: string;
  readonly id: number;
  readonly toolName: string;
}

export interface BenchmarkResult {
  readonly commitDurations: number[];
  readonly text: string;
}

export interface BenchmarkControl {
  run: (warmups: number, updates: number) => BenchmarkResult;
}

const HISTORICAL_TURNS: readonly HistoricalTurn[] = Array.from({ length: 180 }, (_, id) => ({
  body: `Historical response ${id}: inspect the workspace, derive an execution plan, and retain the evidence.`,
  id,
  toolName: id % 3 === 0 ? 'read_file' : id % 3 === 1 ? 'run_command' : 'search',
}));

function measureUpdates(
  setTick: React.Dispatch<React.SetStateAction<number>>,
  warmups: number,
  updates: number,
): BenchmarkResult {
  for (let index = 0; index < warmups; index += 1) {
    flushSync(() => setTick(previous => previous + 1));
  }

  const commitDurations: number[] = [];
  for (let index = 0; index < updates; index += 1) {
    const startedAt = performance.now();
    flushSync(() => setTick(previous => previous + 1));
    commitDurations.push(performance.now() - startedAt);
  }

  return {
    commitDurations,
    text: document.body.textContent?.replaceAll(/\s+/g, ' ').trim() ?? '',
  };
}

interface WorkloadProps {
  readonly onReady: (control: BenchmarkControl) => void;
}

interface MessageTreeProps {
  readonly tick: number;
}

function renderTurn(turn: HistoricalTurn): React.ReactNode {
  return (
    <article aria-label={`turn-${turn.id}`} className="turn">
      <header>
        <strong>Assistant</strong>
        <span>#{turn.id}</span>
      </header>
      <p>{turn.body}</p>
      <footer>tool: {turn.toolName}</footer>
    </article>
  );
}

function BaselineMessageTree({ tick }: MessageTreeProps): React.ReactNode {
  return (
    <section aria-label="cowork-benchmark">
      {HISTORICAL_TURNS.map(renderTurn)}
      <article aria-label="streaming-turn" className="streaming-turn">
        <header>
          <strong>Assistant</strong>
          <span>stream {tick}</span>
        </header>
        <p>Streaming token {tick} keeps the conversation active.</p>
        <footer>tool: run_command · artifact revision {tick % 7}</footer>
      </article>
    </section>
  );
}

function CompilerMessageTree({ tick }: MessageTreeProps): React.ReactNode {
  'use memo';

  return (
    <section aria-label="cowork-benchmark">
      {HISTORICAL_TURNS.map(renderTurn)}
      <article aria-label="streaming-turn" className="streaming-turn">
        <header>
          <strong>Assistant</strong>
          <span>stream {tick}</span>
        </header>
        <p>Streaming token {tick} keeps the conversation active.</p>
        <footer>tool: run_command · artifact revision {tick % 7}</footer>
      </article>
    </section>
  );
}

function BenchmarkWorkload({
  MessageTree,
  onReady,
}: WorkloadProps & {
  readonly MessageTree: (props: MessageTreeProps) => React.ReactNode;
}): React.ReactNode {
  const [tick, setTick] = useState(0);
  const controlRef = useRef<BenchmarkControl | null>(null);

  if (!controlRef.current) {
    controlRef.current = {
      run(warmups, updates) {
        return measureUpdates(setTick, warmups, updates);
      },
    };
  }
  onReady(controlRef.current);

  return <MessageTree tick={tick} />;
}

export function BaselineWorkload({ onReady }: WorkloadProps): React.ReactNode {
  return <BenchmarkWorkload MessageTree={BaselineMessageTree} onReady={onReady} />;
}

export function CompilerWorkload({ onReady }: WorkloadProps): React.ReactNode {
  return <BenchmarkWorkload MessageTree={CompilerMessageTree} onReady={onReady} />;
}
