import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { emptyProfile } from '../../src/shared/profile';

const url = 'https://jobs.ashbyhq.com/example-studio/designer/application';
// A full committed option includes country, distinct from the temporary query.
const expectedLocation = 'Detroit, Michigan';
const profile = emptyProfile();
profile.personal.city = 'Detroit';
profile.personal.state = 'Michigan';
profile.personal.country = 'United States';

interface LocationEvents {
  opens: number;
  queries: { value: string; trusted: boolean }[];
  choices: string[];
  unrelatedClicks: number;
  submitClicks: number;
  submits: number;
}

async function loadFixture(page: Page, browserName: string, mode: 'match' | 'no-match' | 'pending') {
  const fixtureUrl = `${url}?mode=${mode}`;
  const html = await readFile(resolve('fixtures/ashby-location.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === fixtureUrl
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
  await page.goto(fixtureUrl);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });
  return page.getByRole('combobox');
}

function events(page: Page): Promise<LocationEvents> {
  return page.evaluate(() => Reflect.get(window, 'locationFixtureEvents'));
}

async function planLocation(page: Page) {
  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), profile);
  expect(plan.fields.find(field => field.label === 'Location')).toMatchObject({ kind: 'combobox', status: 'ready' });
  expect(await events(page)).toMatchObject({ opens: 0, queries: [], choices: [] });
  return plan;
}

test('Ashby searches its late portaled menu and commits only the complete saved location', async ({ page, browserName }) => {
  const location = await loadFixture(page, browserName, 'match');
  const plan = await planLocation(page);
  await expect(location).not.toHaveAttribute('aria-controls');

  const result = await page.evaluate(id => window.__jobrightLocal!.fill(id), plan.scanId);

  expect(result).toMatchObject({ filled: 1, failed: 0 });
  await expect(location).toHaveValue('Detroit, MI, USA');
  await expect(page.locator('#selected-location')).toHaveValue('exact-detroit');
  expect(await events(page)).toEqual({ opens: 1, queries: [{ value: expectedLocation, trusted: false }], choices: ['exact-detroit'],
    unrelatedClicks: 0, submitClicks: 0, submits: 0 });
});

test('Ashby clears its own unmatched query and leaves partial suggestions unselected', async ({ page, browserName }) => {
  const location = await loadFixture(page, browserName, 'no-match');
  const plan = await planLocation(page);

  const result = await page.evaluate(id => window.__jobrightLocal!.fill(id), plan.scanId);

  expect(result).toMatchObject({ filled: 0, failed: 1 });
  await expect(location).toBeEmpty();
  await expect(page.locator('#selected-location')).toBeEmpty();
  expect(await events(page)).toMatchObject({ opens: 1, choices: [], unrelatedClicks: 0, submitClicks: 0, submits: 0 });
  expect((await events(page)).queries.map(query => query.value)).toEqual([expectedLocation, '']);
});

test('Ashby leaves trusted applicant typing intact while an Autofill search is pending', async ({ page, browserName }) => {
  const location = await loadFixture(page, browserName, 'pending');
  const plan = await planLocation(page);
  const filling = page.evaluate(id => window.__jobrightLocal!.fill(id), plan.scanId);
  await expect(location).toHaveValue(expectedLocation, { timeout: 3500 });

  await location.press('ControlOrMeta+a');
  await location.pressSequentially('Boston');
  await expect(location).toHaveValue('Boston');
  await page.evaluate(() => Reflect.get(window, 'releaseFixtureLocationResults')());

  expect(await filling).toMatchObject({ filled: 0 });
  await expect(location).toHaveValue('Boston');
  await expect(page.locator('#selected-location')).toBeEmpty();
  expect(await events(page)).toMatchObject({ opens: 1, choices: [], unrelatedClicks: 0, submitClicks: 0, submits: 0 });
  expect((await events(page)).queries.at(-1)).toEqual({ value: 'Boston', trusted: true });
});
