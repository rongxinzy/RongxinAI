import { Button } from '@shared/components/ui/button';
import { cn } from '@shared/lib/utils';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../types/cowork';

interface CoworkQuestionWizardProps {
  permission: CoworkPermissionRequest;
  onRespond: (result: CoworkPermissionResult) => void;
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

const CoworkQuestionWizard: React.FC<CoworkQuestionWizardProps> = ({ permission, onRespond }) => {
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

  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});

  useEffect(() => {
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
  }, [permission.requestId, toolInput]);

  if (questions.length === 0) {
    return null;
  }

  const currentQuestion = questions[currentStep];
  const totalSteps = questions.length;
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === totalSteps - 1;

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
    if (!question.multiSelect) {
      setAnswers(prev => ({
        ...prev,
        [question.question]: optionLabel,
      }));

      // 单选题选择后自动跳转到下一题（延迟执行以显示选中效果）
      setTimeout(() => {
        // 使用函数式更新获取最新的 currentStep
        setCurrentStep(prevStep => {
          const nextStep = prevStep + 1;
          // 只有不是最后一题才跳转
          if (nextStep < questions.length) {
            return nextStep;
          }
          return prevStep;
        });
      }, 150);
    } else {
      setAnswers(prev => {
        const rawValue = prev[question.question] ?? '';

        if (!rawValue.trim()) {
          return {
            ...prev,
            [question.question]: optionLabel,
          };
        }

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

        if (current.size === 0) {
          const newAnswers = { ...prev };
          delete newAnswers[question.question];
          return newAnswers;
        }

        return {
          ...prev,
          [question.question]: Array.from(current).join('|||'),
        };
      });
    }
  };

  const handleOtherInputChange = (value: string) => {
    setOtherInputs(prev => ({
      ...prev,
      [currentStep]: value,
    }));
  };

  const handlePrevious = () => {
    if (!isFirstStep) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleNext = () => {
    if (!isLastStep) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handleSkip = () => {
    // Clear the answer for the current question
    setAnswers(prev => {
      const newAnswers = { ...prev };
      delete newAnswers[currentQuestion.question];
      return newAnswers;
    });
    setOtherInputs(prev => {
      const newInputs = { ...prev };
      delete newInputs[currentStep];
      return newInputs;
    });

    if (!isLastStep) {
      handleNext();
    }
  };

  const handleSubmit = () => {
    // Merge "Other" inputs into answers
    const finalAnswers = { ...answers };
    Object.entries(otherInputs).forEach(([stepIndex, otherValue]) => {
      const question = questions[Number(stepIndex)];
      if (question && otherValue.trim()) {
        if (question.multiSelect) {
          const existingAnswers =
            finalAnswers[question.question]
              ?.split('|||')
              .map(a => a.trim())
              .filter(Boolean) || [];
          finalAnswers[question.question] = [...existingAnswers, otherValue.trim()].join('|||');
        } else {
          finalAnswers[question.question] = otherValue.trim();
        }
      }
    });

    onRespond({
      behavior: 'allow',
      updatedInput: {
        ...(toolInput && typeof toolInput === 'object' ? toolInput : {}),
        answers: finalAnswers,
      },
    });
  };

  const handleDeny = () => {
    onRespond({
      behavior: 'deny',
      message: 'Permission denied',
    });
  };

  const selectedValues = getSelectedValues(currentQuestion);

  // Check whether every question has at least one answer (selected option or "other" input)
  const allAnswered = questions.every((q, idx) => {
    const hasSelection = Boolean(answers[q.question]?.trim());
    const hasOther = Boolean(otherInputs[idx]?.trim());
    return hasSelection || hasOther;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop">
      <div className="modal-content w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">
              {i18nService.t('coworkQuestionWizardTitle')}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={handleDeny} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Progress bar — scaleX-driven (width animation is banned by DESIGN.md) */}
        <div className="h-1 bg-surface-raised">
          <div
            className="h-full w-full origin-left bg-primary transition-transform duration-200"
            style={{ transform: `scaleX(${(currentStep + 1) / totalSteps})` }}
          />
        </div>

        {/* Content */}
        <div className="px-6 py-6 min-h-[300px] flex flex-col">
          <div className="flex-1">
            {/* Question header and navigation */}
            <div className="flex items-start justify-between gap-4 mb-4">
              <div className="flex-1">
                {currentQuestion.header && (
                  <span className="inline-block text-xs uppercase tracking-wide px-2 py-1 rounded-full bg-surface-raised text-muted-foreground mb-3">
                    {currentQuestion.header}
                  </span>
                )}
                {/* Question text */}
                <h3 className="text-base font-medium text-foreground">
                  {currentQuestion.question}
                </h3>
              </div>

              {/* Step indicators and navigation */}
              <div className="flex items-center gap-2">
                {/* Previous button */}
                {!isFirstStep && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handlePrevious}
                    title={i18nService.t('coworkQuestionWizardPrevious')}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                )}

                {/* Step dots */}
                <div className="flex items-center gap-1.5">
                  {questions.map((question, index) => {
                    const isActive = index === currentStep;
                    const isAnswered = Boolean(
                      answers[question.question]?.trim() || otherInputs[index]?.trim(),
                    );

                    return (
                      <Button
                        key={index}
                        type="button"
                        variant={isActive ? 'default' : isAnswered ? 'outline' : 'secondary'}
                        size="icon-sm"
                        aria-current={isActive ? 'step' : undefined}
                        aria-label={`${index + 1}. ${question.question}`}
                        onClick={() => setCurrentStep(index)}
                        className={cn(
                          '[&_svg]:size-3.5',
                          isAnswered &&
                            !isActive &&
                            'theme-page-cowork-question-wizard-button-variant-1',
                        )}
                        title={question.question}
                      >
                        {isAnswered && !isActive ? <Check /> : index + 1}
                      </Button>
                    );
                  })}
                </div>

                {/* Next button */}
                {!isLastStep && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleNext}
                    title={i18nService.t('coworkQuestionWizardNext')}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                )}
              </div>
            </div>

            {/* Options */}
            <div className="space-y-2">
              {currentQuestion.options.map(option => {
                const isSelected = selectedValues.includes(option.label);
                return (
                  <Button
                    key={option.label}
                    variant={isSelected ? 'default' : 'outline'}
                    className="theme-control-sizing-11 w-full justify-start"
                    onClick={() => handleSelectOption(currentQuestion, option.label)}
                  >
                    <div className="flex items-start gap-3">
                      {currentQuestion.multiSelect ? (
                        <div
                          className={`mt-0.5 shrink-0 w-4 h-4 rounded border-2 transition-colors ${
                            isSelected ? 'bg-primary border-primary' : 'border-border'
                          }`}
                        >
                          {isSelected && (
                            <svg
                              className="w-full h-full text-white"
                              viewBox="0 0 16 16"
                              fill="none"
                            >
                              <path
                                d="M13 4L6 11L3 8"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </div>
                      ) : (
                        <div
                          className={`mt-0.5 shrink-0 w-4 h-4 rounded-full border-2 transition-colors ${
                            isSelected ? 'border-primary' : 'border-border'
                          }`}
                        >
                          {isSelected && (
                            <div className="w-full h-full rounded-full bg-primary scale-50" />
                          )}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{option.label}</div>
                        {option.description && (
                          <div className="text-xs mt-1 opacity-80">{option.description}</div>
                        )}
                      </div>
                    </div>
                  </Button>
                );
              })}
            </div>

            {/* Other input and Skip button in same row */}
            <div className="mt-4 flex items-center gap-3">
              <input
                type="text"
                value={otherInputs[currentStep] || ''}
                onChange={e => handleOtherInputChange(e.target.value)}
                placeholder={i18nService.t('coworkQuestionWizardOther')}
                className="theme-native-field theme-native-question-field flex-1 px-3 py-2"
              />
              <Button variant="ghost" onClick={handleSkip}>
                {i18nService.t('coworkQuestionWizardSkip')}
              </Button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 border-t border-border bg-surface-raised">
          <Button onClick={handleSubmit} disabled={!allAnswered}>
            {i18nService.t('coworkQuestionWizardSubmit')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CoworkQuestionWizard;
