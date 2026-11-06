import http from 'node:http';
import { chromium } from 'playwright';

const port = Number(process.env.PREVIEW_PORT ?? 5176);
const baseUrl = `http://127.0.0.1:${port}/`;

async function isServerReady(url) {
  return new Promise(resolve => {
    const req = http.get(url, res => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
  });
}

async function verifyLayout() {
  const ready = await isServerReady(baseUrl);
  if (!ready) {
    console.error(`Preview server not reachable at ${baseUrl}. Ensure preview server is running.`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const results = {
    checks: [],
    errors: [],
  };

  function assert(condition, message, details) {
    if (condition) {
      results.checks.push({ status: 'PASS', message, details });
      console.log(`[PASS] ${message}`);
    } else {
      results.errors.push({ status: 'FAIL', message, details });
      console.error(`[FAIL] ${message}`, details);
    }
  }

  for (const scheme of ['light', 'dark']) {
    console.log(`\n=== Testing 1280x800 layout in ${scheme} mode ===`);
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      colorScheme: scheme,
      locale: 'en-US',
      deviceScaleFactor: 1,
    });

    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', err => {
      if (!err.message.includes('ResizeObserver')) {
        pageErrors.push(err.message);
      }
    });

    try {
      await page.goto(`${baseUrl}?previewSkipBoot=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);

      // 1. Check Root & Body horizontal scrollbars / clipping on 1280x800
      const overflow = await page.evaluate(() => {
        const docEl = document.documentElement;
        const body = document.body;
        return {
          docScrollWidth: docEl.scrollWidth,
          docClientWidth: docEl.clientWidth,
          bodyScrollWidth: body.scrollWidth,
          bodyClientWidth: body.clientWidth,
          hasDocHorizontalScroll: docEl.scrollWidth > docEl.clientWidth,
          hasBodyHorizontalScroll: body.scrollWidth > body.clientWidth,
        };
      });

      assert(
        !overflow.hasDocHorizontalScroll && !overflow.hasBodyHorizontalScroll,
        `No horizontal overflow on root/body at 1280x800 in ${scheme}`,
        overflow,
      );

      // Check all elements for unwanted horizontal overflow beyond viewport width
      const overflowingElements = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('*'));
        const bad = [];
        for (const el of elements) {
          const rect = el.getBoundingClientRect();
          if (rect.right > window.innerWidth + 1) {
            bad.push({
              tag: el.tagName,
              className: el.className?.toString?.().slice(0, 50),
              right: rect.right,
              windowWidth: window.innerWidth,
            });
          }
        }
        return bad.slice(0, 5);
      });

      assert(
        overflowingElements.length === 0,
        `No elements clipping or spilling beyond 1280px viewport in ${scheme}`,
        overflowingElements,
      );

      // 2. Cowork Composer Island Horizontal Centering (Home / Workbench)
      // The stage container is [data-page-canvas]
      const homeComposerGeometry = await page.evaluate(() => {
        const stage =
          document.querySelector('[data-page-canvas]') ||
          document.querySelector('main, .theme-stage, [role="main"]');
        if (!stage) return null;
        const stageRect = stage.getBoundingClientRect();

        // The composer container has class max-w-3xl
        const targetContainer = stage.querySelector('.max-w-3xl');
        if (!targetContainer) return null;

        const targetRect = targetContainer.getBoundingClientRect();
        const leftMargin = targetRect.left - stageRect.left;
        const rightMargin = stageRect.right - targetRect.right;
        const diff = Math.abs(leftMargin - rightMargin);

        return {
          stageRect: { left: stageRect.left, right: stageRect.right, width: stageRect.width },
          targetRect: { left: targetRect.left, right: targetRect.right, width: targetRect.width },
          leftMargin,
          rightMargin,
          diff,
          isSymmetric: diff <= 2, // Allow subpixel rounding
        };
      });

      assert(
        homeComposerGeometry && homeComposerGeometry.isSymmetric,
        `Home Composer island is horizontally centered with symmetric margins in ${scheme}`,
        homeComposerGeometry,
      );

      // 3. Check Sidebar navigation row text alignment
      const sidebarNavAlignment = await page.evaluate(() => {
        const sidebar =
          document.querySelector('aside, [data-testid="sidebar"]') ||
          document.querySelector('.theme-sidebar');
        // Find buttons in sidebar navigation
        const newBtn = Array.from(document.querySelectorAll('button')).find(
          b => b.textContent?.includes('New Task') || b.textContent?.includes('新建任务'),
        );
        const searchBtn = Array.from(document.querySelectorAll('button')).find(
          b => b.textContent?.includes('Search') || b.textContent?.includes('搜索'),
        );
        const navCoding =
          document.querySelector('[data-testid="nav-coding"]') ||
          Array.from(document.querySelectorAll('button')).find(
            b => b.textContent?.includes('Coding') || b.textContent?.includes('编程'),
          );
        const navAutomation = Array.from(document.querySelectorAll('button')).find(
          b => b.textContent?.includes('Automation') || b.textContent?.includes('自动化'),
        );

        function getTextStart(btn) {
          if (!btn) return null;
          // Find the span containing the text
          const textSpan =
            Array.from(btn.querySelectorAll('span')).find(
              s => s.textContent?.trim() && !s.classList.contains('theme-shell-kbd'),
            ) || btn;
          const rect = textSpan.getBoundingClientRect();
          const btnRect = btn.getBoundingClientRect();
          return {
            btnLeft: btnRect.left,
            textLeft: rect.left,
            offsetFromBtn: rect.left - btnRect.left,
          };
        }

        const newPos = getTextStart(newBtn);
        const searchPos = getTextStart(searchBtn);
        const codingPos = getTextStart(navCoding);
        const autoPos = getTextStart(navAutomation);

        return {
          newPos,
          searchPos,
          codingPos,
          autoPos,
        };
      });

      // Verify that offsetFromBtn or textLeft across New, Search, Coding, Automation are aligned
      if (
        sidebarNavAlignment.newPos &&
        sidebarNavAlignment.searchPos &&
        sidebarNavAlignment.codingPos
      ) {
        const offsets = [
          sidebarNavAlignment.newPos.offsetFromBtn,
          sidebarNavAlignment.searchPos.offsetFromBtn,
          sidebarNavAlignment.codingPos.offsetFromBtn,
        ];
        const maxDiff = Math.max(...offsets) - Math.min(...offsets);
        assert(
          maxDiff <= 1.5,
          `Sidebar navigation row text start lines are aligned within 1.5px (actual offsets: ${offsets.map(o => o.toFixed(1)).join(', ')}px) in ${scheme}`,
          sidebarNavAlignment,
        );
      } else {
        assert(
          false,
          `Could not find all sidebar navigation items to measure text alignment in ${scheme}`,
          sidebarNavAlignment,
        );
      }

      // Check Tree node / nested task row alignment in sidebar
      const treeAlignment = await page.evaluate(() => {
        const folderRows = Array.from(
          document.querySelectorAll('.theme-surface-agent-row, .sidebar-session-row'),
        );
        if (folderRows.length === 0) return { skipped: true, reason: 'no session rows visible' };
        const measurements = folderRows.map(row => {
          const textEl = row.querySelector('span, .truncate') || row;
          const rect = textEl.getBoundingClientRect();
          const rowRect = row.getBoundingClientRect();
          return {
            text: textEl.textContent?.trim().slice(0, 20),
            offset: rect.left - rowRect.left,
          };
        });
        return { measurements };
      });
      console.log(`Sidebar tree row measurements in ${scheme}:`, JSON.stringify(treeAlignment));

      // 4. Test Session Detail Composer Centering & Message Flow
      // Click on session item directly (folder is expanded by default)
      const sessionItem = page.getByText('Build a React calculator app').first();
      await sessionItem.click();
      await page.getByText('Scaffold a').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(600);

      const sessionComposerGeometry = await page.evaluate(() => {
        // Find the composer overlay container via the unique .theme-composer-backdrop
        const backdrop = document.querySelector('.theme-composer-backdrop');
        if (!backdrop) return { error: 'backdrop not found' };
        const innerMaxW4xl = backdrop.parentElement;
        if (!innerMaxW4xl) return { error: 'innerMaxW4xl not found' };
        const overlay = innerMaxW4xl.parentElement;
        if (!overlay) return { error: 'overlay not found' };

        const overlayRect = overlay.getBoundingClientRect();
        const innerRect = innerMaxW4xl.getBoundingClientRect();

        const leftMargin = innerRect.left - overlayRect.left;
        const rightMargin = overlayRect.right - innerRect.right;
        const diff = Math.abs(leftMargin - rightMargin);

        // Also check if any message bubbles or turn blocks have redundant pl-4
        const userBubbles = Array.from(document.querySelectorAll('.max-w-4xl.flex-col.items-end'));
        const turnBlocks = Array.from(document.querySelectorAll('.max-w-4xl:not(.flex-col)'));
        const hasPl4InBubbles = userBubbles.some(el => el.classList.contains('pl-4'));
        const hasPl4InTurnBlocks = turnBlocks.some(el => el.classList.contains('pl-4'));

        return {
          overlayRect: {
            left: overlayRect.left,
            right: overlayRect.right,
            width: overlayRect.width,
          },
          innerRect: { left: innerRect.left, right: innerRect.right, width: innerRect.width },
          leftMargin,
          rightMargin,
          diff,
          isSymmetric: diff <= 2,
          hasRedundantPl4: innerMaxW4xl.classList.contains('pl-4'),
          hasPl4InBubbles,
          hasPl4InTurnBlocks,
        };
      });

      assert(
        sessionComposerGeometry &&
          sessionComposerGeometry.isSymmetric &&
          !sessionComposerGeometry.hasRedundantPl4 &&
          !sessionComposerGeometry.hasPl4InBubbles,
        `Session Detail floating composer is horizontally centered with symmetric margins (no pl-4 offset) in ${scheme}`,
        sessionComposerGeometry,
      );

      // Return to home
      const newTaskBtn = page.getByRole('button', { name: 'New Task', exact: true }).first();
      if (await newTaskBtn.isVisible()) {
        await newTaskBtn.click();
        await page.waitForTimeout(500);
      }

      // 5. Test Settings Center Footer Right Alignment
      // Open settings
      const loginBtn = page.getByText('Login', { exact: true }).first();
      if (await loginBtn.isVisible()) {
        await loginBtn.click();
        const settingsMenuItem = page.getByRole('menuitem', { name: 'Settings' });
        await settingsMenuItem.click();
        await page.waitForTimeout(800);

        const settingsTabs = ['General', 'Appearance', 'Shortcuts', 'Model'];
        for (const tab of settingsTabs) {
          const tabBtn = page.getByRole('button', { name: tab, exact: true }).first();
          if (await tabBtn.isVisible()) {
            await tabBtn.click();
            await page.waitForTimeout(400);

            const footerAlignment = await page.evaluate(() => {
              // Find the close button
              const closeBtn = Array.from(document.querySelectorAll('button')).find(
                b => b.textContent?.trim() === 'Close' || b.textContent?.trim() === '关闭',
              );
              if (!closeBtn) return { hasCloseBtn: false };

              const footer = closeBtn.closest('.border-t') || closeBtn.parentElement;
              const footerRect = footer.getBoundingClientRect();
              const btnRect = closeBtn.getBoundingClientRect();

              // Check distance from button right to footer right
              const rightPadding = footerRect.right - btnRect.right;

              // Check if footer container has max-w-3xl constraining it in the middle
              const footerInner = closeBtn.parentElement;
              const isInnerRestricted = footerInner?.classList.contains('max-w-3xl');

              return {
                hasCloseBtn: true,
                footerWidth: footerRect.width,
                btnRight: btnRect.right,
                footerRight: footerRect.right,
                rightPadding,
                isInnerRestricted,
                // Right padding should be typical padding (e.g. 16px to 24px) rather than dangling 300px away!
                isProperlyRightAligned: rightPadding < 48 && !isInnerRestricted,
              };
            });

            assert(
              footerAlignment.hasCloseBtn && footerAlignment.isProperlyRightAligned,
              `Settings [${tab}] footer 'Close' button is properly right-aligned (rightPadding=${footerAlignment.rightPadding}px) in ${scheme}`,
              footerAlignment,
            );
          }
        }

        // Close settings
        const closeBtn = page.getByRole('button', { name: 'Close', exact: true }).first();
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
          await page.waitForTimeout(500);
        }
      }

      // Check console and page errors
      assert(
        consoleErrors.length === 0,
        `Zero console errors in ${scheme} (found: ${consoleErrors.length})`,
        consoleErrors,
      );
      assert(
        pageErrors.length === 0,
        `Zero page errors in ${scheme} (found: ${pageErrors.length})`,
        pageErrors,
      );
    } finally {
      await page.close();
    }
  }

  await browser.close();

  console.log(`\n================ SUMMARY ================`);
  console.log(`Total checks: ${results.checks.length + results.errors.length}`);
  console.log(`Passed: ${results.checks.length}`);
  console.log(`Failed: ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.error(`\nFAILED CHECKS:`);
    for (const err of results.errors) {
      console.error(`- ${err.message}`, err.details);
    }
    process.exit(1);
  } else {
    console.log(`All layout & styling checks passed!`);
  }
}

verifyLayout().catch(err => {
  console.error('Unexpected error running verifyLayout:', err);
  process.exit(1);
});
