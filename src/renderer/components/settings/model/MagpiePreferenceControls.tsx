import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { i18nService } from '../../../services/i18n';

export function MagpieListEditor({
  values,
  placeholder,
  disabled = false,
  onChange,
}: {
  values: string[];
  placeholder: string;
  disabled?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft('');
  };
  return (
    <div className="flex w-full sm:w-64 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={disabled}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={i18nService.t('magpieAdd')}
          disabled={disabled || !draft.trim()}
          onClick={add}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {values.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {values.map(value => (
            <li
              key={value}
              className="flex items-center justify-between gap-2 rounded-md border border-border-subtle px-2.5 py-1.5"
            >
              <span className="min-w-0 break-all font-mono text-sm">{value}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`${i18nService.t('magpieRemove')} ${value}`}
                disabled={disabled}
                onClick={() => onChange(values.filter(item => item !== value))}
              >
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
