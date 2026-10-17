import { FIXED_TIME_MS } from './constants.mjs';

/** Freeze clocks and disable motion so screenshots stay deterministic. */
export async function applyDeterministicRendering(page) {
  await page.addInitScript(fixedMs => {
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(fixedMs);
          return;
        }
        super(...args);
      }
      static now() {
        return fixedMs;
      }
    };
    Date.now = () => fixedMs;
    Date.parse = RealDate.parse;
    Date.UTC = RealDate.UTC;

    const injectStyle = () => {
      const root = document.documentElement;
      if (!root) return;
      const style = document.createElement('style');
      style.textContent =
        '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; scroll-behavior: auto !important; }';
      root.appendChild(style);
    };
    if (document.documentElement) injectStyle();
    else document.addEventListener('DOMContentLoaded', injectStyle, { once: true });
  }, FIXED_TIME_MS);
}

export function attachConsoleGuards(page, failures, label) {
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('favicon')) return;
    failures.push(`${label} console: ${text}`);
  });
  page.on('pageerror', error => {
    failures.push(`${label} pageerror: ${error.message}`);
  });
}

export async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

export async function home(page, baseUrl, search = '') {
  await page.goto(`${baseUrl}${search}`, { waitUntil: 'domcontentloaded' });
  if (search.includes('previewScenario=error')) {
    await page
      .getByText(/Failed to initialize application|initializationError/)
      .first()
      .waitFor({ timeout: 60_000 });
    return;
  }
  if (search.includes('previewScenario=empty')) {
    await page.getByRole('button', { name: 'New Task', exact: true }).waitFor({ timeout: 60_000 });
    return;
  }
  await page.getByText('Calculator', { exact: true }).first().waitFor({ timeout: 60_000 });
}

export async function openSkills(page) {
  await page.getByRole('button', { name: 'Files & Images' }).first().click();
  await page.getByText('Skills', { exact: true }).first().click();
  await page.getByText('Manage Skills', { exact: true }).click();
  await page.getByText('Word documents').first().waitFor({ timeout: 30_000 });
}

export async function openConnectors(page, { empty = false } = {}) {
  await page.getByRole('button', { name: 'Files & Images' }).first().click();
  await page.getByRole('menuitem', { name: 'Connectors' }).hover();
  await page.getByRole('menuitem', { name: 'Manage Connectors' }).click();
  await page.getByRole('heading', { name: 'Connectors' }).waitFor({ timeout: 30_000 });
  await page.getByRole('tab', { name: /^Installed/ }).click();
  if (empty) {
    await page.getByRole('heading', { name: 'Connectors' }).waitFor({ timeout: 30_000 });
    return;
  }
  await page.getByText('Filesystem', { exact: true }).waitFor({ timeout: 30_000 });
}

export async function openSkillsPage(page, { empty = false } = {}) {
  await page.getByRole('button', { name: 'Files & Images' }).first().click();
  await page.getByText('Skills', { exact: true }).first().click();
  await page.getByText('Manage Skills', { exact: true }).click();
  if (empty) {
    await page.getByRole('heading', { name: 'Skills' }).waitFor({ timeout: 30_000 });
    return;
  }
  await page.getByText('Word documents').first().waitFor({ timeout: 30_000 });
}

export function previewSearch({ scenario, edition, skipBoot = true, extra } = {}) {
  const params = new URLSearchParams();
  if (scenario && scenario !== 'default') params.set('previewScenario', scenario);
  if (edition && edition !== 'zhiyuan') params.set('previewEdition', edition);
  if (skipBoot) params.set('previewSkipBoot', '1');
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
