import { expect } from '@playwright/test';
import path from 'node:path';

/** Real main and quick windows using only the existing isolated loopback model fixture. */
export async function verifyHomeSurfaces(main, quick, output) {
  await expect(main.getByTestId('sidebar-view-companion')).toHaveAttribute('aria-current', 'page');
  const homeInput = main.getByRole('textbox');
  const quickInput = quick.getByRole('textbox');
  await expect(homeInput).toBeEnabled();
  await homeInput.fill('A draft kept in the main companion page');
  await quickInput.fill('A draft kept in the quick window');
  const initial = await main.evaluate(() => window.electron.companion.bootstrap());
  const original = initial.profiles.find(profile => profile.petId === initial.activePetId);
  const other = initial.profiles.find(profile => profile.petId !== initial.activePetId);
  expect(initial.profiles).toHaveLength(7);
  await quick.evaluate(id => window.companion.select(id), other.petId);
  await expect
    .poll(() =>
      main.evaluate(() => window.electron.companion.bootstrap().then(state => state.activePetId)),
    )
    .toBe(other.petId);
  await expect(homeInput).toHaveValue('');
  await expect(quickInput).toHaveValue('');
  await expect(main.locator('[data-companion-portrait]')).toHaveAttribute(
    'data-companion-portrait',
    other.characterId,
  );
  const rejected = await main.evaluate(async petId => {
    const api = window.electron.companion;
    const submit = await api
      .submit({
        petId,
        requestId: crypto.randomUUID(),
        text: 'This stale request must never execute',
      })
      .then(
        () => false,
        () => true,
      );
    const stop = await api.stop(petId).then(
      () => false,
      () => true,
    );
    return { submit, stop };
  }, original.petId);
  expect(rejected).toEqual({ submit: true, stop: true });
  await quick.evaluate(id => window.companion.select(id), original.petId);
  await expect(homeInput).toHaveValue('A draft kept in the main companion page');
  await expect(quickInput).toHaveValue('A draft kept in the quick window');
  await main.evaluate(
    characterId => window.electron.desktopPet.setSettings({ characterId }),
    other.characterId,
  );
  await expect(main.locator('[data-companion-portrait]')).toHaveAttribute(
    'data-companion-portrait',
    other.characterId,
  );
  await expect(quick.locator('[data-companion-portrait]')).toHaveAttribute(
    'data-companion-portrait',
    other.characterId,
  );
  const changed = await main.evaluate(() => window.electron.companion.bootstrap());
  const identity = changed.profiles.find(profile => profile.petId === changed.activePetId);
  expect(identity.petId).toBe(original.petId);
  expect(identity.personaId).toBe(original.personaId);
  await main.evaluate(
    characterId => window.electron.desktopPet.setSettings({ characterId }),
    original.characterId,
  );
  await expect(main.locator('[data-companion-portrait]')).toHaveAttribute(
    'data-companion-portrait',
    original.characterId,
  );
  await expect(quick.locator('[data-companion-portrait]')).toHaveAttribute(
    'data-companion-portrait',
    original.characterId,
  );
  await homeInput.fill('Native shared conversation');
  await homeInput.press('Enter');
  await expect(main.getByText('Native companion reply is shared', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(quick.getByText('Native companion reply is shared', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(main.getByText('Native shared conversation', { exact: true })).toHaveCount(1);
  await expect(quick.getByText('Native shared conversation', { exact: true })).toHaveCount(1);
  await expect(quickInput).toHaveValue('A draft kept in the quick window');
  await homeInput.fill('A draft kept in the main companion page');
  await main.getByTestId('sidebar-view-workbench').click();
  await expect(main.getByTestId('sidebar-view-workbench')).toHaveAttribute('aria-current', 'page');
  await main.getByRole('textbox').fill('A separate workbench draft');
  await main.getByTestId('sidebar-view-companion').click();
  await expect(main.getByTestId('sidebar-view-companion')).toHaveAttribute('aria-current', 'page');
  await expect(homeInput).toBeVisible();
  await expect(homeInput).toHaveValue('A draft kept in the main companion page');
  await main.screenshot({ path: path.join(output, 'companion-home.png') });
  await quickInput.fill('');
  return {
    profileCount: initial.profiles.length,
    sharedIdentity: true,
    sharedConversation: true,
    staleRequestsRejected: rejected,
    independentDrafts: true,
    appearancePreservesIdentity: true,
  };
}
