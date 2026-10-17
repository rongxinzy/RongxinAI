import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { MagpieModelRef } from '../../../../shared/magpie/preferences';
import { i18nService } from '../../../services/i18n';

const AUTO_VALUE = '__automatic__';
const OFF_VALUE = '__off__';
const DEFAULT_EFFORT = '__default__';

export function MagpiePreferenceRow({
  title,
  description,
  control,
}: {
  title: ReactNode;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-medium text-foreground">{title}</h3>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="w-full shrink-0 lg:w-auto">{control}</div>
    </div>
  );
}

function modelLabel(model: MagpieModelRef): string {
  const name = model.name || model.id;
  return model.providerName ? `${name} · ${model.providerName}` : name;
}

export function MagpieModelSelect({
  label,
  value,
  models,
  allowOff = false,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  models: MagpieModelRef[];
  allowOff?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const items: Record<string, string> = {
    [AUTO_VALUE]: i18nService.t('magpieAutomatic'),
  };
  if (allowOff) items[OFF_VALUE] = i18nService.t('magpieOff');
  for (const model of models) items[model.id] = modelLabel(model);
  const current = value === 'off' ? OFF_VALUE : value || AUTO_VALUE;
  return (
    <Select
      items={items}
      value={current}
      onValueChange={next => {
        if (!next) return;
        onChange(next === AUTO_VALUE ? '' : next === OFF_VALUE ? 'off' : next);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-full lg:w-64" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowOff ? <SelectItem value={OFF_VALUE}>{i18nService.t('magpieOff')}</SelectItem> : null}
        <SelectItem value={AUTO_VALUE}>{i18nService.t('magpieAutomatic')}</SelectItem>
        {models.map(model => (
          <SelectItem key={model.id} value={model.id}>
            {modelLabel(model)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MagpieEffortSelect({
  label,
  value,
  efforts,
  disabled = false,
  onChange,
}: {
  label: string;
  value: string;
  efforts: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const items: Record<string, string> = {
    [DEFAULT_EFFORT]: i18nService.t('magpieEffortDefault'),
  };
  for (const effort of efforts) items[effort] = effort;
  return (
    <Select
      items={items}
      value={value || DEFAULT_EFFORT}
      onValueChange={next => {
        if (!next) return;
        onChange(next === DEFAULT_EFFORT ? '' : next);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-full lg:w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_EFFORT}>{i18nService.t('magpieEffortDefault')}</SelectItem>
        {efforts.map(effort => (
          <SelectItem key={effort} value={effort}>
            {effort}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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
    <div className="flex w-full flex-col gap-2">
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
