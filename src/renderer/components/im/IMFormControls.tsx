import { Badge } from '@shared/components/ui/badge';
import { Alert, AlertDescription } from '@shared/components/ui/alert';
import { Checkbox } from '@shared/components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@shared/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { Textarea } from '@shared/components/ui/textarea';
import { CheckCircle, Eye, EyeOff, XCircle } from 'lucide-react';
import React from 'react';

export interface IMSelectOption {
  label: string;
  value: string;
}

interface IMSelectFieldProps {
  id: string;
  label: React.ReactNode;
  options: readonly IMSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  description?: React.ReactNode;
}

export function IMSelectField({
  id,
  label,
  options,
  value,
  onValueChange,
  onOpenChange,
  disabled,
  description,
}: IMSelectFieldProps) {
  const selectedOption = options.find(option => option.value === value) ?? null;

  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={options}
        value={selectedOption}
        itemToStringValue={option => option.value}
        onValueChange={nextOption => {
          if (nextOption !== null) onValueChange(nextOption.value);
        }}
        onOpenChange={onOpenChange}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>{option => option?.label}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map(option => (
              <SelectItem key={option.value} value={option}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

interface IMInputFieldProps extends Omit<
  React.ComponentProps<typeof InputGroupInput>,
  'id' | 'value'
> {
  id: string;
  label: React.ReactNode;
  value: string | number;
  description?: React.ReactNode;
  clearLabel?: string;
  onClear?: () => void;
  revealLabel?: string;
  concealLabel?: string;
  revealed?: boolean;
  onRevealChange?: (revealed: boolean) => void;
}

export function IMInputField({
  id,
  label,
  value,
  description,
  clearLabel,
  onClear,
  revealLabel,
  concealLabel,
  revealed,
  onRevealChange,
  ...inputProps
}: IMInputFieldProps) {
  const hasActions = Boolean(onClear || onRevealChange);

  return (
    <Field data-disabled={inputProps.disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput id={id} value={value} {...inputProps} />
        {hasActions ? (
          <InputGroupAddon align="inline-end">
            {onClear && value !== '' ? (
              <InputGroupButton size="icon-xs" aria-label={clearLabel} onClick={onClear}>
                <XCircle data-icon="inline-start" />
              </InputGroupButton>
            ) : null}
            {onRevealChange ? (
              <InputGroupButton
                size="icon-xs"
                aria-label={revealed ? concealLabel : revealLabel}
                onClick={() => onRevealChange(!revealed)}
              >
                {revealed ? <Eye data-icon="inline-start" /> : <EyeOff data-icon="inline-start" />}
              </InputGroupButton>
            ) : null}
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

interface IMTextareaFieldProps extends React.ComponentProps<typeof Textarea> {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
}

export function IMTextareaField({
  id,
  label,
  description,
  ...textareaProps
}: IMTextareaFieldProps) {
  return (
    <Field data-disabled={textareaProps.disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea id={id} {...textareaProps} />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

interface IMFieldProps {
  id?: string;
  label: React.ReactNode;
  children: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}

export function IMField({ id, label, children, description, disabled }: IMFieldProps) {
  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}

interface IMSwitchFieldProps {
  id: string;
  label: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: React.ReactNode;
  disabled?: boolean;
  size?: React.ComponentProps<typeof Switch>['size'];
}

export function IMSwitchField({
  id,
  label,
  checked,
  onCheckedChange,
  description,
  disabled,
  size,
}: IMSwitchFieldProps) {
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </FieldContent>
      <Switch
        id={id}
        size={size}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </Field>
  );
}

interface IMCheckboxFieldProps {
  id: string;
  label: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  description?: React.ReactNode;
  disabled?: boolean;
}

export function IMCheckboxField({
  id,
  label,
  checked,
  onCheckedChange,
  description,
  disabled,
}: IMCheckboxFieldProps) {
  return (
    <Field orientation="horizontal" data-disabled={disabled || undefined}>
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
      </FieldContent>
    </Field>
  );
}

export function IMFormGroup({ children }: { children: React.ReactNode }) {
  return <FieldGroup className="gap-3">{children}</FieldGroup>;
}

export function IMConnectionBadge({
  connected,
  connectedLabel,
  disconnectedLabel,
}: {
  connected: boolean;
  connectedLabel: string;
  disconnectedLabel: string;
}) {
  return (
    <Badge variant={connected ? 'default' : 'secondary'}>
      {connected ? connectedLabel : disconnectedLabel}
    </Badge>
  );
}

export function IMStatusAlert({
  error = false,
  children,
}: {
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Alert variant={error ? 'destructive' : 'default'}>
      {error ? <XCircle /> : <CheckCircle className="text-success" />}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
