import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@shared/components/ai-elements/prompt-input';
import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { useState } from 'react';

import type { CodingElicitation } from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';

interface CodingElicitationCardProps {
  elicitation: CodingElicitation;
  onRespond: (answer: string) => Promise<boolean>;
  onCancel: () => Promise<boolean>;
}

export const CodingElicitationCard = ({
  elicitation,
  onRespond,
  onCancel,
}: CodingElicitationCardProps) => {
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (): Promise<void> => {
    const value = answer.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      if (!(await onRespond(value))) setSubmitting(false);
    } catch {
      setSubmitting(false);
    }
  };
  const cancel = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (!(await onCancel())) setSubmitting(false);
    } catch {
      setSubmitting(false);
    }
  };
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{i18nService.t('codingElicitationTitle')}</CardTitle>
        <CardDescription className="whitespace-pre-wrap">{elicitation.question}</CardDescription>
      </CardHeader>
      <CardContent>
        <PromptInput
          className="theme-composer-surface"
          onSubmit={(_message, event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              value={answer}
              onChange={event => setAnswer(event.target.value)}
              placeholder={i18nService.t('codingElicitationPlaceholder')}
              aria-label={i18nService.t('codingElicitationPlaceholder')}
              disabled={submitting}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={submitting}
              onClick={() => void cancel()}
            >
              {i18nService.t('codingElicitationCancel')}
            </Button>
            <PromptInputSubmit
              status={submitting ? 'submitted' : 'ready'}
              disabled={!answer.trim() || submitting}
            >
              {i18nService.t('codingElicitationSubmit')}
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
      </CardContent>
    </Card>
  );
};
