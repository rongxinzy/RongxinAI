import { app } from 'electron';

export function getAutoLaunchEnabled(): boolean {
  try {
    // Windows: must pass the same args used in setLoginItemSettings,
    // otherwise openAtLogin defaults to comparing against [] which
    // won't match the registered ['--auto-launched'] and returns false.
    const settings = app.getLoginItemSettings({
      args: ['--auto-launched'],
    });
    return settings.openAtLogin;
  } catch (error) {
    console.error('Failed to get auto-launch settings:', error);
    return false;
  }
}

export function setAutoLaunchEnabled(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // Windows: 通过命令行参数标记自启动
      args: enabled ? ['--auto-launched'] : [],
    });
  } catch (error) {
    console.error('Failed to set auto-launch settings:', error);
    throw error;
  }
}

export function isAutoLaunched(): boolean {
  try {
    if (process.platform === 'darwin') {
      const settings = app.getLoginItemSettings();
      return settings.wasOpenedAtLogin || false;
    }
    // Windows: 检查命令行参数
    return process.argv.includes('--auto-launched');
  } catch (error) {
    console.error('Failed to check auto-launch status:', error);
    return false;
  }
}
