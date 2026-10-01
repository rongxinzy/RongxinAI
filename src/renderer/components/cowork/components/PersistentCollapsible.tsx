import {
  ChainOfThought,
  type ChainOfThoughtProps,
} from '@shared/components/ai-elements/chain-of-thought';
import { Reasoning, type ReasoningProps } from '@shared/components/ai-elements/reasoning';
import React from 'react';

import { usePersistentToggle } from '../hooks/usePersistentToggle';

type PersistentProps<P> = P & { persistKey: string };

/**
 * ChainOfThought/Reasoning whose expansion state survives unmounts. Turn
 * rows unmount under virtualization and remount during image export;
 * without persistence every collapsed/expanded block would reset
 * (issue #141). defaultOpen is forwarded so the wrapped component keeps
 * its own streaming heuristics.
 */
export const PersistentReasoning: React.FC<PersistentProps<ReasoningProps>> = ({
  persistKey,
  defaultOpen = false,
  ...props
}) => {
  const [open, setOpen] = usePersistentToggle(persistKey, defaultOpen);
  return <Reasoning {...props} defaultOpen={defaultOpen} open={open} onOpenChange={setOpen} />;
};

export const PersistentChainOfThought: React.FC<
  PersistentProps<ChainOfThoughtProps> & {
    forceOpen?: boolean;
    /**
     * Renders the header with the resolved expansion state. The header is the
     * only place that knows whether the block is open, which decides whether an
     * inner indicator (streaming reasoning) already owns the running shimmer.
     */
    renderHeader?: (isOpen: boolean) => React.ReactNode;
  }
> = ({ persistKey, defaultOpen = false, forceOpen = false, renderHeader, children, ...props }) => {
  // 2026/09/16 lixiang  等待工具授权时强制展开思考过程，避免按钮被折叠藏住
  const [open, setOpen] = usePersistentToggle(persistKey, defaultOpen);
  const isOpen = forceOpen || open;
  return (
    <ChainOfThought {...props} defaultOpen={defaultOpen} open={isOpen} onOpenChange={setOpen}>
      {renderHeader ? renderHeader(isOpen) : null}
      {children}
    </ChainOfThought>
  );
};
