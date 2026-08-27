import { Button } from '@shared/components/ui/button';
import { Textarea } from '@shared/components/ui/textarea';
import { Send } from 'lucide-react';

import { i18nService } from '../../services/i18n';

interface CodingComposerProps {
  disabled: boolean;
  prompt: string;
  recipientName: string;
  onChange: (value: string) => void;
  onSend: () => void;
}

export const CodingComposer = ({
  disabled,
  prompt,
  recipientName,
  onChange,
  onSend,
}: CodingComposerProps) => (
  <div className="border-t border-border p-3">
    <p className="mb-2 text-xs text-muted-foreground">
      {i18nService.t('codingAgentSendTo')} {recipientName}
    </p>
    <div className="flex gap-2">
      <Textarea
        value={prompt}
        onChange={event => onChange(event.target.value)}
        placeholder={i18nService.t('codingAgentPromptPlaceholder')}
        disabled={disabled}
      />
      <Button
        type="button"
        onClick={onSend}
        disabled={disabled || !prompt.trim()}
        aria-label={i18nService.t('codingAgentSend')}
      >
        <Send className="size-4" />
      </Button>
    </div>
  </div>
);
