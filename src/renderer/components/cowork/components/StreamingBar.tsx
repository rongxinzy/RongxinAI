import React from 'react';

import { i18nService } from '../../../services/i18n';
import type { CoworkMessage } from '../../../types/cowork';

export const TypingDots: React.FC = () => (
  <div className="flex items-center space-x-1.5 py-1">
    <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
    <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
    <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
  </div>
);

export const ArtifactPanelIcon: React.FC<React.SVGProps<SVGSVGElement> & { open?: boolean }> = ({ open, ...props }) => {
  const dividerX = open ? 10.5 : 12.5;
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="1.5" y="2" width="13" height="12" rx="2" />
      <line x1={dividerX} y1="2" x2={dividerX} y2="14" />
    </svg>
  );
};

/** Bottom status bar showing current tool execution progress. */
export const StreamingBar: React.FC<{ messages: CoworkMessage[] }> = ({ messages }) => {
  const getStatusText = (): string => {
    const toolUseIds = new Set<string>();
    const toolResultIds = new Set<string>();
    for (const msg of messages) {
      const id = msg.metadata?.toolUseId;
      if (typeof id === 'string') {
        if (msg.type === 'tool_result') toolResultIds.add(id);
        if (msg.type === 'tool_use') toolUseIds.add(id);
      }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'tool_use') {
        const id = msg.metadata?.toolUseId;
        if (typeof id === 'string' && !toolResultIds.has(id)) {
          const toolName = typeof msg.metadata?.toolName === 'string' ? msg.metadata.toolName : null;
          if (toolName) return `${i18nService.t('coworkToolRunning')} ${toolName}...`;
        }
      }
    }
    return `${i18nService.t('coworkToolRunning')}`;
  };

  return (
    <div className="shrink-0 animate-fade-in px-4">
      <div className="max-w-5xl min-w-[320px] mx-auto">
        <div className="streaming-bar" />
        <div className="py-1">
          <span className="text-xs text-muted-foreground">{getStatusText()}</span>
        </div>
      </div>
    </div>
  );
};
