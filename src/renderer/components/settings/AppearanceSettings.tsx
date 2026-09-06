import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Check } from 'lucide-react';
import { useSyncExternalStore, type CSSProperties } from 'react';
import { i18nService } from '../../services/i18n';
import { backgroundStyle, normalizeBackground } from '../../theme/background/background';
import { resolveThemePlugin, themePlugins } from '../../theme/themes/plugins';
import { TOKEN_CONTRACT, TOKEN_NAMES } from '../../theme/tokens/contract';

type Appearance = 'light' | 'dark' | 'system';
const APPEARANCES = ['light', 'dark', 'system'] as const;
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
function subscribeSystemAppearance(onChange: () => void) {
  const query = window.matchMedia(SYSTEM_DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const getSystemDark = () => window.matchMedia(SYSTEM_DARK_QUERY).matches;
const getServerDark = () => false;

function ThemePreview({ styleId, appearance }: { styleId: string; appearance: 'light' | 'dark' }) {
  const theme = resolveThemePlugin(styleId).appearances[appearance];
  const variables = {
    ...Object.fromEntries(TOKEN_NAMES.map(key => [TOKEN_CONTRACT[key], theme.tokens[key]])),
    ...backgroundStyle(normalizeBackground(theme.background)),
  } as CSSProperties;
  return (
    <span
      style={variables}
      data-theme-preview={theme.meta.id}
      aria-hidden="true"
      className="theme-appearance-preview-frame flex aspect-[3/2] w-full overflow-hidden"
    >
      <span className="theme-appearance-preview-sidebar flex w-1/4 flex-col gap-2">
        <span className="theme-appearance-preview-line w-3/4" />
        <span className="theme-appearance-preview-selection w-full" />
        <span className="theme-appearance-preview-muted w-full" />
        <span className="theme-appearance-preview-muted w-3/4" />
        <span className="theme-appearance-preview-muted mt-auto w-1/2" />
      </span>
      <span data-main-canvas className="theme-appearance-preview-main relative flex min-w-0 flex-1 flex-col gap-2">
        <span className="theme-appearance-preview-line w-2/3" />
        <span className="theme-appearance-preview-message mt-2 w-2/3 self-end" />
        <span className="theme-appearance-preview-muted w-full" />
        <span className="theme-appearance-preview-muted w-4/5" />
        <span className="theme-appearance-preview-composer mt-auto flex items-end justify-end">
          <span className="theme-appearance-preview-send" />
        </span>
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
  const systemDark = useSyncExternalStore(subscribeSystemAppearance, getSystemDark, getServerDark);
  const previewAppearance = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
  const language = i18nService.getLanguage() === 'zh' ? 'zh' : 'en';
  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label={i18nService.t('themeStyle')}>
        <h4 className="text-sm font-medium">{i18nService.t('themeStyle')}</h4>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
          {themePlugins.map(plugin => (
            <Button
              key={plugin.id}
              variant="appearance"
              size="appearance"
              aria-pressed={styleId === plugin.id}
              onClick={() => onStyleChange(plugin.id)}
            >
              <ThemePreview styleId={plugin.id} appearance={previewAppearance} />
              <span className="flex w-full items-center justify-between gap-2">
                <span>{plugin.name[language]}</span>
                <Check aria-hidden="true" className={`theme-appearance-preview-check ${styleId === plugin.id ? '' : 'invisible'}`} />
              </span>
            </Button>
          ))}
        </div>
      </section>
      <section className="space-y-3" aria-label={i18nService.t('appearanceMode')}>
        <h4 className="text-sm font-medium">{i18nService.t('appearanceMode')}</h4>
        <FluidTabs<Appearance>
          className="theme-appearance-mode-tabs"
          aria-label={i18nService.t('appearanceMode')}
          value={appearance}
          onValueChange={onAppearanceChange}
          items={APPEARANCES.map(value => ({ value, label: i18nService.t(value) }))}
        />
      </section>
    </div>
  );
}
