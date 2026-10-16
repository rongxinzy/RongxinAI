import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const SCREENSHOT_DIR = path.join(__dirname, '../docs/browser-preview-screenshots');

test.beforeAll(() => {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
});

test.describe('Browser Preview Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5176');
    await page.waitForLoadState('networkidle');
  });

  test('should render the main interface', async ({ page }) => {
    await expect(page).toHaveTitle(/ZhiYuan|知远/);
  });

  test('should take screenshots in light mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'workbench-light.png'),
      fullPage: false,
    });
  });

  test('should take screenshots in dark mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'workbench-dark.png'),
      fullPage: false,
    });
  });

  test('should navigate to settings', async ({ page }) => {
    const settingsButton = page.getByRole('button', { name: /settings|设置/i });
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await page.waitForTimeout(500);

      await page.emulateMedia({ colorScheme: 'light' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'settings-light.png'),
        fullPage: false,
      });

      await page.emulateMedia({ colorScheme: 'dark' });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'settings-dark.png'),
        fullPage: false,
      });
    }
  });

  test('should load cowork sessions', async ({ page }) => {
    const newChatButton = page.locator('button:has-text("New"), button:has-text("新建")').first();
    if (await newChatButton.isVisible()) {
      await newChatButton.click();
      await page.waitForTimeout(500);

      await page.emulateMedia({ colorScheme: 'light' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'chat-light.png'),
        fullPage: false,
      });
    }
  });

  test('should display skills manager', async ({ page }) => {
    const skillsLink = page.locator('a:has-text("Skills"), a:has-text("技能")').first();
    if (await skillsLink.isVisible()) {
      await skillsLink.click();
      await page.waitForTimeout(500);

      await page.emulateMedia({ colorScheme: 'light' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'skills-light.png'),
        fullPage: false,
      });
    }
  });

  test('should display MCP manager', async ({ page }) => {
    const mcpLink = page.locator('a:has-text("MCP")').first();
    if (await mcpLink.isVisible()) {
      await mcpLink.click();
      await page.waitForTimeout(500);

      await page.emulateMedia({ colorScheme: 'light' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'mcp-light.png'),
        fullPage: false,
      });
    }
  });

  test('should display local inference', async ({ page }) => {
    const localInferenceLink = page.locator('a:has-text("Local"), a:has-text("本地")').first();
    if (await localInferenceLink.isVisible()) {
      await localInferenceLink.click();
      await page.waitForTimeout(500);

      await page.emulateMedia({ colorScheme: 'light' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'local-inference-light.png'),
        fullPage: false,
      });
    }
  });

  test('should display scheduled tasks', async ({ page }) => {
    const scheduledLink = page.locator('a:has-text("Scheduled"), a:has-text("定时")').first();
    if (await scheduledLink.isVisible()) {
      await scheduledLink.click();
      await page.waitForTimeout(500);

      await page.emulateMedia({ colorScheme: 'light' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'scheduled-tasks-light.png'),
        fullPage: false,
      });
    }
  });

  test('should not have console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.reload();
    await page.waitForTimeout(2000);

    const criticalErrors = errors.filter(
      err =>
        !err.includes('[Browser Mock]') && !err.includes('favicon') && !err.includes('sourcemap'),
    );

    expect(criticalErrors).toEqual([]);
  });
});
