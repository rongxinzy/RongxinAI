/**
 * Schema-driven form component
 * Renders form fields dynamically from JSON Schema + uiHints
 */

import { Field, FieldLabel } from '@shared/components/ui/field';
import { Switch } from '@shared/components/ui/switch';
import { ChevronRight } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../services/i18n';
import { IMFormGroup, IMInputField, IMSelectField, IMTextareaField } from './IMFormControls';

/** A single uiHint entry from the gateway */
export interface UiHint {
  order?: number;
  label: string;
  sensitive?: boolean;
  advanced?: boolean;
}

/** Props for SchemaForm */
export interface SchemaFormProps {
  /** JSON Schema for this channel (the `properties` object from `schema.properties.channels.properties.<channel>`) */
  schema: Record<string, unknown>;
  /** uiHints entries, already stripped of the `channels.<id>.` prefix. Keys are relative dot paths like 'appKey', 'p2p.policy', etc. */
  hints: Record<string, UiHint>;
  /** Current config value (nested object matching the schema) */
  value: Record<string, unknown>;
  /** Called when any field changes. Path is dot-notation ('p2p.policy'), value is the new value. */
  onChange: (path: string, value: unknown) => void;
  /** Called on field blur (for save-on-blur) */
  onBlur?: () => void;
  /** Map of dot-paths to show/hide state for sensitive fields */
  showSecrets?: Record<string, boolean>;
  /** Toggle secret field visibility */
  onToggleSecret?: (path: string) => void;
  /** Optional field filter by relative dot-path */
  includePath?: (path: string, hint: UiHint) => boolean;
}

/** Deep-get a value from nested object by dot path */
function deepGet(obj: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj as unknown,
    );
}

/** Get JSON Schema property descriptor at a dot path */
function getSchemaProperty(
  schema: Record<string, unknown>,
  path: string,
): Record<string, unknown> | null {
  const keys = path.split('.');
  let current = schema;
  for (const key of keys) {
    const props = (current.properties || current) as Record<string, unknown>;
    const next = props[key] as Record<string, unknown> | undefined;
    if (!next) return null;
    current = next;
  }
  return current;
}

export const SchemaForm: React.FC<SchemaFormProps> = ({
  schema,
  hints,
  value,
  onChange,
  onBlur,
  showSecrets = {},
  onToggleSecret,
  includePath,
}) => {
  // Identify groups and fields
  const groups: string[] = [];
  const topLevelFields: string[] = [];

  // Sort all hint keys by order
  const sortedKeys = Object.keys(hints)
    .filter(key => (includePath ? includePath(key, hints[key]) : true))
    .sort(
      (a, b) =>
        (hints[a].order ?? Number.MAX_SAFE_INTEGER) - (hints[b].order ?? Number.MAX_SAFE_INTEGER),
    );

  for (const key of sortedKeys) {
    // Skip 'enabled' field
    if (key === 'enabled') continue;

    // Check if it's a group (no dot + type: "object")
    if (!key.includes('.')) {
      const schemaProp = getSchemaProperty(schema, key);
      if (schemaProp && schemaProp.type === 'object') {
        groups.push(key);
      } else {
        topLevelFields.push(key);
      }
    }
  }

  // Render a single field
  const renderField = (path: string, hint: UiHint): React.ReactNode => {
    const schemaProp = getSchemaProperty(schema, path);
    if (!schemaProp) return null;

    const fieldValue = deepGet(value, path);
    const handleChange = (newValue: unknown) => {
      onChange(path, newValue);
    };

    const type = schemaProp.type as string;
    const enumValues = schemaProp.enum as string[] | undefined;
    const isBoolean = type === 'boolean';

    // Conditional visibility for allowFrom fields
    if (path.endsWith('.allowFrom')) {
      const policyPath = path.replace('.allowFrom', '.policy');
      const policyValue = deepGet(value, policyPath);
      if (policyValue !== 'allowlist') return null;
    }

    // Boolean toggle
    if (isBoolean) {
      const boolValue = Boolean(fieldValue);
      const fieldId = `im-schema-${path.replaceAll('.', '-')}`;
      return (
        <Field key={path} orientation="horizontal">
          <FieldLabel htmlFor={fieldId}>{hint.label}</FieldLabel>
          <Switch
            id={fieldId}
            checked={boolValue}
            onCheckedChange={checked => handleChange(checked)}
          />
        </Field>
      );
    }

    // String with enum → select
    if (type === 'string' && enumValues) {
      return (
        <IMSelectField
          key={path}
          id={`im-schema-${path.replaceAll('.', '-')}`}
          label={hint.label}
          value={String(fieldValue || '')}
          options={enumValues.map(option => ({ label: option, value: option }))}
          onValueChange={handleChange}
          onOpenChange={open => {
            if (!open) onBlur?.();
          }}
        />
      );
    }

    // String with sensitive → password with show/hide
    if (type === 'string' && hint.sensitive) {
      const shown = showSecrets[path] || false;
      const strValue = String(fieldValue || '');
      return (
        <IMInputField
          key={path}
          id={`im-schema-${path.replaceAll('.', '-')}`}
          label={hint.label}
          type={shown ? 'text' : 'password'}
          value={strValue}
          onChange={e => handleChange(e.target.value)}
          onBlur={onBlur}
          placeholder="••••••••••••"
          clearLabel={i18nService.t('clear')}
          onClear={() => handleChange('')}
          revealLabel={i18nService.t('imShowSecret')}
          concealLabel={i18nService.t('imHideSecret')}
          revealed={shown}
          onRevealChange={() => onToggleSecret?.(path)}
        />
      );
    }

    // String → text input
    if (type === 'string') {
      const strValue = String(fieldValue || '');
      return (
        <IMInputField
          key={path}
          id={`im-schema-${path.replaceAll('.', '-')}`}
          label={hint.label}
          type="text"
          value={strValue}
          onChange={e => handleChange(e.target.value)}
          onBlur={onBlur}
          clearLabel={i18nService.t('clear')}
          onClear={() => handleChange('')}
        />
      );
    }

    // Array → textarea (one line per entry)
    if (type === 'array') {
      const arrValue = Array.isArray(fieldValue) ? fieldValue.map(String).join('\n') : '';
      return (
        <IMTextareaField
          key={path}
          id={`im-schema-${path.replaceAll('.', '-')}`}
          label={hint.label}
          value={arrValue}
          onChange={e => {
            const lines = e.target.value
              .split('\n')
              .map(s => s.trim())
              .filter(Boolean);
            handleChange(lines);
          }}
          onBlur={onBlur}
          className="min-h-16 resize-y"
        />
      );
    }

    // Number / integer → number input
    if (type === 'number' || type === 'integer') {
      const numValue = typeof fieldValue === 'number' ? fieldValue : '';
      return (
        <IMInputField
          key={path}
          id={`im-schema-${path.replaceAll('.', '-')}`}
          label={hint.label}
          type="number"
          value={numValue}
          onChange={e => handleChange(e.target.value ? Number(e.target.value) : undefined)}
          onBlur={onBlur}
        />
      );
    }

    return null;
  };

  // Render a group (collapsible section)
  const renderGroup = (groupKey: string): React.ReactNode => {
    const groupHint = hints[groupKey];
    if (!groupHint) return null;

    // Find all child fields
    const childFields = sortedKeys.filter(
      key => key.startsWith(`${groupKey}.`) && key.split('.').length === 2,
    );

    return (
      <details key={groupKey} className="group">
        <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-muted-foreground select-none py-1">
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
          {groupHint.label}
        </summary>
        <div className="mt-2 border-l-2 border-border-subtle pl-2">
          <IMFormGroup>{childFields.map(field => renderField(field, hints[field]))}</IMFormGroup>
        </div>
      </details>
    );
  };

  return (
    <IMFormGroup>
      {/* Top-level fields */}
      {topLevelFields.map(field => renderField(field, hints[field]))}

      {/* Groups */}
      {groups.map(group => renderGroup(group))}
    </IMFormGroup>
  );
};
