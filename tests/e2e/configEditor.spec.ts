import { expect, test } from '@grafana/plugin-e2e';

const PLUGIN_UID = 'info8fcc-greptimedb-datasource';
const GreptimeDB_URL = 'http://host.docker.internal:4000';

test.describe('Config Editor', () => {
  test('valid credentials should display a success alert on the page', async ({ createDataSourceConfigPage, page }) => {
    const configPage = await createDataSourceConfigPage({ type: PLUGIN_UID });
    await page.locator('input[name="host"]').fill(GreptimeDB_URL);

    await configPage.saveAndTest({
      path: ''
    });
    await expect(configPage).toHaveAlert('success');

    await page.pause();
  });

  test('mandatory fields should show error if left empty', async ({ createDataSourceConfigPage, page }) => {
    const configPage = await createDataSourceConfigPage({ type: PLUGIN_UID });

    await page.locator('input[name="host"]').fill('');
    await page.keyboard.press('Tab');
    await expect(page.getByText('Server address required')).toBeVisible();

    await expect(configPage.saveAndTest({path: ''})).not.toBeOK();
  });
});
