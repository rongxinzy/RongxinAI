// @ts-nocheck — third-party ai-elements component; @base-ui/react v1.6 type mismatch with ai-elements v1.9 (openDelay/closeDelay on PreviewCard, BaseUIEvent vs Event)
'use client';

// Split from the former single-file ai-elements prompt-input.tsx (issue #1069).
// This module is the stable import surface: import from
// '@shared/components/ai-elements/prompt-input' resolves here.

export * from './provider';
export * from './prompt-input';
export * from './controls';
export * from './button';
export * from './submit';
export * from './command';
