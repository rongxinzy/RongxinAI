import { recipe } from './recipe';
/** The size marker preserves explicit icon-size opt-outs in shared controls. */
export function classicControlPieces() {
  return {
    'control-standard-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'control-addon-icon': recipe({ base: { width: '1rem', height: '1rem' } }),
    'control-group-button-xs-icon': recipe({ base: { width: '0.875rem', height: '0.875rem' } }),
    'control-badge-leading': recipe({ base: { 'padding-left': '0.375rem' } }),
    'control-badge-trailing': recipe({ base: { 'padding-right': '0.375rem' } }),
    'control-tooltip-kbd-inset': recipe({ base: { 'padding-right': '0.375rem' } }),
    'control-command-addon-inset': recipe({ base: { 'padding-left': '0.5rem' } }),
    'control-sheet-bottom-border': recipe({ base: { 'border-top-width': '1px' } }),
    'control-sheet-left-border': recipe({ base: { 'border-right-width': '1px' } }),
    'control-sheet-right-border': recipe({ base: { 'border-left-width': '1px' } }),
    'control-sheet-top-border': recipe({ base: { 'border-bottom-width': '1px' } }),
    // src/shared/components/ui/select.tsx
    'piece-size-select-1': recipe({ base: { padding: '0.25rem' } }),
    // src/shared/components/ui/select.tsx
    'piece-size-select-2': recipe({ base: { width: '1rem', height: '1rem' } }),
    // src/shared/components/ui/select.tsx
    'piece-size-select-3': recipe({ base: { width: '1rem', height: '1rem' } }),
    // src/shared/components/ui/select.tsx
    'piece-size-select-4': recipe({ base: { height: '1px' } }),
    // src/shared/components/ui/select.tsx
    'piece-size-select-5': recipe({ base: { 'padding-block': '0.25rem' } }),
    // src/shared/components/ui/select.tsx
    'piece-size-select-6': recipe({ base: { 'padding-block': '0.25rem' } }),
    // src/shared/components/ui/popover.tsx
    'piece-size-popover-1': recipe({ base: { width: '18rem' } }),
    // src/shared/components/ui/command.tsx
    'piece-size-command-1': recipe({ base: { padding: '0.25rem', 'padding-bottom': '0rem' } }),
    // src/shared/components/ui/command.tsx
    'piece-size-command-2': recipe({ base: { width: '1rem', height: '1rem' } }),
    // src/shared/components/ui/command.tsx
    'piece-size-command-3': recipe({ base: { 'padding-block': '1.5rem' } }),
    // src/shared/components/ui/command.tsx
    'piece-size-command-4': recipe({ base: { padding: '0.25rem' } }),
    // src/shared/components/ui/command.tsx
    'piece-size-command-5': recipe({ base: { height: '1px' } }),
    // src/shared/components/ui/dropdown-menu.tsx
    'piece-size-dropdown-menu-1': recipe({ base: { height: '1px' } }),
    // src/shared/components/ui/tooltip.tsx
    'piece-size-tooltip-1': recipe({ base: { width: '0.625rem', height: '0.625rem' } }),
    // src/shared/components/ui/hover-card.tsx
    'piece-size-hover-card-1': recipe({ base: { width: '16rem' } }),
  };
}
