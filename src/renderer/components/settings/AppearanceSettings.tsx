import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { i18nService } from '../../services/i18n';
import { resolveThemePlugin, themePlugins } from '../../theme/themes/plugins';

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

// 2026/09/17 lixiang  外观只展示主色正方形色块 + 风格名
function ThemePrimarySwatch({
  styleId,
  appearance,
}: {
  styleId: string;
  appearance: 'light' | 'dark';
}) {
  const theme = resolveThemePlugin(styleId).appearances[appearance];
  const primary = theme.tokens.primary;
  return (
    <span
      data-theme-preview={theme.meta.id}
      aria-hidden="true"
      className="size-5 shrink-0 rounded-md border border-border"
      style={{ backgroundColor: primary }}
      title="primary"
    />
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
        {/* 2026/09/17 lixiang  仅主色块+名称同一行，不填按钮背景色；一行最多 5 个 */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {themePlugins.map(plugin => {
            const isPending = pendingStyleId === plugin.id;
            // 设置中也保持高亮，结束后勾选已在选中态上
            const isActive = styleId === plugin.id || isPending;
            return (
              <Button
                key={plugin.id}
                variant="outline"
                size="sm"
                className={`h-auto min-h-0 w-full justify-start gap-1.5 px-2 py-2 ${isActive ? 'border-primary ring-1 ring-primary' : ''}`}
                aria-pressed={isActive}
                aria-busy={isPending || undefined}
                disabled={pendingStyleId !== null && !isPending}
                onClick={() => handleStyleChange(plugin.id)}
              >
                <ThemePrimarySwatch styleId={plugin.id} appearance={previewAppearance} />
                <span className="min-w-0 flex-1 truncate text-left text-xs font-medium">
                  {plugin.name[language]}
                </span>
                {/* 2026/09/17 lixiang  设置中显示加载转圈，完成后显示勾选 */}
                {isPending ? (
                  <Spinner className="size-3.5 shrink-0" aria-label={i18nService.t('themeStyleApplying')} />
                ) : (
                  <Check
                    aria-hidden="true"
                    className={`theme-appearance-preview-check size-3.5 shrink-0 ${styleId === plugin.id ? '' : 'invisible'}`}
                  />
                )}
              </Button>
            );
          })}
        </div>
      </section>
      <section className="space-y-3" aria-label={i18nService.t('appearanceMode')}>
        <h4 className="text-sm font-medium">{i18nService.t('appearanceMode')}</h4>
        {/* 2026/09/17 lixiang  明暗模式改为三个独立按钮，选中项用主题色 */}
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={i18nService.t('appearanceMode')}
        >
          {APPEARANCES.map(value => {
            const selected = appearance === value;
            return (
              <Button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                variant={selected ? 'default' : 'outline'}
                size="sm"
                className="min-w-20"
                onClick={() => onAppearanceChange(value)}
              >
                {i18nService.t(value)}
              </Button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
