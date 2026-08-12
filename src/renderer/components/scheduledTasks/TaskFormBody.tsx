import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Textarea } from '@shared/components/ui/textarea';
import React from 'react';

import { i18nService } from '../../services/i18n';

interface TaskFormBodyProps {
  mode: 'create' | 'edit';
  name: string;
  modelId: string;
  payloadText: string;
  errors: Record<string, string>;
  modelOptions: Array<{ value: string; label: string }>;
  scheduleControl: React.ReactNode;
  notificationControl: React.ReactNode;
  onNameChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onPayloadTextChange: (value: string) => void;
}

const TaskFormBody: React.FC<TaskFormBodyProps> = ({
  mode,
  name,
  modelId,
  payloadText,
  errors,
  modelOptions,
  scheduleControl,
  notificationControl,
  onNameChange,
  onModelChange,
  onPayloadTextChange,
}) => (
  <div className="max-w-2xl mx-auto flex flex-col gap-4 w-full px-1">
    <h2 className="text-sm text-muted-foreground">
      {mode === 'create'
        ? i18nService.t('scheduledTasksFormCreate')
        : i18nService.t('scheduledTasksFormUpdate')}
    </h2>

    <FieldGroup className="gap-4">
      <Field data-invalid={Boolean(errors.name) || undefined}>
        <FieldLabel htmlFor="scheduled-task-name">
          {i18nService.t('scheduledTasksFormName')}
          <span className="text-destructive">*</span>
        </FieldLabel>
        <Input
          id="scheduled-task-name"
          type="text"
          value={name}
          onChange={event => onNameChange(event.target.value)}
          maxLength={200}
          placeholder={i18nService.t('scheduledTasksFormNamePlaceholder')}
          aria-invalid={Boolean(errors.name)}
        />
        <FieldError>{errors.name}</FieldError>
      </Field>

      <Field data-invalid={Boolean(errors.modelId) || undefined}>
        <FieldLabel htmlFor="scheduled-task-model">
          {i18nService.t('scheduledTasksFormModel')}
          <span className="text-destructive">*</span>
        </FieldLabel>
        <Select value={modelId} onValueChange={value => onModelChange(value ?? '')}>
          <SelectTrigger
            id="scheduled-task-model"
            className="w-full"
            aria-invalid={Boolean(errors.modelId)}
          >
            <SelectValue placeholder={i18nService.t('scheduledTasksFormModelPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="" disabled>
                {i18nService.t('scheduledTasksFormModelPlaceholder')}
              </SelectItem>
              {modelOptions.map(model => (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <FieldError>{errors.modelId}</FieldError>
      </Field>

      <Field data-invalid={Boolean(errors.schedule) || undefined}>
        <FieldTitle>{i18nService.t('scheduledTasksFormScheduleType')}</FieldTitle>
        {scheduleControl}
        <FieldError>{errors.schedule}</FieldError>
      </Field>

      <Field data-invalid={Boolean(errors.payloadText) || undefined}>
        <FieldLabel htmlFor="scheduled-task-prompt">
          {i18nService.t('scheduledTasksFormPayloadTextAgent')}
          <span className="text-destructive">*</span>
        </FieldLabel>
        <Textarea
          id="scheduled-task-prompt"
          value={payloadText}
          onChange={event => onPayloadTextChange(event.target.value)}
          className="min-h-20"
          placeholder={i18nService.t('scheduledTasksFormPromptPlaceholder')}
          aria-invalid={Boolean(errors.payloadText)}
        />
        <FieldDescription className="text-xs">
          {i18nService.t('scheduledTasksFormPayloadTextAgentHint')}
        </FieldDescription>
        <FieldError>{errors.payloadText}</FieldError>
      </Field>

      <Field>
        <FieldTitle>{i18nService.t('scheduledTasksFormNotifyChannel')}</FieldTitle>
        {notificationControl}
      </Field>
    </FieldGroup>
  </div>
);

export default TaskFormBody;
