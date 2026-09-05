import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@shared/components/ui/field';
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
import { Plus, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { validateMcpTransportFields } from '../../../shared/mcpValidation';
import { i18nService } from '../../services/i18n';
import { McpRegistryEntry, McpServerConfig, McpServerFormData } from '../../types/mcp';

interface McpServerFormModalProps {
  isOpen: boolean;
  server?: McpServerConfig | null; // null = create mode, defined = edit mode
  registryEntry?: McpRegistryEntry | null; // install from registry mode
  existingNames: string[];
  onClose: () => void;
  onSave: (data: McpServerFormData) => Promise<{ success: boolean; error?: string }>;
}

const McpServerFormModal: React.FC<McpServerFormModalProps> = ({
  isOpen,
  server,
  registryEntry,
  existingNames,
  onClose,
  onSave,
}) => {
  const isEdit = !!server;
  const isRegistry = !!registryEntry && !isEdit;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [transportType, setTransportType] = useState<'stdio' | 'sse' | 'http'>('stdio');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [envRows, setEnvRows] = useState<{ key: string; value: string; required?: boolean }[]>([]);
  const [url, setUrl] = useState('');
  const [headerRows, setHeaderRows] = useState<{ key: string; value: string }[]>([]);
  const [timeoutText, setTimeoutText] = useState('60');
  const [error, setError] = useState('');
  const [envErrors, setEnvErrors] = useState<Record<number, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (server) {
      // Edit mode
      setName(server.name);
      setDescription(server.description);
      setTransportType(server.transportType);
      setCommand(server.command || '');
      setArgsText((server.args || []).join('\n'));
      const requiredKeys = new Set(registryEntry?.requiredEnvKeys ?? []);
      setEnvRows(
        server.env
          ? Object.entries(server.env).map(([key, value]) => ({
              key,
              value,
              required: requiredKeys.has(key) || undefined,
            }))
          : [],
      );
      setUrl(server.url || '');
      setHeaderRows(
        server.headers
          ? Object.entries(server.headers).map(([key, value]) => ({ key, value }))
          : [],
      );
      setTimeoutText(String(server.timeout ?? 60));
    } else if (registryEntry) {
      // Registry install mode — pre-fill from template
      setName(registryEntry.name);
      const registryDescription =
        (i18nService.getLanguage() === 'zh'
          ? registryEntry.description_zh || registryEntry.description_en
          : registryEntry.description_en || registryEntry.description_zh) ||
        (registryEntry.descriptionKey ? i18nService.t(registryEntry.descriptionKey) : '');
      setDescription(registryDescription);
      setTransportType(registryEntry.transportType);
      setCommand(registryEntry.command || '');
      // defaultArgs + argPlaceholders
      const allArgs = [...(registryEntry.defaultArgs || [])];
      if (registryEntry.argPlaceholders) {
        allArgs.push(...registryEntry.argPlaceholders);
      }
      setArgsText(allArgs.join('\n'));
      // Pre-fill required env keys
      const envEntries: { key: string; value: string; required?: boolean }[] = [];
      if (registryEntry.requiredEnvKeys) {
        for (const k of registryEntry.requiredEnvKeys) {
          envEntries.push({ key: k, value: '', required: true });
        }
      }
      if (registryEntry.optionalEnvKeys) {
        for (const k of registryEntry.optionalEnvKeys) {
          envEntries.push({ key: k, value: '', required: false });
        }
      }
      setEnvRows(envEntries);
      setUrl(registryEntry.url || '');
      setHeaderRows(
        Object.entries(registryEntry.headers || {}).map(([key, value]) => ({ key, value })),
      );
      setTimeoutText('60');
    } else {
      // Create mode
      setName('');
      setDescription('');
      setTransportType('stdio');
      setCommand('');
      setArgsText('');
      setEnvRows([]);
      setUrl('');
      setHeaderRows([]);
      setTimeoutText('60');
    }
    setError('');
    setEnvErrors({});
  }, [isOpen, server, registryEntry]);

  const buildValidatedFormData = (): McpServerFormData | null => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(i18nService.t('mcpNameRequired'));
      return null;
    }

    const otherNames = existingNames.filter(n => !isEdit || n !== server?.name);
    if (otherNames.includes(trimmedName)) {
      setError(i18nService.t('mcpNameExists'));
      return null;
    }

    const validatedCommand = command.trim();
    const validatedUrl = url.trim();
    const transportErrorKey = validateMcpTransportFields(transportType, {
      command: validatedCommand,
      url: validatedUrl,
    });
    if (transportErrorKey) {
      setError(i18nService.t(transportErrorKey));
      return null;
    }

    const missingRequiredIndices: Record<number, boolean> = {};
    envRows.forEach((row, index) => {
      if (row.required && !row.value.trim()) {
        missingRequiredIndices[index] = true;
      }
    });
    if (Object.keys(missingRequiredIndices).length > 0) {
      setEnvErrors(missingRequiredIndices);
      return null;
    }

    const args = argsText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const env: Record<string, string> = {};
    for (const row of envRows) {
      const k = row.key.trim();
      if (k) env[k] = row.value;
    }

    const headers: Record<string, string> = {};
    for (const row of headerRows) {
      const k = row.key.trim();
      if (k) headers[k] = row.value;
    }

    const data: McpServerFormData = {
      name: trimmedName,
      description: description.trim(),
      transportType,
    };

    const timeout = Number(timeoutText);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600) {
      setError(i18nService.t('mcpTimeoutInvalid'));
      return null;
    }
    data.timeout = timeout;

    if (transportType === 'stdio') {
      data.command = validatedCommand;
      if (args.length > 0) data.args = args;
      if (Object.keys(env).length > 0) data.env = env;
    } else {
      data.url = validatedUrl;
      if (Object.keys(headers).length > 0) data.headers = headers;
    }

    if (isRegistry && registryEntry) {
      data.isBuiltIn = true;
      data.registryId = registryEntry.id;
    }

    return data;
  };

  const handleSave = () => {
    const data = buildValidatedFormData();
    if (!data) return;
    void (async () => {
      setError('');
      setIsSaving(true);
      try {
        const result = await onSave(data);
        if (!result.success) {
          setError(result.error || i18nService.t('mcpCreateFailed'));
        }
      } finally {
        setIsSaving(false);
      }
    })();
  };

  const handleAddEnvRow = () => {
    setEnvRows([...envRows, { key: '', value: '' }]);
  };

  const handleRemoveEnvRow = (index: number) => {
    setEnvRows(envRows.filter((_, i) => i !== index));
  };

  const handleUpdateEnvRow = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...envRows];
    updated[index] = { ...updated[index], [field]: val };
    setEnvRows(updated);
    if (field === 'value' && envErrors[index]) {
      setEnvErrors(prev => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  };

  const handleAddHeaderRow = () => {
    setHeaderRows([...headerRows, { key: '', value: '' }]);
  };

  const handleRemoveHeaderRow = (index: number) => {
    setHeaderRows(headerRows.filter((_, i) => i !== index));
  };

  const handleUpdateHeaderRow = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...headerRows];
    updated[index] = { ...updated[index], [field]: val };
    setHeaderRows(updated);
  };

  if (!isOpen) return null;

  // Title
  const modalTitle = isEdit
    ? i18nService.t('editMcpServer')
    : isRegistry
      ? `${i18nService.t('mcpInstall')} ${registryEntry!.name}`
      : i18nService.t('addMcpServer');

  // Save button text
  const saveText =
    isRegistry && !isEdit ? i18nService.t('mcpInstall') : i18nService.t('saveMcpServer');

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="theme-control-sizing-19">
          <DialogTitle>{modalTitle}</DialogTitle>
        </DialogHeader>

        <FieldGroup className="gap-4">
          {/* Name */}
          <Field data-disabled={isRegistry || undefined}>
            <FieldLabel htmlFor="mcp-server-name">
              {i18nService.t('mcpServerName')}
              <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              id="mcp-server-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={i18nService.t('mcpServerNamePlaceholder')}
              disabled={isRegistry}
              autoFocus={!isRegistry}
            />
          </Field>

          {/* Description */}
          <Field>
            <FieldLabel htmlFor="mcp-server-description">
              {i18nService.t('mcpServerDescription')}
            </FieldLabel>
            <Input
              id="mcp-server-description"
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={i18nService.t('mcpServerDescriptionPlaceholder')}
            />
          </Field>

          {/* Transport Type */}
          <Field data-disabled={isRegistry || undefined}>
            <FieldLabel htmlFor="mcp-transport-type">
              {i18nService.t('mcpTransportType')}
            </FieldLabel>
            <Select
              value={transportType}
              onValueChange={value => setTransportType(value as 'stdio' | 'sse' | 'http')}
              disabled={isRegistry}
            >
              <SelectTrigger id="mcp-transport-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="stdio">{i18nService.t('mcpTransportStdio')}</SelectItem>
                  <SelectItem value="sse">{i18nService.t('mcpTransportSse')}</SelectItem>
                  <SelectItem value="http">{i18nService.t('mcpTransportHttp')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {/* stdio fields */}
          {transportType === 'stdio' && (
            <>
              <Field data-disabled={isRegistry || undefined}>
                <FieldLabel htmlFor="mcp-command">
                  {i18nService.t('mcpCommand')}
                  <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  id="mcp-command"
                  type="text"
                  value={command}
                  onChange={e => setCommand(e.target.value)}
                  placeholder={i18nService.t('mcpCommandPlaceholder')}
                  disabled={isRegistry}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="mcp-args">{i18nService.t('mcpArgs')}</FieldLabel>
                <Textarea
                  id="mcp-args"
                  value={argsText}
                  onChange={e => setArgsText(e.target.value)}
                  placeholder={i18nService.t('mcpArgsPlaceholder')}
                  rows={3}
                  autoFocus={isRegistry}
                />
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldTitle>
                    {i18nService.t('mcpEnvVars')}
                    {isRegistry && envRows.some(r => r.required) && (
                      <span className="text-destructive">
                        * {i18nService.t('mcpRequiredConfig')}
                      </span>
                    )}
                  </FieldTitle>
                  <Button type="button" variant="ghost" size="sm" onClick={handleAddEnvRow}>
                    <Plus data-icon="inline-start" />
                    {i18nService.t('addKeyValue')}
                  </Button>
                </div>
                {envRows.map((row, index) => (
                  <Field
                    key={index}
                    data-invalid={Boolean(envErrors[index]) || undefined}
                    className="gap-0.5"
                  >
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        value={row.key}
                        onChange={e => handleUpdateEnvRow(index, 'key', e.target.value)}
                        placeholder={i18nService.t('mcpHeaderKey')}
                        disabled={row.required}
                      />
                      <Input
                        type="text"
                        value={row.value}
                        onChange={e => handleUpdateEnvRow(index, 'value', e.target.value)}
                        placeholder={
                          row.required ? `${row.key} *` : i18nService.t('mcpHeaderValue')
                        }
                        aria-invalid={Boolean(envErrors[index])}
                        autoFocus={isRegistry && index === 0 && !!row.required}
                      />
                      {!row.required && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveEnvRow(index)}
                          className="shrink-0"
                        >
                          <Trash2 />
                        </Button>
                      )}
                      {row.required && (
                        <span className="w-4 shrink-0 text-center text-xs text-destructive">*</span>
                      )}
                    </div>
                    {envErrors[index] && row.required && (
                      <FieldError>{i18nService.t('mcpEnvRequired')}</FieldError>
                    )}
                  </Field>
                ))}
              </Field>
            </>
          )}

          {/* sse / http fields */}
          {(transportType === 'sse' || transportType === 'http') && (
            <>
              <Field>
                <FieldLabel htmlFor="mcp-url">
                  {i18nService.t('mcpUrl')}
                  <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  id="mcp-url"
                  type="text"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder={i18nService.t('mcpUrlPlaceholder')}
                />
              </Field>

              <Field>
                <div className="flex items-center justify-between">
                  <FieldTitle>{i18nService.t('mcpHeaders')}</FieldTitle>
                  <Button type="button" variant="ghost" size="sm" onClick={handleAddHeaderRow}>
                    <Plus data-icon="inline-start" />
                    {i18nService.t('addKeyValue')}
                  </Button>
                </div>
                {headerRows.map((row, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={row.key}
                      onChange={e => handleUpdateHeaderRow(index, 'key', e.target.value)}
                      placeholder={i18nService.t('mcpHeaderKey')}
                    />
                    <Input
                      type="text"
                      value={row.value}
                      onChange={e => handleUpdateHeaderRow(index, 'value', e.target.value)}
                      placeholder={i18nService.t('mcpHeaderValue')}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveHeaderRow(index)}
                      className="shrink-0"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </Field>
            </>
          )}

          <Field>
            <FieldLabel htmlFor="mcp-timeout">{i18nService.t('mcpTimeout')}</FieldLabel>
            <Input
              id="mcp-timeout"
              type="number"
              min="1"
              max="600"
              value={timeoutText}
              onChange={event => setTimeoutText(event.target.value)}
            />
            <p className="text-sm text-muted-foreground">{i18nService.t('mcpTimeoutHint')}</p>
          </Field>

          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            {i18nService.t('cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={isSaving}>
            {isSaving ? i18nService.t('testing') : saveText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default McpServerFormModal;
