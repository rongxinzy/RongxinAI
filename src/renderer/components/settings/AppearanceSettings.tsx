import { Button } from '@shared/components/ui/button';
import { FluidTabs } from '@shared/components/ui/fluid-tabs';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { i18nService } from '../../services/i18n';
import { backgroundStyle, normalizeBackground } from '../../theme/background/background';
import { modalOverlayBlur } from '../../theme/components/modal-overlay-style';
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
  // 2026/09/16 lixiang  风格切换可能较慢：先显示「设置中」再异步应用，避免界面无反馈
  const [pendingStyleId, setPendingStyleId] = useState<string | null>(null);
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (applyTimerRef.current !== null) clearTimeout(applyTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (pendingStyleId !== null && pendingStyleId === styleId) {
      setPendingStyleId(null);
    }
  }, [pendingStyleId, styleId]);

  const handleStyleChange = (id: string) => {
    if (id === styleId || pendingStyleId !== null) return;
    setPendingStyleId(id);
    applyTimerRef.current = setTimeout(() => {
      applyTimerRef.current = null;
      // 2026/09/16 lixiang  不在这里清 pending，等 styleId 跟上后再清，避免结束态与高亮空一拍
      onStyleChange(id);
    }, 0);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label={i18nService.t('themeStyle')}>
        <h4 className="text-sm font-medium">{i18nService.t('themeStyle')}</h4>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3">
          {themePlugins.map(plugin => {
            const isPending = pendingStyleId === plugin.id;
            // 设置中也保持高亮，结束后勾选已在选中态上
            const isActive = styleId === plugin.id || isPending;
            return (
              <Button
                key={plugin.id}
                variant="appearance"
                size="appearance"
                className="relative overflow-hidden"
                aria-pressed={isActive}
                aria-busy={isPending || undefined}
                disabled={pendingStyleId !== null && !isPending}
                onClick={() => handleStyleChange(plugin.id)}
              >
                <ThemePreview styleId={plugin.id} appearance={previewAppearance} />
                <span className="flex w-full items-center justify-between gap-2">
                  <span>{plugin.name[language]}</span>
                  <Check
                    aria-hidden="true"
                    className={`theme-appearance-preview-check ${styleId === plugin.id && !isPending ? '' : 'invisible'}`}
                  />
                </span>
                {/* 2026/09/16 lixiang  设置中：灰色文案 + 与全局弹窗同级 blur(2px) 毛玻璃 */}
                {isPending && (
                  <span
                    className="absolute inset-0 z-[1] flex items-center justify-center bg-background/20 text-sm font-medium text-foreground/70"
                    style={{ backdropFilter: modalOverlayBlur['backdrop-filter'] }}
                    role="status"
                  >
                    {i18nService.t('themeStyleApplying')}
                  </span>
                )}
              </Button>
            );
          })}
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
