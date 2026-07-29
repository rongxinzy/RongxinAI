const fs = require('fs');
const path = require('path');

function systemBrowserCandidates() {
  if (process.platform === 'win32') {
    return [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter(Boolean)
      .flatMap(root => [
        path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ];
}

function resolveBrowserExecutable(chromium) {
  const configured = process.env.PPT_BROWSER_EXECUTABLE;
  const bundled = chromium.executablePath();
  return [configured, bundled, ...systemBrowserCandidates()].filter(Boolean).find(fs.existsSync);
}

function browserLaunchOptions(chromium, options = {}) {
  const executablePath = resolveBrowserExecutable(chromium);
  if (!executablePath) {
    throw new Error(
      'No compatible browser found. Install Edge, Chrome, or Chromium, or set PPT_BROWSER_EXECUTABLE.',
    );
  }
  return { ...options, executablePath, headless: true };
}

module.exports = { browserLaunchOptions, resolveBrowserExecutable };
