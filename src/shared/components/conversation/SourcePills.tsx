import { cn } from '@shared/lib/utils';
import { ExternalLink, Globe } from 'lucide-react';

export interface SourceItem {
  url: string;
  title?: string;
  snippet?: string;
}

const getDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export interface SourcePillsProps {
  sources: SourceItem[];
  className?: string;
}

/**
 * Compact web citation pill row inspired by prompt-kit Source.
 */
export function SourcePills({ sources, className }: SourcePillsProps) {
  if (sources.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {sources.map(source => {
        const domain = getDomain(source.url);
        const label = source.title?.trim() || domain;
        return (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.snippet ? `${label} — ${source.snippet}` : source.url}
            className="inline-flex h-7 max-w-60 items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Globe className="size-3 shrink-0" />
            <span className="truncate font-medium text-foreground/90">{label}</span>
            <ExternalLink className="size-2.5 shrink-0 opacity-60" />
          </a>
        );
      })}
    </div>
  );
}
