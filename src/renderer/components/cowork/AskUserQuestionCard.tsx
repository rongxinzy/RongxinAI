import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
} from '@shared/components/ai-elements/queue';
import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { Label } from '@shared/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/components/ui/radio-group';
import { Textarea } from '@shared/components/ui/textarea';
import { cn } from '@shared/lib/utils';
import { ListChecks } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../types/cowork';
import {
  AskUserQuestionAnswerDelimiter,
  buildAskUserQuestionAllowResult,
  buildAskUserQuestionDenyResult,
  parseAskUserQuestions,
} from './askUserQuestion';

interface AskUserQuestionCardProps {
  permission: CoworkPermissionRequest;
  onRespond: (result: CoworkPermissionResult) => void | Promise<void>;
}

const splitAnswer = (answer: string | undefined): string[] =>
  answer
    ?.split(AskUserQuestionAnswerDelimiter)
    .map(value => value.trim())
    .filter(Boolean) ?? [];

const AskUserQuestionCard = ({ permission, onRespond }: AskUserQuestionCardProps) => {
  const questions = useMemo(() => parseAskUserQuestions(permission), [permission]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const rawAnswers = permission.toolInput.answers;
    if (!rawAnswers || typeof rawAnswers !== 'object') {
      setAnswers({});
      setOtherAnswers({});
      return;
    }

    const initialAnswers = Object.fromEntries(
      Object.entries(rawAnswers).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    setAnswers(initialAnswers);
    setOtherAnswers({});
  }, [permission.requestId, permission.toolInput.answers]);

  if (questions.length === 0) return null;

  const updateSingleAnswer = (question: string, answer: string | null) => {
    setAnswers(current => {
      if (!answer) {
        const next = { ...current };
        delete next[question];
        return next;
      }
      return { ...current, [question]: answer };
    });
  };

  const toggleMultiAnswer = (question: string, option: string, checked: boolean) => {
    const currentAnswers = new Set(splitAnswer(answers[question]));
    if (checked) {
      currentAnswers.add(option);
    } else {
      currentAnswers.delete(option);
    }
    updateSingleAnswer(
      question,
      currentAnswers.size > 0
        ? Array.from(currentAnswers).join(AskUserQuestionAnswerDelimiter)
        : null,
    );
  };

  const updateOtherAnswer = (question: string, multiSelect: boolean, value: string) => {
    setOtherAnswers(current => ({ ...current, [question]: value }));
    if (!multiSelect && value.trim()) {
      updateSingleAnswer(question, null);
    }
  };

  const buildAnswers = (): Record<string, string> => {
    const nextAnswers = { ...answers };
    questions.forEach(question => {
      const otherAnswer = otherAnswers[question.question]?.trim();
      if (!otherAnswer) return;

      if (!question.multiSelect) {
        nextAnswers[question.question] = otherAnswer;
        return;
      }

      const selected = splitAnswer(nextAnswers[question.question]);
      nextAnswers[question.question] = [...selected, otherAnswer].join(
        AskUserQuestionAnswerDelimiter,
      );
    });
    return nextAnswers;
  };

  const isComplete = questions.every(question => {
    return Boolean(answers[question.question]?.trim() || otherAnswers[question.question]?.trim());
  });

  const respond = async (result: CoworkPermissionResult) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onRespond(result);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Queue className="mx-auto w-full max-w-[800px] rounded-lg bg-card shadow-none">
      <div className="flex items-center gap-2 px-1 text-sm font-medium text-foreground">
        <ListChecks className="size-4 text-muted-foreground" />
        <span>{i18nService.t('coworkQuestionWizardTitle')}</span>
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {questions.map((question, questionIndex) => {
          const selectedAnswers = splitAnswer(answers[question.question]);
          const otherInputId = `ask-user-other-${permission.requestId}-${questionIndex}`;

          return (
            <QueueItem
              key={`${question.question}-${questionIndex}`}
              className="gap-3 px-1 py-3 hover:bg-transparent"
            >
              <div className="flex flex-col gap-1">
                {question.header && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {question.header}
                  </span>
                )}
                <QueueItemContent className="theme-queue-question-content line-clamp-none">
                  {question.question}
                </QueueItemContent>
              </div>

              {question.multiSelect ? (
                <div className="flex flex-col gap-2">
                  {question.options.map((option, optionIndex) => {
                    const optionId = `ask-user-option-${permission.requestId}-${questionIndex}-${optionIndex}`;
                    const checked = selectedAnswers.includes(option.label);
                    return (
                      <Label
                        key={option.label}
                        htmlFor={optionId}
                        className={cn(
                          'theme-scene-choice cursor-pointer',
                          checked && 'theme-scene-choice-selected',
                        )}
                      >
                        <Checkbox
                          id={optionId}
                          checked={checked}
                          onCheckedChange={next =>
                            toggleMultiAnswer(question.question, option.label, next === true)
                          }
                          disabled={isSubmitting}
                        />
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="text-sm font-medium text-foreground">
                            {option.label}
                          </span>
                          {option.description && (
                            <QueueItemDescription className="ml-0">
                              {option.description}
                            </QueueItemDescription>
                          )}
                        </span>
                      </Label>
                    );
                  })}
                </div>
              ) : (
                <RadioGroup
                  value={answers[question.question] ?? null}
                  onValueChange={value => updateSingleAnswer(question.question, value ?? null)}
                  className="gap-2"
                  disabled={isSubmitting}
                >
                  {question.options.map((option, optionIndex) => {
                    const optionId = `ask-user-option-${permission.requestId}-${questionIndex}-${optionIndex}`;
                    const checked = answers[question.question] === option.label;
                    return (
                      <Label
                        key={option.label}
                        htmlFor={optionId}
                        className={cn(
                          'theme-scene-choice cursor-pointer',
                          checked && 'theme-scene-choice-selected',
                        )}
                      >
                        <RadioGroupItem id={optionId} value={option.label} />
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="text-sm font-medium text-foreground">
                            {option.label}
                          </span>
                          {option.description && (
                            <QueueItemDescription className="ml-0">
                              {option.description}
                            </QueueItemDescription>
                          )}
                        </span>
                      </Label>
                    );
                  })}
                </RadioGroup>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={otherInputId} className="theme-control-caption-muted">
                  {i18nService.t('coworkQuestionWizardOther')}
                </Label>
                <Textarea
                  id={otherInputId}
                  value={otherAnswers[question.question] ?? ''}
                  onChange={event =>
                    updateOtherAnswer(question.question, question.multiSelect, event.target.value)
                  }
                  placeholder={i18nService.t('coworkQuestionWizardOtherPlaceholder')}
                  className="theme-page-ask-user-question-card-textarea-1 max-h-48 resize-y"
                  disabled={isSubmitting}
                />
              </div>
            </QueueItem>
          );
        })}
      </ul>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        {!isComplete && (
          <p className="mr-auto text-xs text-muted-foreground" role="status">
            {i18nService.t('coworkQuestionWizardAnswerRequired')}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => void respond(buildAskUserQuestionDenyResult())}
          disabled={isSubmitting}
        >
          {i18nService.t('coworkDenyRequest')}
        </Button>
        <Button
          type="button"
          onClick={() => void respond(buildAskUserQuestionAllowResult(permission, buildAnswers()))}
          disabled={!isComplete || isSubmitting}
        >
          {i18nService.t('coworkQuestionWizardSubmit')}
        </Button>
      </div>
    </Queue>
  );
};

export default AskUserQuestionCard;
