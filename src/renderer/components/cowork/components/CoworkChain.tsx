"use client";

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@shared/components/ai-elements/chain-of-thought";
import { BrainIcon, SparklesIcon } from "lucide-react";
import type { ReactNode } from "react";
import React, { useMemo } from "react";

import type { CoworkMessage } from "../../../types/cowork";
import type { AssistantTurnItem } from "../helpers/messageGrouping";
import { hasText } from "../helpers/toolUtils";
import { ToolCard } from "./ToolCard";

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
    const raw = message.metadata?.toolResult as string | undefined
      ?? message.content;
    if (!raw) return [];
    // Try parsing as JSON in case the result is a JSON string
    let text = raw;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) text = parsed.map((c: { text?: string }) => c.text ?? "").join("\n");
      else if (parsed.content) {
        text = Array.isArray(parsed.content)
          ? parsed.content.map((c: { text?: string }) => c.text ?? "").join("\n")
          : String(parsed.content);
      }
    } catch { /* not JSON, use raw */ }
    const lines = text.split("\n").filter(Boolean);
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
  return (
    typeof message.metadata?.toolName === "string" &&
    message.metadata.toolName === "mcp"
  );
}

function isMcpSearchCall(message: CoworkMessage): boolean {
  if (!isMcpProxyTool(message)) return false;
  const input = message.metadata?.toolInput as Record<string, unknown> | undefined;
  if (!input) return false;
  return typeof input.search === "string" && input.search.length > 0;
}

// ── component ──

export const CoworkChain: React.FC<{
  items: AssistantTurnItem[];
  mapDisplayText?: (value: string) => string;
  children: ReactNode;
}> = ({ items, mapDisplayText, children }) => {
  const chainItems = useMemo(() => {
    const thinking: Array<Extract<AssistantTurnItem, { type: "assistant" }>> = [];
    const tools: Array<Extract<AssistantTurnItem, { type: "tool_group" }>> = [];

    for (const item of items) {
      if (item.type === "assistant" && item.message.metadata?.isThinking) {
        thinking.push(item);
      } else if (item.type === "tool_group") {
        tools.push(item);
      }
    }

    return { thinking, tools };
  }, [items]);

  const hasChain = chainItems.thinking.length > 0 || chainItems.tools.length > 0;
  const stepCount =
    (chainItems.thinking.length > 0 ? 1 : 0) + chainItems.tools.length;

  if (!hasChain) {
    return <>{children}</>;
  }

  const formatText = (value: string) =>
    mapDisplayText ? mapDisplayText(value) : value;

  return (
    <>
      <ChainOfThought defaultOpen={true}>
        <ChainOfThoughtHeader icon={SparklesIcon}>
          {`工作过程 (${stepCount} 步)`}
        </ChainOfThoughtHeader>
        <ChainOfThoughtContent>
          {/* ── thinking step ── */}
          {chainItems.thinking.map((item) => {
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
          })}

          {/* ── tool calls — rendered as full ToolCards directly in the chain ── */}
          {chainItems.tools.map((item) => {
            const toolUseMsg = item.group.toolUse;
            const toolResultMsg = item.group.toolResult;
            const hasResult = Boolean(toolResultMsg);
            const isMcpSearch = hasResult && isMcpSearchCall(toolUseMsg);
            const searchResults = hasResult
              ? parseMcpSearchResults(toolResultMsg!)
              : [];

            return (
              <React.Fragment key={toolUseMsg.id}>
                {/* MCP search results as badges */}
                {isMcpSearch && searchResults.length > 0 && (
                  <ChainOfThoughtSearchResults>
                    {searchResults.map((r) => (
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
          })}
        </ChainOfThoughtContent>
      </ChainOfThought>

      {/* final visible answer — outside the collapsed chain */}
      {children}
    </>
  );
};
