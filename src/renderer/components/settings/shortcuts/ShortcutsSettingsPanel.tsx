import { Button } from '@shared/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import React, { useEffect, useRef, useState } from 'react';

import type { AppConfig } from '../../../config';
import { i18nService } from '../../../services/i18n';
import { formatShortcutLabel } from '../../../services/shortcutLabel';
import { SEND_SHORTCUT_OPTIONS } from '../constants';

type ShortcutsSettings = NonNullable<AppConfig['shortcuts']>;

// System shortcuts that should not be captured (clipboard, undo, select-all, quit, etc.)
const isSystemShortcut = (e: KeyboardEvent): boolean => {
  const key = e.key.toLowerCase();
  if (e.metaKey && ['c', 'v', 'x', 'z', 'y', 'a', 'q', 'w'].includes(key)) return true;
  if (e.metaKey && e.shiftKey && key === 'z') return true;
  if (e.ctrlKey && ['c', 'v', 'x', 'z', 'y', 'a', 'w'].includes(key)) return true;
  return false;
};

const formatShortcutFromEvent = (e: React.KeyboardEvent): string | null => {
  // Skip standalone modifier keys
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;
  // Require at least one non-Shift modifier
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return null;
  if (isSystemShortcut(e.nativeEvent)) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const keyMap: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ' ': 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab',
  };
  const key = keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(key);
  return parts.join('+');
};

const isMacPlatform = navigator.platform.includes('Mac');

const ShortcutRecorder: React.FC<{ id: string; value: string; onChange: (v: string) => void }> = ({
  id,
  value,
  onChange,
}) => {
  const [recording, setRecording] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setRecording(false);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      onChange('');
      setRecording(false);
      return;
    }
    const shortcut = formatShortcutFromEvent(e);
    if (shortcut) {
      onChange(shortcut);
      setRecording(false);
    }
  };

  useEffect(() => {
    if (!recording) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) setRecording(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [recording]);

  return (
    <Button
      ref={buttonRef}
      id={id}
      type="button"
      variant="outline"
      data-shortcut-input="true"
      onKeyDown={handleKeyDown}
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      className={`theme-shortcut-input w-36 justify-center select-none ${recording ? 'theme-shortcut-recording' : ''}`}
    >
      {value ? formatShortcutLabel(value, isMacPlatform) : i18nService.t('shortcutNotSet')}
    </Button>
  );
};

const SendShortcutSelect: React.FC<{
  id: string;
  value: string;
  onChange: (v: string) => void;
}> = ({ id, value, onChange }) => {
  const currentLabel = (() => {
    const opt = SEND_SHORTCUT_OPTIONS.find(o => o.value === value);
    if (!opt) return value;
    return isMacPlatform ? opt.labelMac : opt.label;
  })();

  return (
    <Select value={value} onValueChange={newValue => onChange(newValue ?? value)}>
      <SelectTrigger id={id} className="theme-send-shortcut-trigger w-36">
        <SelectValue placeholder={currentLabel} />
      </SelectTrigger>
      <SelectContent className="theme-send-shortcut-popup">
        {SEND_SHORTCUT_OPTIONS.map(option => {
          const label = isMacPlatform ? option.labelMac : option.label;
          return (
            <SelectItem
              key={option.value}
              value={option.value}
              className="theme-send-shortcut-option"
            >
              {label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

interface ShortcutsSettingsPanelProps {
  shortcuts: ShortcutsSettings;
  onShortcutChange: (key: keyof ShortcutsSettings, value: string) => void;
}

export default function ShortcutsSettingsPanel({
  shortcuts,
  onShortcutChange,
}: ShortcutsSettingsPanelProps) {
  return (
    <FieldGroup className="gap-4">
      <Field orientation="horizontal">
        <FieldLabel htmlFor="shortcut-new-chat">{i18nService.t('newChat')}</FieldLabel>
        <ShortcutRecorder
          id="shortcut-new-chat"
          value={shortcuts.newChat}
          onChange={v => onShortcutChange('newChat', v)}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="shortcut-search">{i18nService.t('search')}</FieldLabel>
        <ShortcutRecorder
          id="shortcut-search"
          value={shortcuts.search}
          onChange={v => onShortcutChange('search', v)}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="shortcut-open-settings">{i18nService.t('openSettings')}</FieldLabel>
        <ShortcutRecorder
          id="shortcut-open-settings"
          value={shortcuts.settings}
          onChange={v => onShortcutChange('settings', v)}
        />
      </Field>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="shortcut-send-message">
          {i18nService.t('sendMessageShortcut')}
        </FieldLabel>
        <SendShortcutSelect
          id="shortcut-send-message"
          value={shortcuts.sendMessage}
          onChange={v => onShortcutChange('sendMessage', v)}
        />
      </Field>
    </FieldGroup>
  );
}
