import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../types/cowork';

export const CoworkPermissionToolName = {
  AskUserQuestion: 'AskUserQuestion',
} as const;

export const CoworkPermissionBehavior = {
  Allow: 'allow',
  Deny: 'deny',
} as const;

export const AskUserQuestionAnswerDelimiter = '|||';

export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestionItem {
  question: string;
  header?: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

export const isAskUserQuestionPermission = (permission: CoworkPermissionRequest): boolean =>
  permission.toolName === CoworkPermissionToolName.AskUserQuestion;

export const parseAskUserQuestions = (
  permission: CoworkPermissionRequest,
): AskUserQuestionItem[] => {
  if (!isAskUserQuestionPermission(permission)) return [];

  const rawQuestions = permission.toolInput.questions;
  if (!Array.isArray(rawQuestions)) return [];

  return rawQuestions.flatMap(rawQuestion => {
    if (!isRecord(rawQuestion) || typeof rawQuestion.question !== 'string') return [];
    if (!Array.isArray(rawQuestion.options)) return [];

    const options = rawQuestion.options.flatMap(rawOption => {
      if (!isRecord(rawOption) || typeof rawOption.label !== 'string') return [];
      return [
        {
          label: rawOption.label,
          ...(typeof rawOption.description === 'string'
            ? { description: rawOption.description }
            : {}),
        },
      ];
    });

    if (options.length === 0) return [];

    return [
      {
        question: rawQuestion.question,
        ...(typeof rawQuestion.header === 'string' ? { header: rawQuestion.header } : {}),
        options,
        multiSelect: rawQuestion.multiSelect === true,
      },
    ];
  });
};

export const hasAskUserQuestions = (permission: CoworkPermissionRequest): boolean =>
  parseAskUserQuestions(permission).length > 0;

export const buildAskUserQuestionAllowResult = (
  permission: CoworkPermissionRequest,
  answers: Record<string, string>,
): CoworkPermissionResult => ({
  behavior: CoworkPermissionBehavior.Allow,
  updatedInput: {
    ...permission.toolInput,
    answers,
  },
});

export const buildAskUserQuestionDenyResult = (): CoworkPermissionResult => ({
  behavior: CoworkPermissionBehavior.Deny,
  message: 'Permission denied',
});
