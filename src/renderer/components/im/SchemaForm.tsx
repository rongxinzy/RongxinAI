/**
 * Schema-driven form component
 * Renders form fields dynamically from JSON Schema + uiHints
 */

import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { Textarea } from '@shared/components/ui/textarea';
import { ChevronRight, Eye, EyeOff,XCircle } from 'lucide-react';
import React from 'react';

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
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj as unknown);
}



/** Get JSON Schema property descriptor at a dot path */
function getSchemaProperty(schema: Record<string, unknown>, path: string): Record<string, unknown> | null {
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
    .filter((key) => includePath ? includePath(key, hints[key]) : true)
    .sort((a, b) => (hints[a].order ?? Number.MAX_SAFE_INTEGER) - (hints[b].order ?? Number.MAX_SAFE_INTEGER));

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
      return (
        <div key={path} className="flex items-center justify-between py-1">
          <label className="text-xs font-medium text-secondary">
            {hint.label}
          </label>
          <Switch
            checked={boolValue}
            onCheckedChange={(checked) => handleChange(checked)}
          />
        </div>
      );
    }

    // String with enum → select
    if (type === 'string' && enumValues) {
      return (
        <div key={path} className="space-y-1.5">
          <label className="block text-xs font-medium text-secondary">
            {hint.label}
          </label>
          <Select
            value={String(fieldValue || '')}
            onValueChange={(value) => handleChange(value)}
            onOpenChange={(open) => {
              if (!open) onBlur?.();
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {enumValues.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }

    // String with sensitive → password with show/hide
    if (type === 'string' && hint.sensitive) {
      const shown = showSecrets[path] || false;
      const strValue = String(fieldValue || '');
      return (
        <div key={path} className="space-y-1.5">
          <label className="block text-xs font-medium text-secondary">
            {hint.label}
          </label>
          <div className="relative">
            <Input
              type={shown ? 'text' : 'password'}
              value={strValue}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={onBlur}
              className="pr-16"
              placeholder="••••••••••••"
            />
            <div className="absolute right-2 inset-y-0 flex items-center gap-1">
              {strValue && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleChange('')}
                  title="Clear"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onToggleSecret?.(path)}
              >
                {shown ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // String → text input
    if (type === 'string') {
      const strValue = String(fieldValue || '');
      return (
        <div key={path} className="space-y-1.5">
          <label className="block text-xs font-medium text-secondary">
            {hint.label}
          </label>
          <div className="relative">
            <Input
              type="text"
              value={strValue}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={onBlur}
              className="pr-8"
            />
            {strValue && (
              <div className="absolute right-2 inset-y-0 flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleChange('')}
                  title="Clear"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      );
    }

    // Array → textarea (one line per entry)
    if (type === 'array') {
      const arrValue = Array.isArray(fieldValue) ? fieldValue.map(String).join('\n') : '';
      return (
        <div key={path} className="space-y-1.5">
          <label className="block text-xs font-medium text-secondary">
            {hint.label}
          </label>
          <Textarea
            value={arrValue}
            onChange={(e) => {
              const lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
              handleChange(lines);
            }}
            onBlur={onBlur}
            className="min-h-[60px] resize-y"
          />
        </div>
      );
    }

    // Number / integer → number input
    if (type === 'number' || type === 'integer') {
      const numValue = typeof fieldValue === 'number' ? fieldValue : '';
      return (
        <div key={path} className="space-y-1.5">
          <label className="block text-xs font-medium text-secondary">
            {hint.label}
          </label>
          <Input
            type="number"
            value={numValue}
            onChange={(e) => handleChange(e.target.value ? Number(e.target.value) : undefined)}
            onBlur={onBlur}
          />
        </div>
      );
    }

    return null;
  };

  // Render a group (collapsible section)
  const renderGroup = (groupKey: string): React.ReactNode => {
    const groupHint = hints[groupKey];
    if (!groupHint) return null;

    // Find all child fields
    const childFields = sortedKeys.filter((key) => key.startsWith(`${groupKey}.`) && key.split('.').length === 2);

    return (
      <details key={groupKey} className="group">
        <summary className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-secondary select-none py-1">
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
          {groupHint.label}
        </summary>
        <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-subtle">
          {childFields.map((field) => renderField(field, hints[field]))}
        </div>
      </details>
    );
  };

  return (
    <div className="space-y-3">
      {/* Top-level fields */}
      {topLevelFields.map((field) => renderField(field, hints[field]))}

      {/* Groups */}
      {groups.map((group) => renderGroup(group))}
    </div>
  );
};
