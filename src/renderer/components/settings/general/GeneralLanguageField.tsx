import { Field, FieldLabel } from '@shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';

import { i18nService, type LanguageType } from '../../../services/i18n';
import { GeneralLanguageOption } from './constants';

const LANGUAGE_OPTIONS = [
  { value: GeneralLanguageOption.Chinese, labelKey: 'chinese' },
  { value: GeneralLanguageOption.English, labelKey: 'english' },
] as const;

interface GeneralLanguageFieldProps {
  value: LanguageType;
  onValueChange: (value: LanguageType) => void;
}

export function GeneralLanguageField({ value, onValueChange }: GeneralLanguageFieldProps) {
  const items = LANGUAGE_OPTIONS.map(option => ({
    value: option.value,
    label: i18nService.t(option.labelKey),
  }));

  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor="settings-language-select">{i18nService.t('language')}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={nextValue => {
          if (nextValue) onValueChange(nextValue);
        }}
      >
        <SelectTrigger id="settings-language-select" className="w-[140px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map(item => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
