import { expect, test } from '@grafana/plugin-e2e';

const PLUGIN_UID = 'info8fcc-greptimedb-datasource';
const GreptimeDB_URL = process.env.GREPTIMEDB_URL || 'http://greptimedb:4000';

const dismissBlockingModal = async (page: any) => {
  // Best effort: close any visible modal/dialog that may intercept clicks.
  for (let i = 0; i < 3; i++) {
    const dialogs = page.locator('[role="dialog"]:visible');
    const count = await dialogs.count();
    if (count === 0) {
      return;
    }

    const topDialog = dialogs.nth(count - 1);

    const closeButton = topDialog
      .locator(
        [
          'button[aria-label*="close" i]',
          'button[title*="close" i]',
          'button[aria-label*="dismiss" i]',
          'button[title*="dismiss" i]',
          'button[aria-label="x" i]',
        ].join(', ')
      )
      .first();

    if (await closeButton.isVisible()) {
      await closeButton.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }

    await page.waitForTimeout(300);
  }
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
    await expect(saveAndTestButton).toBeEnabled({ timeout: 10000 });
    await saveAndTestButton.scrollIntoViewIfNeeded();
    await dismissBlockingModal(page);
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
