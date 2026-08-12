'use client';

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from '@shared/components/ai-elements/chain-of-thought';
import { BrainIcon, CheckCircleIcon, SparklesIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import React from 'react';

import { i18nService } from '../../../services/i18n';
import type { CoworkMessage } from '../../../types/cowork';
import type { AssistantTurnItem } from '../helpers/messageGrouping';
import { getToolResultLineCount } from '../helpers/messageGrouping';
import { getToolResultDisplay, hasText } from '../helpers/toolUtils';
import { ToolCard } from './ToolCard';

// ── helpers ──

interface ToolSearchResult {
  server: string;
  name: string;
  description: string;
}

/**
 * Parse MCP proxy tool search results from a tool result message.
 * Detects the format: [server] name: description (one per line).
 */
function parseMcpSearchResults(message: CoworkMessage): ToolSearchResult[] {
  try {
    const raw = (message.metadata?.toolResult as string | undefined) ?? message.content;
    if (!raw) return [];
    // Try parsing as JSON in case the result is a JSON string
    let text = raw;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed))
        text = parsed.map((c: { text?: string }) => c.text ?? '').join('\n');
      else if (parsed.content) {
        text = Array.isArray(parsed.content)
          ? parsed.content.map((c: { text?: string }) => c.text ?? '').join('\n')
          : String(parsed.content);
      }
    } catch {
      /* not JSON, use raw */
    }
    const lines = text.split('\n').filter(Boolean);
    const results: ToolSearchResult[] = [];
    for (const line of lines) {
      const match = line.match(/^\[(.+?)\]\s+(.+?):\s+(.+)$/);
      if (match) {
        results.push({ server: match[1], name: match[2], description: match[3] });
      }
    }
    return results;
  } catch {
    return [];
  }
}

function isMcpProxyTool(message: CoworkMessage): boolean {
  return typeof message.metadata?.toolName === 'string' && message.metadata.toolName === 'mcp';
}

function isMcpSearchCall(message: CoworkMessage): boolean {
  if (!isMcpProxyTool(message)) return false;
  const input = message.metadata?.toolInput as Record<string, unknown> | undefined;
  if (!input) return false;
  return typeof input.search === 'string' && input.search.length > 0;
}

// ── component ──

export const CoworkChain: React.FC<{
  items: AssistantTurnItem[];
  mapDisplayText?: (value: string) => string;
  children: ReactNode;
}> = ({ items, mapDisplayText, children }) => {
  const stepCount = items.length;

  if (stepCount === 0) {
    return <>{children}</>;
  }

  const formatText = (value: string) => (mapDisplayText ? mapDisplayText(value) : value);

  return (
    <>
      <ChainOfThought defaultOpen={false}>
        <ChainOfThoughtHeader icon={SparklesIcon}>
          {`工作过程 (${stepCount} 步)`}
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {items.map(item => {
            // ── Thinking: render as ChainOfThoughtStep ──
            if (item.type === 'assistant' && item.message.metadata?.isThinking) {
              const msg = item.message;
              const text = formatText(msg.content);
              return (
                <ChainOfThoughtStep
                  key={msg.id}
                  icon={BrainIcon}
                  label="思考分析"
                  status="complete"
                >
                  {hasText(text) && (
                    <div className="text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto rounded bg-muted/50 p-2">
                      {text}
                    </div>
                  )}
                </ChainOfThoughtStep>
              );
            }

            // ── Orphan tool result: render as step with the execution output ──
            if (item.type === 'tool_result') {
              const msg = item.message;
              const display = mapDisplayText
                ? mapDisplayText(getToolResultDisplay(msg))
                : getToolResultDisplay(msg);
              const lineCount = getToolResultLineCount(display);
              const isError = Boolean(msg.metadata?.isError || msg.metadata?.error);
              const label = isError
                ? i18nService.t('coworkToolNoErrorDetail')
                : i18nService.t('coworkToolResult');
              const desc =
                lineCount > 0
                  ? `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} of output`
                  : undefined;

              return (
                <ChainOfThoughtStep
                  key={msg.id}
                  icon={CheckCircleIcon}
                  label={label}
                  description={desc}
                  status="complete"
                >
                  {hasText(display) && (
                    <div className="mt-1 px-3 py-2 rounded-lg bg-surface-raised max-h-64 overflow-y-auto">
                      <pre
                        className={`text-xs whitespace-pre-wrap wrap-break-word font-mono ${
                          isError ? 'text-red-500' : 'text-foreground'
                        }`}
                      >
                        {display}
                      </pre>
                    </div>
                  )}
                </ChainOfThoughtStep>
              );
            }

            // ── Tool call: render ToolCard directly in the chain ──
            if (item.type === 'tool_group') {
              const toolUseMsg = item.group.toolUse;
              const toolResultMsg = item.group.toolResult;
              const hasResult = Boolean(toolResultMsg);
              const isMcpSearch = hasResult && isMcpSearchCall(toolUseMsg);
              const searchResults = hasResult ? parseMcpSearchResults(toolResultMsg!) : [];

              return (
                <React.Fragment key={toolUseMsg.id}>
                  {isMcpSearch && searchResults.length > 0 && (
                    <ChainOfThoughtSearchResults>
                      {searchResults.map(r => (
                        <ChainOfThoughtSearchResult key={`${r.server}/${r.name}`}>
                          {r.name}
                        </ChainOfThoughtSearchResult>
                      ))}
                    </ChainOfThoughtSearchResults>
                  )}
                  <ToolCard
                    group={item.group}
                    isLastInSequence={true}
                    mapDisplayText={mapDisplayText}
                  />
                </React.Fragment>
              );
            }

            return null;
          })}
        </ChainOfThoughtContent>
      </ChainOfThought>

      {/* final visible answer — outside the collapsed chain */}
      {children}
    </>
  );
};
