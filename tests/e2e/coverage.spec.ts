import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { profile, resumeText } from './fixtures';
import type { Profile } from '../../src/shared/types';

const candidate: Profile = {
  ...profile,
  personal: { ...profile.personal, middleName: 'Robin', preferredFirstName: 'Mo', address2: 'Apt 4', county: 'Wayne', phoneCountryCode: '+1' },
  education: [{ ...profile.education[0], current: false }],
  skills: ['Design', 'Research'],
  workAuthorizations: [{ country: 'United States', authorized: true, sponsorshipRequired: false }],
  answers: [],
};

async function open(page: Page): Promise<void> {
  const html = await readFile(resolve('fixtures/coverage-application.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === 'https://example.test/coverage'
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
  await page.goto('https://example.test/coverage');
  await page.addScriptTag({ path: resolve('dist/chromium/content.js') });
}

test('fills extended profile, date parts, grouped skills and linked hidden upload with no AI or saved answers', async ({ page }) => {
  await open(page);
  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), candidate);
  expect(plan.fields).toContainEqual(expect.objectContaining({ label: 'Skills', status: 'ready', value: ['Design', 'Research'] }));
  expect(plan.fields).toContainEqual(expect.objectContaining({ label: 'Additional notes', status: 'unsupported' }));
  expect(plan.fields.find(field => field.label.includes('sponsorship'))?.status).toBe('unanswered');
  const outcome = await page.evaluate(id => window.__jobrightLocal!.fill(id), plan.scanId);
  expect(outcome.failed).toBe(0);
  await expect(page.getByLabel('Middle name')).toHaveValue('Robin');
  await expect(page.getByLabel('Preferred first name')).toHaveValue('Mo');
  await expect(page.getByLabel('Address line 2')).toHaveValue('Apt 4');
  await expect(page.getByLabel('County', { exact: true })).toHaveValue('Wayne');
  await expect(page.getByLabel('Phone country code')).toHaveValue('1');
  await expect(page.getByLabel('Current employer')).toHaveValue('Maple Co.');
  await expect(page.getByLabel('Current position title')).toHaveValue('Senior Designer');
  await expect(page.getByLabel('Start month')).toHaveValue('08');
  await expect(page.getByLabel('Start year')).toHaveValue('2014');
  await expect(page.getByLabel('Graduation month')).toHaveValue('05');
  await expect(page.getByLabel('Graduation year')).toHaveValue('2018');
  await expect(page.getByLabel('Design', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Research', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Coding', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Are you legally authorized')).toHaveValue('Yes');
  await expect(page.getByLabel('Do you require visa')).toHaveValue('');
  await expect(page.getByLabel('I agree')).not.toBeChecked();
  expect(await page.locator('#resume').evaluate(async (element: HTMLInputElement) => element.files?.item(0)?.text())).toBe(resumeText);
  const undone = await page.evaluate(() => window.__jobrightLocal!.undo());
  expect(undone.skipped).toBe(0);
  await expect(page.getByLabel('Middle name')).toBeEmpty();
  await expect(page.getByLabel('Start month')).toHaveValue('');
  await expect(page.getByLabel('Design', { exact: true })).not.toBeChecked();
  expect(await page.locator('#resume').evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, 'submitCount'))).toBe(0);
});

test('does not overwrite a checkbox group edited after preview or during undo', async ({ page }) => {
  await open(page);
  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), candidate);
  const skill = plan.fields.find(field => field.label === 'Skills')!;
  await page.getByLabel('Coding', { exact: true }).check();
  const skipped = await page.evaluate(({ id, field }) => window.__jobrightLocal!.fill(id, [field]), { id: plan.scanId, field: skill.id });
  expect(skipped.skipped).toBe(1);
  await expect(page.getByLabel('Coding', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Design', { exact: true })).not.toBeChecked();
  const next = await page.evaluate(data => window.__jobrightLocal!.scan(data, { overwriteExisting: true }), candidate);
  await page.evaluate(({ id, field }) => window.__jobrightLocal!.fill(id, [field]), { id: next.scanId, field: next.fields.find(field => field.label === 'Skills')!.id });
  await expect(page.getByLabel('Design', { exact: true })).toBeChecked();
  await page.getByLabel('Research', { exact: true }).uncheck();
  const undone = await page.evaluate(() => window.__jobrightLocal!.undo());
  expect(undone.skipped).toBe(1);
  await expect(page.getByLabel('Design', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Research', { exact: true })).not.toBeChecked();
});
