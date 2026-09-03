import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useCallback, useRef, useState } from 'react';

import {
  BaselineWorkload,
  type BenchmarkControl,
  CompilerWorkload,
  type Variant,
} from './workload';

declare global {
  interface Window {
    reactCompilerBenchmark?: {
      run: (
        variant: Variant,
        warmups: number,
        updates: number,
      ) => ReturnType<BenchmarkControl['run']>;
    };
  }
}

function App(): React.ReactNode {
  const [variant, setVariant] = useState<Variant>('baseline');
  const controlRef = useRef<BenchmarkControl | null>(null);
  const setControl = useCallback((control: BenchmarkControl) => {
    controlRef.current = control;
  }, []);

  window.reactCompilerBenchmark = {
    run(nextVariant, warmups, updates) {
      flushSync(() => setVariant(nextVariant));
      if (!controlRef.current) throw new Error('Benchmark workload did not initialize.');
      return controlRef.current.run(warmups, updates);
    },
  };

  return variant === 'baseline' ? (
    <BaselineWorkload onReady={setControl} />
  ) : (
    <CompilerWorkload onReady={setControl} />
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('Benchmark root is missing.');

createRoot(container).render(<App />);
