import { expect, test } from '@grafana/plugin-e2e';

const PLUGIN_UID = 'info8fcc-greptimedb-datasource';
const GreptimeDB_URL = process.env.GREPTIMEDB_URL || 'http://greptimedb:4000';

const dismissBlockingModal = async (page: any) => {
  // Close visible dialogs via explicit close controls (no text dependency).
  for (let i = 0; i < 4; i++) {
    const dialogs = page.locator('[role="dialog"]:visible');
    const count = await dialogs.count();
    if (count === 0) {
      return;
    }

    const topDialog = dialogs.nth(count - 1);

    const dialogCloseByName = topDialog.getByRole('button', {
      name: /close|dismiss|skip|not now|x/i,
    }).first();
    const dialogCloseByAttrs = topDialog
      .locator(
        [
          'button[aria-label*="close" i]',
          'button[title*="close" i]',
          'button[aria-label*="dismiss" i]',
          'button[title*="dismiss" i]',
          'button[data-testid*="close" i]',
          'button[aria-label="x" i]',
        ].join(', ')
      )
      .first();
    const globalCloseByAttrs = page
      .locator(
        [
          '[role="dialog"]:visible button[aria-label*="close" i]',
          '[role="dialog"]:visible button[title*="close" i]',
          '[role="dialog"]:visible button[data-testid*="close" i]',
        ].join(', ')
      )
      .first();

    if (await dialogCloseByName.isVisible()) {
      await dialogCloseByName.click({ force: true });
    } else if (await dialogCloseByAttrs.isVisible()) {
      await dialogCloseByAttrs.click({ force: true });
    } else if (await globalCloseByAttrs.isVisible()) {
      await globalCloseByAttrs.click({ force: true });
    } else {
      throw new Error('Blocking dialog is visible but no close button was found');
    }

    await expect(topDialog).not.toBeVisible({ timeout: 10000 });
  }

  // Some onboarding dialogs leave the page in a locked-scroll state.
  // Ensure the test can scroll and interact with lower page controls.
  await page.evaluate(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.pointerEvents = 'auto';
  });
};

test.describe('Config Editor', () => {
  test('valid credentials should display a success alert on the page', async ({ createDataSourceConfigPage, page }) => {
    test.setTimeout(90000);

    await createDataSourceConfigPage({ type: PLUGIN_UID });
    await expect(page).toHaveURL(/\/connections\/datasources\/edit\//);
    await dismissBlockingModal(page);

    const hostInput = page.locator('input[name="host"]');
    await expect(hostInput).toBeVisible({ timeout: 20000 });
    await hostInput.fill(GreptimeDB_URL);
    await expect(hostInput).toHaveValue(GreptimeDB_URL);
    await page.keyboard.press('Tab');

    // Bench CI occasionally has a transient portal overlay intercepting pointer events.
    // Use a force click on the Save and Test button to avoid flaky failures.
    const saveAndTestButton = page.getByRole('button', { name: /save and test/i });
    await saveAndTestButton.scrollIntoViewIfNeeded();
    await expect(saveAndTestButton).toBeEnabled({ timeout: 10000 });
    await dismissBlockingModal(page);
    await saveAndTestButton.scrollIntoViewIfNeeded();
    await saveAndTestButton.click({ force: true });

    const successAlert = page.getByTestId('data-testid Alert success').first();
    const errorAlert = page.getByTestId('data-testid Alert error').first();
    await expect(successAlert.or(errorAlert)).toBeVisible({ timeout: 60000 });

    if (await errorAlert.isVisible()) {
      throw new Error(`Save and Test failed: ${await errorAlert.innerText()}`);
    }

    await expect(successAlert).toContainText('Database Connection OK');
  });

  test('mandatory fields should show error if left empty', async ({ createDataSourceConfigPage, page }) => {
    const configPage = await createDataSourceConfigPage({ type: PLUGIN_UID });

    await page.locator('input[name="host"]').fill('');
    await page.keyboard.press('Tab');
    await expect(page.getByText('Server address required')).toBeVisible();
    await expect(configPage).not.toHaveAlert('success');
    // await expect(configPage.saveAndTest({path: ''})).not.toBeOK();
  });
});
