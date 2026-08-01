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
 * (issue #141).
 */
export const PersistentReasoning: React.FC<PersistentProps<ReasoningProps>> = ({
  persistKey,
  defaultOpen = false,
  ...props
}) => {
  const [open, setOpen] = usePersistentToggle(persistKey, defaultOpen);
  return <Reasoning {...props} open={open} onOpenChange={setOpen} />;
};

export const PersistentChainOfThought: React.FC<PersistentProps<ChainOfThoughtProps>> = ({
  persistKey,
  defaultOpen = false,
  ...props
}) => {
  const [open, setOpen] = usePersistentToggle(persistKey, defaultOpen);
  return <ChainOfThought {...props} open={open} onOpenChange={setOpen} />;
};
