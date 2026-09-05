import { Button } from '@shared/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import type { CSSProperties } from 'react';
import { i18nService } from '../../services/i18n';
import { resolveThemePlugin, themePlugins } from '../../theme/themes/plugins';
import { TOKEN_CONTRACT, TOKEN_NAMES } from '../../theme/tokens/contract';

type Appearance = 'light' | 'dark' | 'system';

function ThemePreview({ styleId, appearance }: { styleId: string; appearance: 'light' | 'dark' }) {
  const theme = resolveThemePlugin(styleId).appearances[appearance];
  const variables = Object.fromEntries(
    TOKEN_NAMES.map(key => [TOKEN_CONTRACT[key], theme.tokens[key]]),
  ) as CSSProperties;
  return (
    <span
      style={variables}
      aria-hidden="true"
      className="flex size-full overflow-hidden bg-background"
    >
      <span className="flex w-1/4 flex-col gap-1 bg-surface-raised p-2">
        <span className="h-1 w-full rounded-full bg-muted-foreground/60" />
        <span className="h-1 w-3/4 rounded-full bg-muted-foreground/30" />
        <span className="h-1 w-full rounded-full bg-muted-foreground/30" />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="h-1 w-2/3 rounded-full bg-foreground/50" />
        <span className="h-1 w-full rounded-full bg-muted-foreground/25" />
        <span className="h-1 w-4/5 rounded-full bg-muted-foreground/25" />
        <span className="mt-auto h-5 rounded-sm border border-border bg-card" />
      </span>
    </span>
  );
}

export function AppearanceSettings({
  appearance,
  styleId,
  onAppearanceChange,
  onStyleChange,
}: {
  appearance: Appearance;
  styleId: string;
  onAppearanceChange: (appearance: Appearance) => void;
  onStyleChange: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <h4 className="text-sm font-medium">{i18nService.t('appearance')}</h4>
      {themePlugins.length > 1 && (
        <Select
          value={styleId}
          onValueChange={id => {
            if (id) onStyleChange(id);
          }}
        >
          <SelectTrigger aria-label={i18nService.t('themeStyle')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {themePlugins.map(plugin => (
              <SelectItem key={plugin.id} value={plugin.id}>
                {plugin.name[i18nService.getLanguage() === 'zh' ? 'zh' : 'en']}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="grid grid-cols-3 gap-3">
        {(['light', 'dark', 'system'] as const).map(mode => (
          <Button
            key={mode}
            variant="appearance"
            size="appearance"
            aria-pressed={appearance === mode}
            onClick={() => onAppearanceChange(mode)}
          >
            <span className="flex aspect-[3/2] w-full overflow-hidden rounded-md">
              {mode === 'system' ? (
                <>
                  <span className="w-1/2 overflow-hidden">
                    <ThemePreview styleId={styleId} appearance="light" />
                  </span>
                  <span className="w-1/2 overflow-hidden">
                    <ThemePreview styleId={styleId} appearance="dark" />
                  </span>
                </>
              ) : (
                <ThemePreview styleId={styleId} appearance={mode} />
              )}
            </span>
            <span>{i18nService.t(mode)}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
