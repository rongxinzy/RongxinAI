import { Button } from '@shared/components/ui/button';
import { TriangleAlert, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../types/cowork';

type DangerLevel = 'safe' | 'caution' | 'destructive';

const POSITIVE_CONFIRM_PATTERNS = [
  /\ballow\b/i,
  /\bapprove\b/i,
  /\bconfirm\b/i,
  /\bcontinue\b/i,
  /\byes\b/i,
  /允许/,
  /确认/,
  /继续/,
  /同意/,
  /删除/,
] as const;

const NEGATIVE_CONFIRM_PATTERNS = [
  /\bcancel\b/i,
  /\bdeny\b/i,
  /\breject\b/i,
  /\babort\b/i,
  /\bno\b/i,
  /取消/,
  /拒绝/,
  /不同意/,
  /不允许/,
  /停止/,
] as const;

const DANGER_REASON_I18N_MAP: Record<string, string> = {
  'recursive-delete': 'dangerReasonRecursiveDelete',
  'git-force-push': 'dangerReasonGitForcePush',
  'git-reset-hard': 'dangerReasonGitResetHard',
  'disk-overwrite': 'dangerReasonDiskOverwrite',
  'disk-format': 'dangerReasonDiskFormat',
  'file-delete': 'dangerReasonFileDelete',
  'git-push': 'dangerReasonGitPush',
  'process-kill': 'dangerReasonProcessKill',
  'permission-change': 'dangerReasonPermissionChange',
};

/** Fallback detection when dangerLevel is not provided by the adapter */
function detectDangerLevelFromCommand(command: string): DangerLevel {
  const destructivePatterns = [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|--recursive)\b/i,
    /\bgit\s+push\s+.*--force\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bdd\b/i,
    /\bmkfs\b/i,
  ];
  if (destructivePatterns.some(p => p.test(command))) return 'destructive';

  const cautionPatterns = [
    /\b(rm|rmdir|unlink|del|erase|remove-item|trash)\b/i,
    /\bgit\s+push\b/i,
    /\b(kill|killall|pkill)\b/i,
    /\b(chmod|chown)\b/i,
    /\bgit\s+clean\b/i,
    /\bsudo\b/i,
  ];
  if (cautionPatterns.some(p => p.test(command))) return 'caution';

  return 'safe';
}

interface CoworkPermissionModalProps {
  permission: CoworkPermissionRequest;
  onRespond: (result: CoworkPermissionResult) => void;
  inline?: boolean;
}

type QuestionOption = {
  label: string;
  description?: string;
};

type QuestionItem = {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
};

const looksPositiveConfirmOption = (label: string): boolean => {
  return POSITIVE_CONFIRM_PATTERNS.some(pattern => pattern.test(label));
};

const looksNegativeConfirmOption = (label: string): boolean => {
  return NEGATIVE_CONFIRM_PATTERNS.some(pattern => pattern.test(label));
};

const resolveConfirmModeButtons = (
  question: QuestionItem,
): { primary: QuestionOption; secondary: QuestionOption } => {
  const [firstOption, secondOption] = question.options;
  if (!firstOption || !secondOption) {
    throw new Error('Confirm mode requires exactly two options.');
  }

  const firstIsNegative = looksNegativeConfirmOption(firstOption.label);
  const secondIsNegative = looksNegativeConfirmOption(secondOption.label);
  if (firstIsNegative && !secondIsNegative) {
    return { primary: secondOption, secondary: firstOption };
  }

  const firstIsPositive = looksPositiveConfirmOption(firstOption.label);
  const secondIsPositive = looksPositiveConfirmOption(secondOption.label);
  if (!firstIsPositive && secondIsPositive) {
    return { primary: secondOption, secondary: firstOption };
  }

  return { primary: firstOption, secondary: secondOption };
};

const CoworkPermissionModal: React.FC<CoworkPermissionModalProps> = ({
  permission,
  onRespond,
  inline = false,
}) => {
  const toolInput = useMemo(() => permission.toolInput ?? {}, [permission.toolInput]);

  const questions = useMemo<QuestionItem[]>(() => {
    if (permission.toolName !== 'AskUserQuestion') return [];
    if (!toolInput || typeof toolInput !== 'object') return [];
    const rawQuestions = (toolInput as Record<string, unknown>).questions;
    if (!Array.isArray(rawQuestions)) return [];

    return rawQuestions
      .map(question => {
        if (!question || typeof question !== 'object') return null;
        const record = question as Record<string, unknown>;
        const options = Array.isArray(record.options)
          ? (record.options
              .map(option => {
                if (!option || typeof option !== 'object') return null;
                const optionRecord = option as Record<string, unknown>;
                if (typeof optionRecord.label !== 'string') return null;
                return {
                  label: optionRecord.label,
                  description:
                    typeof optionRecord.description === 'string'
                      ? optionRecord.description
                      : undefined,
                } as QuestionOption;
              })
              .filter(Boolean) as QuestionOption[])
          : [];

        if (typeof record.question !== 'string' || options.length === 0) {
          return null;
        }

        return {
          question: record.question,
          header: typeof record.header === 'string' ? record.header : undefined,
          options,
          multiSelect: Boolean(record.multiSelect),
        } as QuestionItem;
      })
      .filter(Boolean) as QuestionItem[];
  }, [permission.toolName, toolInput]);

  const isQuestionTool = questions.length > 0;

  // Detect simple confirm mode: 1 question with exactly 2 options.
  // In this case, render a compact two-button dialog, but preserve the actual
  // option labels instead of assuming fixed allow/deny semantics.
  const isConfirmMode =
    isQuestionTool &&
    questions.length === 1 &&
    questions[0].options.length === 2 &&
    !questions[0].multiSelect;

  const confirmModeButtons = useMemo(() => {
    if (!isConfirmMode) return null;
    return resolveConfirmModeButtons(questions[0]);
  }, [isConfirmMode, questions]);

  const [answers, setAnswers] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isQuestionTool) {
      setAnswers({});
      return;
    }

    const rawAnswers = (toolInput as Record<string, unknown>).answers;
    if (rawAnswers && typeof rawAnswers === 'object') {
      const initial: Record<string, string> = {};
      Object.entries(rawAnswers as Record<string, unknown>).forEach(([key, value]) => {
        if (typeof value === 'string') {
          initial[key] = value;
        }
      });
      setAnswers(initial);
    } else {
      setAnswers({});
    }
  }, [isQuestionTool, permission.requestId, toolInput]);

  const formatToolInput = (input: Record<string, unknown>): string => {
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  };

  const requestedCommand = useMemo(() => {
    if (!toolInput || typeof toolInput !== 'object') {
      return '';
    }
    const context = (toolInput as Record<string, unknown>).context;
    if (!context || typeof context !== 'object') {
      return '';
    }
    const requestedToolInput = (context as Record<string, unknown>).requestedToolInput;
    if (!requestedToolInput || typeof requestedToolInput !== 'object') {
      return '';
    }
    const command = (requestedToolInput as Record<string, unknown>).command;
    return typeof command === 'string' ? command.trim() : '';
  }, [toolInput]);

  const buildQuestionAnswerResult = (question: string, answer: string): CoworkPermissionResult => {
    return {
      behavior: 'allow',
      updatedInput: {
        ...(toolInput && typeof toolInput === 'object' ? toolInput : {}),
        answers: { [question]: answer },
      },
    };
  };

  const { dangerLevel, dangerReasonText } = useMemo(() => {
    const questionText = isConfirmMode ? (questions[0]?.question ?? '') : '';
    const looksLikeDeleteQuestion = requestedCommand
      ? detectDangerLevelFromCommand(requestedCommand) !== 'safe'
      : /\b(delete|remove|rm|unlink|rmdir|erase|del)\b/i.test(questionText) ||
        /删除|移除/.test(questionText);

    if (permission.toolName === 'AskUserQuestion' && looksLikeDeleteQuestion) {
      return {
        dangerLevel: 'caution' as DangerLevel,
        dangerReasonText: i18nService.t('dangerReasonFileDelete'),
      };
    }
    if (permission.toolName !== 'Bash') {
      return { dangerLevel: 'safe' as DangerLevel, dangerReasonText: '' };
    }
    const input = permission.toolInput as Record<string, unknown>;
    const command = String(input?.command ?? '');

    // Prefer adapter-provided level, fall back to local detection
    const level =
      typeof input?.dangerLevel === 'string' &&
      ['safe', 'caution', 'destructive'].includes(input.dangerLevel)
        ? (input.dangerLevel as DangerLevel)
        : detectDangerLevelFromCommand(command);

    const reason = typeof input?.dangerReason === 'string' ? input.dangerReason : '';
    const i18nKey = DANGER_REASON_I18N_MAP[reason];
    const reasonText = i18nKey ? i18nService.t(i18nKey) : '';

    return { dangerLevel: level, dangerReasonText: reasonText };
  }, [isConfirmMode, permission.toolName, permission.toolInput, questions, requestedCommand]);

  const getSelectedValues = (question: QuestionItem): string[] => {
    const rawValue = answers[question.question] ?? '';
    if (!rawValue) return [];
    if (!question.multiSelect) return [rawValue];
    return rawValue
      .split('|||')
      .map(value => value.trim())
      .filter(Boolean);
  };

  const handleSelectOption = (question: QuestionItem, optionLabel: string) => {
    setAnswers(prev => {
      if (!question.multiSelect) {
        return { ...prev, [question.question]: optionLabel };
      }

      const rawValue = prev[question.question] ?? '';
      const current = new Set(
        rawValue
          .split('|||')
          .map(value => value.trim())
          .filter(Boolean),
      );
      if (current.has(optionLabel)) {
        current.delete(optionLabel);
      } else {
        current.add(optionLabel);
      }

      return {
        ...prev,
        [question.question]: Array.from(current).join('|||'),
      };
    });
  };

  const isComplete =
    isQuestionTool && !isConfirmMode
      ? questions.every(question => (answers[question.question] ?? '').trim())
      : true;

  const denyButtonLabel =
    isQuestionTool && !isConfirmMode
      ? i18nService.t('coworkDenyRequest')
      : i18nService.t('coworkDeny');
  const approveButtonLabel =
    isQuestionTool && !isConfirmMode
      ? i18nService.t('coworkConfirmSelection')
      : i18nService.t('coworkApprove');

  const handleConfirmModeSelect = (optionLabel: string) => {
    if (!isConfirmMode) return;
    onRespond(buildQuestionAnswerResult(questions[0].question, optionLabel));
  };

  const handleApprove = () => {
    if (isConfirmMode) {
      handleConfirmModeSelect(confirmModeButtons?.primary.label ?? questions[0].options[0].label);
      return;
    }

    if (isQuestionTool) {
      if (!isComplete) return;
      onRespond({
        behavior: 'allow',
        updatedInput: {
          ...(toolInput && typeof toolInput === 'object' ? toolInput : {}),
          answers,
        },
      });
      return;
    }

    onRespond({
      behavior: 'allow',
      updatedInput: toolInput && typeof toolInput === 'object' ? toolInput : {},
    });
  };

  const handleDeny = () => {
    onRespond({
      behavior: 'deny',
      message: 'Permission denied',
    });
  };

  return (
    <div className={inline ? 'w-full' : 'fixed inset-0 z-50 flex items-center justify-center modal-backdrop'}>
      <div
        className={
          inline
            ? 'w-full bg-surface-raised border border-border rounded-2xl shadow-sm overflow-hidden'
            : 'modal-content w-full max-w-lg mx-4 bg-surface rounded-2xl shadow-modal overflow-hidden'
        }
      >
        {!inline && (
          <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div
            className={`p-2 rounded-full ${isQuestionTool && !isConfirmMode ? 'bg-primary-muted' : 'bg-warning/10'}`}
          >
            <TriangleAlert
              className={`h-6 w-6 ${isQuestionTool && !isConfirmMode ? 'text-primary' : 'text-warning'}`}
            />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">
              {isQuestionTool && !isConfirmMode
                ? i18nService.t('coworkSelectionRequired')
                : i18nService.t('coworkPermissionRequired')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isQuestionTool && !isConfirmMode
                ? i18nService.t('coworkSelectionDescription')
                : i18nService.t('coworkPermissionDescription')}
            </p>
          </div>
          {!inline && (
            <Button variant="ghost" size="icon" onClick={handleDeny} aria-label="Close">
              <X className="h-5 w-5" />
            </Button>
          )}
          </div>
        )}

        {/* Content */}
        <div className={inline ? 'px-5 py-4 space-y-4 max-h-[42vh] overflow-y-auto' : 'px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto'}>
          {isConfirmMode ? (
            /* Simple confirm dialog — show question text + allow/deny buttons */
            <div className="px-3 py-2 rounded-lg bg-background">
              <p className="text-sm text-foreground whitespace-pre-wrap">{questions[0].question}</p>
              {requestedCommand && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                    {i18nService.t('coworkToolInput')}
                  </label>
                  <div className="px-3 py-2 rounded-lg bg-surface max-h-40 overflow-y-auto">
                    <pre className="text-xs text-foreground whitespace-pre-wrap wrap-break-word font-mono">
                      {requestedCommand}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : isQuestionTool ? (
            <>
              {questions.map(question => {
                const selectedValues = getSelectedValues(question);
                return (
                  <div
                    key={question.question}
                    className="rounded-xl border border-border p-4 space-y-3"
                  >
                    {/* 问题 */}
                    <div className="text-sm font-medium text-foreground">
                      {question.header && (
                        <span className="inline-block text-xs uppercase tracking-wide px-2 py-0.5 mr-1.5 rounded-full bg-surface-raised text-muted-foreground align-middle">
                          {question.header}
                        </span>
                      )}
                      {question.question}
                    </div>
                    {/* 命令详情 */}
                    {requestedCommand && (
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                          {i18nService.t('coworkToolInput')}
                        </label>
                        <div className="px-3 py-2 rounded-lg bg-background max-h-40 overflow-y-auto">
                          <pre className="text-xs text-foreground whitespace-pre-wrap wrap-break-word font-mono">
                            {requestedCommand}
                          </pre>
                        </div>
                      </div>
                    )}
                    {/* 选项 */}
                    <div className="space-y-2">
                      {question.options.map(option => {
                        const isSelected = selectedValues.includes(option.label);
                        return (
                          <Button
                            key={option.label}
                            variant={isSelected ? 'default' : 'outline'}
                            className="w-full justify-start"
                            onClick={() => handleSelectOption(question, option.label)}
                          >
                            <div className="text-sm font-medium">{option.label}</div>
                            {option.description && (
                              <div className="text-xs mt-1 opacity-80">{option.description}</div>
                            )}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          ) : inline ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-background border border-border">
                  <code className="text-xs">&gt;_</code>
                </span>
                <span>{permission.toolName}</span>
              </div>
              <div className="rounded-xl bg-background px-3 py-2.5">
                <pre className="text-xs text-foreground whitespace-pre-wrap wrap-break-word font-mono max-h-24 overflow-y-auto">
                  {typeof toolInput.command === 'string'
                    ? toolInput.command
                    : formatToolInput(permission.toolInput)}
                </pre>
              </div>
            </div>
          ) : (
            <>
              {/* Tool name */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  {i18nService.t('coworkToolName')}
                </label>
                <div className="px-3 py-2 rounded-lg bg-background">
                  <code className="text-sm text-foreground">{permission.toolName}</code>
                </div>
              </div>

              {/* Tool input */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  {i18nService.t('coworkToolInput')}
                </label>
                <div className="px-3 py-2 rounded-lg bg-background">
                  <pre className="text-xs text-foreground whitespace-pre-wrap wrap-break-word font-mono">
                    {formatToolInput(permission.toolInput)}
                  </pre>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Warning for dangerous operations - 固定在滚动区域外，始终可见 */}
        {(!isQuestionTool || isConfirmMode) && dangerLevel === 'destructive' && (
          <div className="flex items-start gap-2 p-3 mx-6 my-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <TriangleAlert className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                {i18nService.t('coworkDestructiveOperation')}
              </p>
              {dangerReasonText && (
                <p className="text-xs text-red-600 dark:text-red-500 mt-0.5">{dangerReasonText}</p>
              )}
            </div>
          </div>
        )}
        {(!isQuestionTool || isConfirmMode) && dangerLevel === 'caution' && (
          <div className="flex items-start gap-2 p-3 mx-6 my-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
            <TriangleAlert className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                {i18nService.t('coworkCautionOperation')}
              </p>
              {dangerReasonText && (
                <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-0.5">
                  {dangerReasonText}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className={inline ? 'flex items-center justify-end gap-3 px-5 py-3' : 'flex items-center justify-end gap-3 px-6 py-4 border-t border-border'}>
          <Button
            variant="ghost"
            onClick={
              isConfirmMode && confirmModeButtons
                ? () => handleConfirmModeSelect(confirmModeButtons.secondary.label)
                : handleDeny
            }
          >
            {isConfirmMode && confirmModeButtons
              ? confirmModeButtons.secondary.label
              : denyButtonLabel}
          </Button>
          <Button onClick={handleApprove} disabled={!isComplete}>
            {isConfirmMode && confirmModeButtons
              ? confirmModeButtons.primary.label
              : approveButtonLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CoworkPermissionModal;
