/**
 * 在真正拉起开发窗口之前写好开始菜单快捷方式。
 * Windows 任务栏在进程启动时就按 AppUserModelID 找快捷方式；
 * 等到窗口创建后再写，第一次仍会落到 Electron 原子图标缓存。
 */
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const APP_USER_MODEL_ID = 'com.zhiyuanagent.app.dev';
const projectRoot = path.resolve(__dirname, '..');
const iconPath = path.join(projectRoot, 'build', 'icons', 'win', 'icon.ico');
const electronExe = process.execPath;

app.setAppUserModelId(APP_USER_MODEL_ID);

app.whenReady().then(() => {
  if (!fs.existsSync(iconPath)) {
    console.error('[shortcut] 知远 logo 不存在:', iconPath);
    app.exit(1);
    return;
  }
  const programsDir = path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  fs.mkdirSync(programsDir, { recursive: true });
  for (const name of fs.readdirSync(programsDir)) {
    if (!name.endsWith('.lnk') || name === 'ZhiYuan-Dev.lnk') continue;
    if (name.includes('开发') || name.includes('知远') || /ZhiYuan|zhiyuan/i.test(name)) {
      try {
        fs.unlinkSync(path.join(programsDir, name));
      } catch {
        /* ignore */
      }
    }
  }
  const shortcutPath = path.join(programsDir, 'ZhiYuan-Dev.lnk');
  const wrote = shell.writeShortcutLink(shortcutPath, 'create', {
    target: electronExe,
    args: '--remote-debugging-port=9222 .',
    cwd: projectRoot,
    appUserModelId: APP_USER_MODEL_ID,
    icon: iconPath,
    iconIndex: 0,
    description: '知远',
  });
  if (!wrote || !fs.existsSync(shortcutPath)) {
    console.error('[shortcut] 写入失败:', shortcutPath);
    app.exit(1);
    return;
  }
  console.log('[shortcut] ready', shortcutPath);
  app.exit(0);
});
