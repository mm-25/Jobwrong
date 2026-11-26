import { chromium, expect, test } from '@playwright/test';
import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

test('installed Autofill follows a same-document application URL update', async ({}, info) => {
  const extensionPath = info.outputPath('extension');
  const userDataDir = info.outputPath('browser-profile');
  await cp(resolve(process.env.JOBRIGHT_TEST_EXTENSION ?? 'dist/chromium'), extensionPath, { recursive: true });
  await mkdir(userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const initialUrl = 'https://application.example.test/apply?source=LinkedIn';
  const updatedUrl = initialUrl + '&tracking=fixture';
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const options = await context.newPage();
    await options.goto(new URL('options.html', worker.url()).href);
    await options.getByLabel('First name', { exact: true }).fill('Sasha');
    await options.getByRole('button', { name: 'Save profile' }).click();
    await expect(options.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();

    await context.route(initialUrl, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <title>Application</title><h1>Application</h1><form>
        <label>First name<input name="firstName" autocomplete="given-name"></label>
        <label>Last name<input name="lastName" autocomplete="family-name"></label>
        <label>Email<input name="email" type="email"></label>
      </form>` }));
    const page = await context.newPage();
    await page.goto(initialUrl);
    const launcher = page.getByRole('button', { name: 'Open JobRight Local' });
    await expect(launcher).toBeVisible();
    await page.evaluate(url => history.replaceState(history.state, '', url), updatedUrl);
    await expect(page).toHaveURL(updatedUrl);
    await launcher.click();
    const panel = page.getByRole('region', { name: 'JobRight Local autofill' });
    await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('1 filled');
    await expect(page.getByRole('textbox', { name: 'First name' })).toHaveValue('Sasha');
    await panel.getByRole('button', { name: 'Undo last fill' }).click();
    await expect(page.getByRole('textbox', { name: 'First name' })).toBeEmpty();
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
