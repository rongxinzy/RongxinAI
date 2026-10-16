'use client';

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from '@shared/components/ai-elements/chain-of-thought';
import { ToolOutput } from '@shared/components/ai-elements/tool';
import { BrainIcon, CheckCircleIcon, SparklesIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import React from 'react';

import { i18nService } from '../../../services/i18n';
import type { CoworkMessage } from '../../../types/cowork';
import type { AssistantTurnItem } from '../helpers/messageGrouping';
import { collapseToolText, getToolResultDisplay, hasText } from '../helpers/toolUtils';
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
          {`${i18nService.t('reasoning')} (${stepCount})`}
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
                  label={i18nService.t('reasoning')}
                  status="complete"
                >
                  {hasText(text) && (
                    <div className="theme-reasoning-panel max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {text}
                    </div>
                  )}
                </ChainOfThoughtStep>
              );
            }

            // ── Orphan tool result: render as step with the execution output ──
            if (item.type === 'tool_result') {
              const msg = item.message;
              const rawDisplay = mapDisplayText
                ? mapDisplayText(getToolResultDisplay(msg))
                : getToolResultDisplay(msg);
              const display = collapseToolText(rawDisplay).preview;
              const isError = Boolean(msg.metadata?.isError || msg.metadata?.error);
              const label = isError
                ? i18nService.t('codingAgentToolFailed')
                : i18nService.t('coworkToolResult');

              return (
                <ChainOfThoughtStep
                  key={msg.id}
                  icon={CheckCircleIcon}
                  label={label}
                  status="complete"
                >
                  {hasText(display) && (
                    <ToolOutput
                      output={isError ? undefined : display}
                      errorText={isError ? display : undefined}
                    />
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
                  <ToolCard group={item.group} mapDisplayText={mapDisplayText} />
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
