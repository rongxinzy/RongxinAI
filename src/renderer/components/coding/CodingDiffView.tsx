import { cn } from '@shared/lib/utils';
import { memo, useMemo } from 'react';

import {
  buildLineDiffRows,
  collapseContextRows,
  CodingDiffRowType,
  type CodingDiffRow,
} from './codingDiff';

interface CodingDiffViewProps {
  path?: string;
  oldText: string;
  newText: string;
}

const ROW_CLASS: Record<CodingDiffRowType, string> = {
  [CodingDiffRowType.Add]: 'bg-diff-added-background text-diff-added',
  [CodingDiffRowType.Del]: 'bg-diff-removed-background text-diff-removed',
  [CodingDiffRowType.Context]: 'text-muted-foreground',
};

const ROW_PREFIX: Record<CodingDiffRowType, string> = {
  [CodingDiffRowType.Add]: '+',
  [CodingDiffRowType.Del]: '-',
  [CodingDiffRowType.Context]: ' ',
};

const DiffRowLine = ({ row }: { row: CodingDiffRow }) => (
  <div className={cn('flex min-w-max px-2', ROW_CLASS[row.type])}>
    <span className="w-4 shrink-0 select-none opacity-60">{ROW_PREFIX[row.type]}</span>
    <span className="whitespace-pre-wrap break-all">{row.text || ' '}</span>
  </div>
);

/** Renders an ACP `diff` tool-call content item as a colored line diff. */
const CodingDiffViewComponent = ({ path, oldText, newText }: CodingDiffViewProps) => {
  const rows = useMemo(
    () => collapseContextRows(buildLineDiffRows(oldText, newText)),
    [oldText, newText],
  );
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {path && (
        <div className="border-b border-border bg-muted/40 px-2 py-1 font-mono text-xs font-medium break-all">
          {path}
        </div>
      )}
      <div className="max-h-96 overflow-auto py-1 font-mono text-xs">
        {rows.map((row, index) =>
          row.type === 'gap' ? (
            <div
              key={`gap-${index}`}
              className="flex min-w-max items-center gap-1 px-2 text-muted-foreground/60 select-none"
            >
              <span className="w-4 shrink-0 text-center">⋮</span>
              <span>{row.count}</span>
            </div>
          ) : (
            <DiffRowLine key={index} row={row} />
          ),
        )}
      </div>
    </div>
  );
};

export const CodingDiffView = memo(CodingDiffViewComponent);
