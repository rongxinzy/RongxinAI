import { Button } from '@shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';

import { CodingPermissionOutcome, type CodingEvent } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { PermissionRequestCard, PermissionToolBody } from '../permission/PermissionRequestCard';
import { detectPermissionDanger } from '../permission/permissionDanger';
import {
  codingPermissionOptionLabel,
  formatCodingPermissionInput,
  parseCodingPermission,
  resolveCodingPermissionActions,
  type CodingPermissionAction,
} from './codingPermission';
import { codingToolKindLabel } from './codingToolKind';

interface CodingPermissionCardProps {
  /** Pending permission request event. */
  event: CodingEvent;
  onRespond: (outcome: CodingPermissionOutcome, optionId?: string) => void;
  /** Set while the answer is on its way to the agent to block a second one. */
  disabled?: boolean;
}

const actionLabel = (action: CodingPermissionAction, fallbackKey: string): string =>
  action.option ? codingPermissionOptionLabel(action.option) : i18nService.t(fallbackKey);

/**
 * Inline approval card for coding sessions. It shares the work-mode card shell
 * so both surfaces keep the same body, risk banner and footer; ACP options are
 * folded into a primary action, a secondary action and an overflow menu.
 */
export const CodingPermissionCard = ({
  event,
  onRespond,
  disabled = false,
}: CodingPermissionCardProps) => {
  const { toolName, toolKind, toolInput, options } = parseCodingPermission(event);
  const actions = resolveCodingPermissionActions(options);
  const danger = detectPermissionDanger(toolInput);
  const command = typeof toolInput?.command === 'string' ? toolInput.command.trim() : '';
  const detail = command || formatCodingPermissionInput(toolInput);
  const kindLabel = codingToolKindLabel(toolKind) ?? i18nService.t('codingAgentTool');
  const requestedTitle = toolName ?? kindLabel;
  // Agents such as Claude Code use the command itself as the tool-call title,
  // which would print the command twice next to the monospace detail block.
  const title = detail && requestedTitle.trim() === detail.trim() ? kindLabel : requestedTitle;
  const primary = actions.primary;
  const secondary = actions.secondary;

  return (
    <div className="flex flex-col gap-2" data-coding-permission-card>
      <PermissionRequestCard
        dangerLevel={danger.level}
        dangerReasonText={danger.reasonText}
        footer={
          <>
            {primary && (
              <Button
                type="button"
                disabled={disabled}
                onClick={() => onRespond(primary.outcome, primary.optionId)}
              >
                {actionLabel(primary, 'codingAgentApprovePermission')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => onRespond(secondary.outcome, secondary.optionId)}
            >
              {actionLabel(secondary, 'codingAgentPermissionReject')}
            </Button>
            {actions.more.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button type="button" variant="ghost" />}
                  nativeButton
                  disabled={disabled}
                >
                  {i18nService.t('codingAgentPermissionMore')}
                  <ChevronDown className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-80">
                  {actions.more.map(option => (
                    <DropdownMenuItem
                      key={option.optionId}
                      className="flex-col items-start"
                      onClick={() => onRespond(CodingPermissionOutcome.Selected, option.optionId)}
                    >
                      <span className="max-w-full truncate">
                        {codingPermissionOptionLabel(option)}
                      </span>
                      {option.description && (
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      >
        <PermissionToolBody title={title} detail={detail} />
      </PermissionRequestCard>
    </div>
  );
};
