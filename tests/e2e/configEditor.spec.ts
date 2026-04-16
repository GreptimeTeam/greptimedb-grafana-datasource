import { expect, test } from '@grafana/plugin-e2e';

const PLUGIN_UID = 'info8fcc-greptimedb-datasource';
const GreptimeDB_URL = 'http://greptimedb:4000';

test.describe('Config Editor', () => {
  test('valid credentials should display a success alert on the page', async ({ createDataSourceConfigPage, page }) => {
    const configPage = await createDataSourceConfigPage({ type: PLUGIN_UID });
    await page.locator('input[name="host"]').fill(GreptimeDB_URL);

    // Bench CI occasionally has a transient portal overlay intercepting pointer events.
    // Use a force click on the Save and Test button to avoid flaky failures.
    await page.getByTestId('data-testid Data source settings page Save and Test button').click({ force: true });
    await expect(configPage).toHaveAlert('success');
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
