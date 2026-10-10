import {
  type EnterpriseRendererInitializeMessage,
  EnterpriseRendererTheme,
  EnterpriseRendererThemeVariables,
} from '../../renderer-contract.js';

export function applyEnterpriseTheme(message: EnterpriseRendererInitializeMessage): void {
  const root = document.documentElement;
  root.classList.toggle('dark', message.theme === EnterpriseRendererTheme.Dark);
  root.style.colorScheme = message.theme;
  for (const variable of EnterpriseRendererThemeVariables) {
    const value = message.themeVariables?.[variable];
    // No stylesheet/selector/URL capability is accepted from the host message.
    if (typeof value === 'string' && value.length <= 1024 && !/[;{}]|url\s*\(/i.test(value)) {
      root.style.setProperty(variable, value);
    } else {
      root.style.removeProperty(variable);
    }
  }
}
