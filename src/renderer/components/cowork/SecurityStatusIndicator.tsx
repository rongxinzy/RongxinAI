import { i18nService } from '../../services/i18n';

/** One real status in the home title bar: local safety mode, not a rotating slogan. */
const SecurityStatusIndicator = () => (
  <div
    className="theme-home-status flex items-center"
    title={i18nService.t('securityLocalModeHint')}
  >
    <span className="theme-home-status-dot shrink-0" aria-hidden="true" />
    <span className="whitespace-nowrap">{i18nService.t('securityLocalMode')}</span>
  </div>
);

export default SecurityStatusIndicator;
