import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const NATIVE_BUTTON_TRIGGER_FILES = [
  'cowork/PromptPlusMenu.tsx',
  'cowork/PermissionModeMenu.tsx',
  'cowork/CoworkModelPicker.tsx',
  'cowork/ContextUsageIndicator.tsx',
  'cowork/SessionExpertPicker.tsx',
  'skills/SkillsPopover.tsx',
  'scheduledTasks/TaskTimePicker.tsx',
  'scheduledTasks/DateInput.tsx',
] as const;

describe('Base UI trigger semantics', () => {
  test.each(NATIVE_BUTTON_TRIGGER_FILES)(
    '%s declares its rendered button as native',
    relativePath => {
      const source = readFileSync(
        resolve(process.cwd(), 'src/renderer/components', relativePath),
        'utf8',
      );

      expect(source).toContain('nativeButton={true}');
      expect(source).not.toContain('nativeButton={false}');
    },
  );
});
