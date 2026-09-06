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

import {
  SessionBindingStrategy,
  type SessionBindingStrategy as SessionBindingStrategyType,
} from '../../../scheduledTask/constants';
import { i18nService } from '../../services/i18n';

interface TaskFormBodyProps {
  mode: 'create' | 'edit';
  name: string;
  modelId: string;
  workspaceId: string;
  sessionBinding: SessionBindingStrategyType;
  boundSessionId: string;
  sessionOptions: Array<{ value: string; label: string }>;
  sessionOptionsLoading: boolean;
  payloadText: string;
  errors: Record<string, string>;
  modelOptions: Array<{ value: string; label: string }>;
  workspaceOptions: Array<{ value: string; label: string }>;
  scheduleControl: React.ReactNode;
  notificationControl: React.ReactNode;
  onNameChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onWorkspaceChange: (value: string) => void;
  onSessionBindingChange: (value: SessionBindingStrategyType) => void;
  onBoundSessionChange: (value: string) => void;
  onPayloadTextChange: (value: string) => void;
}

const TaskFormBody: React.FC<TaskFormBodyProps> = React.memo(
  ({
    mode,
    name,
    modelId,
    workspaceId,
    sessionBinding,
    boundSessionId,
    sessionOptions,
    sessionOptionsLoading,
    payloadText,
    errors,
    modelOptions,
    workspaceOptions,
    scheduleControl,
    notificationControl,
    onNameChange,
    onModelChange,
    onWorkspaceChange,
    onSessionBindingChange,
    onBoundSessionChange,
    onPayloadTextChange,
  }) => (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 w-full px-1">
      <p className="text-sm text-muted-foreground">
        {mode === 'create'
          ? i18nService.t('scheduledTasksFormCreate')
          : i18nService.t('scheduledTasksFormUpdate')}
      </p>

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

        <Field data-invalid={Boolean(errors.workspaceId) || undefined}>
          <FieldLabel htmlFor="scheduled-task-workspace">
            {i18nService.t('scheduledTasksFormWorkspace')}
            <span className="text-destructive">*</span>
          </FieldLabel>
          <Select
            items={Object.fromEntries(workspaceOptions.map(option => [option.value, option.label]))}
            value={workspaceId}
            onValueChange={value => onWorkspaceChange(value ?? '')}
          >
            <SelectTrigger
              id="scheduled-task-workspace"
              className="w-full"
              aria-invalid={Boolean(errors.workspaceId)}
            >
              <SelectValue placeholder={i18nService.t('scheduledTasksFormWorkspacePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {workspaceOptions.map(workspace => (
                  <SelectItem key={workspace.value} value={workspace.value}>
                    {workspace.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription className="theme-control-caption">
            {i18nService.t('scheduledTasksFormWorkspaceHint')}
          </FieldDescription>
          <FieldError>{errors.workspaceId}</FieldError>
        </Field>

        <Field data-invalid={Boolean(errors.boundSessionId) || undefined}>
          <FieldLabel htmlFor="scheduled-task-session-binding">
            {i18nService.t('scheduledTasksFormSessionBinding')}
          </FieldLabel>
          <Select
            items={{
              [SessionBindingStrategy.PerRun]: i18nService.t('scheduledTasksFormSessionBindingPerRun'),
              [SessionBindingStrategy.Task]: i18nService.t('scheduledTasksFormSessionBindingTask'),
              [SessionBindingStrategy.Existing]: i18nService.t('scheduledTasksFormSessionBindingExisting'),
            }}
            value={sessionBinding}
            onValueChange={value => onSessionBindingChange(value as SessionBindingStrategyType)}
          >
            <SelectTrigger id="scheduled-task-session-binding" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={SessionBindingStrategy.PerRun}>
                  {i18nService.t('scheduledTasksFormSessionBindingPerRun')}
                </SelectItem>
                <SelectItem value={SessionBindingStrategy.Task}>
                  {i18nService.t('scheduledTasksFormSessionBindingTask')}
                </SelectItem>
                <SelectItem value={SessionBindingStrategy.Existing}>
                  {i18nService.t('scheduledTasksFormSessionBindingExisting')}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription className="theme-control-caption">
            {i18nService.t(
              `scheduledTasksFormSessionBinding${
                sessionBinding === SessionBindingStrategy.PerRun
                  ? 'PerRun'
                  : sessionBinding === SessionBindingStrategy.Task
                    ? 'Task'
                    : 'Existing'
              }Hint`,
            )}
          </FieldDescription>
          {sessionBinding === SessionBindingStrategy.Existing && (
            <Select
              value={boundSessionId}
              onValueChange={value => onBoundSessionChange(value ?? '')}
            >
              <SelectTrigger className="w-full" aria-invalid={Boolean(errors.boundSessionId)}>
                <SelectValue
                  placeholder={
                    sessionOptionsLoading
                      ? i18nService.t('scheduledTasksFormSessionLoading')
                      : i18nService.t('scheduledTasksFormSessionPlaceholder')
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {sessionOptions.map(session => (
                    <SelectItem key={session.value} value={session.value}>
                      {session.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <FieldError>{errors.boundSessionId}</FieldError>
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
            className="theme-control-sizing-5"
            placeholder={i18nService.t('scheduledTasksFormPromptPlaceholder')}
            aria-invalid={Boolean(errors.payloadText)}
          />
          <FieldDescription className="theme-control-caption">
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
  ),
);

export default TaskFormBody;
