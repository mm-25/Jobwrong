import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { emptyProfile } from '../../../src/shared/profile';

const url = 'https://job-boards.greenhouse.io/example-studio/jobs/5004000';
const city = 'Springfield';
const caption = 'Springfield, Missouri, United States';
const profile = emptyProfile();
Object.assign(profile.personal, { city, state: 'MO', country: 'USA' });

interface FixtureEvents {
  queries: { value: string; trusted: boolean }[];
  keyUps: string[];
  selected: { index: number; optionCount: number }[];
  clears: number;
  submits: number;
  submitClicks: number;
}

function activity(page: Page): Promise<FixtureEvents> {
  return page.evaluate(() => Reflect.get(window, 'locationFixtureEvents'));
}

async function fixture(page: Page, browserName: string, mode = 'match') {
  const target = `${url}?mode=${mode}`;
  const html = await readFile(resolve('fixtures/greenhouse-location.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === target
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
  await page.goto(target);
  await page.addScriptTag({ path: resolve(process.env.JOBRIGHT_E2E_DIST ?? 'dist', browserName, 'content.js') });
  return page.getByRole('combobox', { name: 'Location (City)' });
}

async function plan(page: Page) {
  const result = await page.evaluate(data => window.__jobrightLocal!.scan(data), profile);
  expect(result.fields).toMatchObject([{ label: 'Location (City)', status: 'ready' }]);
  expect(await activity(page)).toMatchObject({ queries: [], selected: [] });
  return result.scanId;
}

test('Greenhouse queries its city picker, verifies the duplicate captions, and clears only the selected city on Undo', async ({ page, browserName }) => {
  const input = await fixture(page, browserName);
  const scanId = await plan(page);
  const filled = await page.evaluate(id => window.__jobrightLocal!.fill(id), scanId);
  expect(filled, JSON.stringify(filled.entries)).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  await expect(input).toBeEmpty();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.select__single-value')).toHaveText(caption);
  expect(await activity(page)).toEqual({ queries: [{ value: city, trusted: false }], keyUps: ['ArrowDown'], selected: [{ index: 0, optionCount: 2 }],
    clears: 0, submits: 0, submitClicks: 0 });
  expect(await page.evaluate(id => window.__jobrightLocal!.undo(id), scanId)).toEqual({ restored: 1, skipped: 0 });
  await expect(input).toBeEmpty();
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.select__single-value')).toHaveCount(0);
  expect(await activity(page)).toMatchObject({ clears: 1, submits: 0, submitClicks: 0 });
});

for (const mode of ['no-match', 'disagree', 'hidden-option']) {
  test(`Greenhouse leaves its city blank after ${mode} search results`, async ({ page, browserName }) => {
    const input = await fixture(page, browserName, mode);
    const result = await page.evaluate(id => window.__jobrightLocal!.fill(id), await plan(page));
    expect(result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
    await expect(input).toBeEmpty();
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(await activity(page)).toMatchObject({ queries: [{ value: city }, { value: '' }], keyUps: ['ArrowDown', 'Escape'],
      selected: [], clears: 0, submits: 0, submitClicks: 0 });
  });
}

test('Greenhouse leaves incomplete profile locations unsearched', async ({ page, browserName }) => {
  await fixture(page, browserName);
  const data = { ...profile, personal: { ...profile.personal, state: '' } };
  const scan = await page.evaluate(data => window.__jobrightLocal!.scan(data), data);
  expect(scan.fields).toMatchObject([{ status: 'unanswered' }]);
  expect(await page.evaluate(id => window.__jobrightLocal!.fill(id), scan.scanId)).toMatchObject({ filled: 0, failed: 0 });
  expect(await activity(page)).toMatchObject({ queries: [], selected: [], clears: 0, submits: 0 });
});

test('Greenhouse preserves a manual query written while the search is pending', async ({ page, browserName }) => {
  const input = await fixture(page, browserName, 'pending');
  const scanId = await plan(page);
  const filling = page.evaluate(id => window.__jobrightLocal!.fill(id), scanId);
  await expect(input).toHaveValue(city);
  await input.fill('Boston');
  await page.evaluate(() => Reflect.get(window, 'releaseFixtureLocationResults')());
  expect(await filling).toMatchObject({ filled: 0, undoAvailable: false });
  await expect(input).toHaveValue('Boston');
  expect(await activity(page)).toMatchObject({ queries: [{ value: city }, { value: 'Boston', trusted: true }], selected: [], clears: 0, submits: 0 });
});

test('Greenhouse will not treat query text as a committed city selection', async ({ page, browserName }) => {
  await fixture(page, browserName, 'no-receipt');
  const result = await page.evaluate(id => window.__jobrightLocal!.fill(id), await plan(page));
  expect(result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  await expect(page.locator('.select__single-value')).toHaveCount(0);
  expect(await activity(page)).toMatchObject({ selected: [{ index: 0, optionCount: 2 }], clears: 0, submits: 0 });
});

test('Greenhouse will not count a selection with a hidden region and country as committed', async ({ page, browserName }) => {
  await fixture(page, browserName, 'hidden-receipt');
  const result = await page.evaluate(id => window.__jobrightLocal!.fill(id), await plan(page));
  expect(result).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  await expect(page.locator('.select__single-value')).toHaveText(city, { useInnerText: true });
  expect(await activity(page)).toMatchObject({ selected: [{ index: 0, optionCount: 2 }], clears: 0, submits: 0 });
});

test('Greenhouse leaves an altered selection alone on Undo if its container gains an independent token', async ({ page, browserName }) => {
  await fixture(page, browserName);
  const scanId = await plan(page);
  expect(await page.evaluate(id => window.__jobrightLocal!.fill(id), scanId)).toMatchObject({ filled: 1, undoAvailable: true });
  await page.locator('.select__value-container').evaluate(element => {
    const choice = document.createElement('div');
    choice.className = 'select__multi-value';
    choice.textContent = 'Applicant preference';
    element.append(choice);
  });
  expect(await page.evaluate(id => window.__jobrightLocal!.undo(id), scanId)).toEqual({ restored: 0, skipped: 1 });
  await expect(page.locator('.select__single-value')).toHaveText(caption);
  await expect(page.locator('.select__multi-value')).toHaveText('Applicant preference');
  expect(await activity(page)).toMatchObject({ clears: 0, submits: 0 });
});
