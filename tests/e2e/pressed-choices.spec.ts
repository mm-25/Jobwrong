import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { emptyProfile } from '../../src/shared/profile';

const url = 'https://jobs.ashbyhq.com/example-studio/pressed-choices/application';
const profile = {
  ...emptyProfile(),
  answers: [
    { question: 'Are you open to relocating to Pittsburgh?', answer: 'Yes' },
    { question: 'Will you require visa sponsorship?', answer: 'Yes' },
    { question: 'Are you available to start next month?', answer: 'Yes' },
  ],
};

test.beforeEach(async ({ page }) => {
  const html = await readFile(resolve('fixtures/pressed-choices.html'), 'utf8');
  await page.route('**/*', (route) => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.goto(url);
  await page.addScriptTag({ path: resolve('dist/chromium/content.js') });
});

test('pressed-button questions commit through click handlers without triggering submit', async ({ page }) => {
  const scan = await page.evaluate((applicant) => window.__jobrightLocal!.scan(applicant, { overwriteExisting: true }), profile);
  expect(scan.fields.map(({ label, status }) => ({ label, status }))).toEqual([
    { label: 'Are you open to relocating to Pittsburgh?', status: 'ready' },
    { label: 'Will you require visa sponsorship?', status: 'ready' },
  ]);

  const result = await page.evaluate((id) => window.__jobrightLocal!.fill(id), scan.scanId);
  expect(result).toMatchObject({ filled: 2, failed: 0 });
  await expect(page.locator('#relocation').getByRole('button', { name: 'Yes', pressed: true })).toBeVisible();
  await expect(page.locator('#relocation input')).toBeChecked();
  await expect(page.locator('#sponsorship').getByRole('button', { name: 'Yes', pressed: true })).toBeVisible();
  await expect(page.locator('#submit-count')).toHaveText('0');
  await expect(page.locator('#unsafe-click-count')).toHaveText('0');

  const undone = await page.evaluate((id) => window.__jobrightLocal!.undo(id), scan.scanId);
  expect(undone).toEqual({ restored: 1, skipped: 1 });
  await expect(page.locator('#sponsorship').getByRole('button', { name: 'No', pressed: true })).toBeVisible();
  await expect(page.locator('#relocation').getByRole('button', { name: 'Yes', pressed: true })).toBeVisible();
});

test('trusted changes away and back invalidate an otherwise identical choice at fill and undo', async ({ page }) => {
  const scanChoices = () => page.evaluate((applicant) => window.__jobrightLocal!.scan(applicant, { overwriteExisting: true }), profile);
  const sponsorship = page.locator('#sponsorship');
  const yes = sponsorship.getByRole('button', { name: 'Yes' });
  const no = sponsorship.getByRole('button', { name: 'No' });

  const stale = await scanChoices();
  await yes.click();
  await no.click();
  const skipped = await page.evaluate((id) => window.__jobrightLocal!.fill(id), stale.scanId);
  expect(skipped.entries).toContainEqual(expect.objectContaining({ label: 'Will you require visa sponsorship?', status: 'skipped' }));
  await expect(no).toHaveAttribute('aria-pressed', 'true');

  const current = await scanChoices();
  const result = await page.evaluate((id) => window.__jobrightLocal!.fill(id), current.scanId);
  expect(result.entries).toContainEqual(expect.objectContaining({ label: 'Will you require visa sponsorship?', status: 'filled' }));
  await no.click();
  await yes.click();
  const undone = await page.evaluate((id) => window.__jobrightLocal!.undo(id), current.scanId);
  expect(undone).toEqual({ restored: 0, skipped: 1 });
  await expect(yes).toHaveAttribute('aria-pressed', 'true');
});
