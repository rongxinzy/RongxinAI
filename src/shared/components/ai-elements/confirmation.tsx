'use client';

import { Alert } from '@shared/components/ui/alert';

import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import type { ToolUIPart } from 'ai';
import type { ComponentProps, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';

type ToolUIPartApproval =
  | {
      id: string;
      approved?: never;
      reason?: never;
    }
  | {
      id: string;
      approved: boolean;
      reason?: string;
    }
  | {
      id: string;
      approved: true;
      reason?: string;
    }
  | {
      id: string;
      approved: true;
      reason?: string;
    }
  | {
      id: string;
      approved: false;
      reason?: string;
    }
  | undefined;

interface ConfirmationContextValue {
  approval: ToolUIPartApproval;
  state: ToolUIPart['state'];
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(null);

const useConfirmation = () => {
  const context = useContext(ConfirmationContext);

  if (!context) {
    throw new Error('Confirmation components must be used within Confirmation');
  }

  return context;
};

export type ConfirmationProps = ComponentProps<typeof Alert> & {
  approval?: ToolUIPartApproval;
  state: ToolUIPart['state'];
};

export const Confirmation = ({ className, approval, state, ...props }: ConfirmationProps) => {
  const contextValue = useMemo(() => ({ approval, state }), [approval, state]);

  if (!approval || state === 'input-streaming' || state === 'input-available') {
    return null;
  }

  return (
    <ConfirmationContext.Provider value={contextValue}>
      <Alert className={cn('flex flex-col gap-2', className)} {...props} />
    </ConfirmationContext.Provider>
  );
};

export interface ConfirmationRequestProps {
  children?: ReactNode;
}

export const ConfirmationRequest = ({ children }: ConfirmationRequestProps) => {
  const { state } = useConfirmation();

  // Only show when approval is requested
  if (state !== 'approval-requested') {
    return null;
  }

  return children;
};

export type ConfirmationActionsProps = ComponentProps<'div'>;

export const ConfirmationActions = ({ className, ...props }: ConfirmationActionsProps) => {
  const { state } = useConfirmation();

  // Only show when approval is requested
  if (state !== 'approval-requested') {
    return null;
  }

  return (
    <div className={cn('flex items-center justify-end gap-3 self-end', className)} {...props} />
  );
};

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = (props: ConfirmationActionProps) => (
  <Button className="theme-page-confirmation-button-1" type="button" {...props} />
);
