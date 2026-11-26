import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import type { Profile } from '../../src/shared/types';

const greenhouseUrl = 'https://c3.ai/careers/job/example-designer/';
const workdayUrl = 'https://example-studio.wd1.myworkdayjobs.com/en-US/External/job/design/apply';
const sponsorLabel = 'Do you now or will you in the future need C3 AI to sponsor you for a visa to work in the United States (e.g., H-1B; O-1; TN; E-3)?';

const applicationProfile: Profile = {
  ...emptyProfile(),
  applicationDefaults: {
    visaSponsorship: 'yes', gender: 'male', disability: 'no', veteran: 'no',
    hispanicLatino: 'no', acceptApplicationPrivacy: true,
  },
};

async function openApplication(page: Page, fixture: 'semantic-application' | 'workday-nested', url: string) {
  const html = await readFile(resolve('fixtures', fixture + '.html'), 'utf8');
  await page.route('**/*', (route) => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.goto(url);
  await page.addScriptTag({ path: resolve('dist/chromium/content.js') });
}

function scan(page: Page, profile: Profile) {
  return page.evaluate((candidate) => window.__jobrightLocal!.scan(candidate), profile);
}

function fill(page: Page, scanId: string) {
  return page.evaluate((id) => window.__jobrightLocal!.fill(id), scanId);
}

function fixtureEvents(page: Page) {
  return page.evaluate(() => Reflect.get(window, 'fixtureEvents'));
}

test('fills explicit defaults across C3-style application controls and honors privacy scope', async ({ page }, info) => {
  await openApplication(page, 'semantic-application', greenhouseUrl);

  const withoutPrivacy = { ...applicationProfile, applicationDefaults: {
    ...applicationProfile.applicationDefaults, acceptApplicationPrivacy: false,
  } };
  const previewOnly = await scan(page, withoutPrivacy);
  expect(previewOnly.fields.filter(({ label }) => label === 'I Accept').map(({ status }) => status)).toEqual([
    'unsupported', 'unsupported',
  ]);

  const plan = await scan(page, applicationProfile);
  expect(plan.platform).toBe('Greenhouse');
  expect(plan.fields.find(({ label }) => label === sponsorLabel)).toMatchObject({ kind: 'combobox', value: 'Yes' });
  expect(plan.fields.filter(({ status }) => status === 'ready').map(({ value }) => value)).toEqual([
    'Yes', 'No', 'Man', 'No, I do not have a disability and have not had one in the past',
    'No', true, true, 'Yes', 'No', 'Not Hispanic or Latino', 'I am not a protected veteran', true,
  ]);
  expect(await fixtureEvents(page)).toMatchObject({ listboxOpens: 0, submitEvents: 0 });
  expect(await fill(page, plan.scanId)).toMatchObject({ filled: 12, failed: 0, undoAvailable: true });

  await expect(page.locator('#gh-sponsorship')).toHaveValue('I need visa sponsorship');
  await expect(page.locator('#inverse')).toHaveValue('No');
  await expect(page.getByRole('radio', { name: 'Man', exact: true })).toBeChecked();
  await expect(page.locator('#disability')).toHaveValue('n');
  await expect(page.locator('input[name=disability_radio][value=no]')).toBeChecked();
  await expect(page.locator('input[name=no_disability]')).toBeChecked();
  await expect(page.locator('#disability-check')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#disability-inverse')).toHaveValue('Yes');
  await expect(page.locator('#disability-menu')).toHaveText('I do not have a disability');
  await expect(page.locator('input[name=hispanic][value=n]')).toBeChecked();
  await expect(page.locator('input[name=hispanic][value=y]')).not.toBeChecked();
  await expect(page.locator('#veteran')).toHaveValue('not-protected');
  await expect(page.locator('input[name=privacy_accept]')).toBeChecked();
  await expect(page.locator('input[name=general_accept]')).not.toBeChecked();
  await expect(page.locator('input[name=sms_consent]')).not.toBeChecked();
  await expect(page.locator('input[name=mixed_terms]')).not.toBeChecked();
  await expect(page.locator('#authorization')).toBeEmpty();
  await expect(page.locator('#signature')).toBeEmpty();
  await expect(page.locator('[role=listbox]')).toHaveCount(0);
  expect(await fixtureEvents(page)).toEqual({ listboxOpens: 2, submitEvents: 0, submitButtonClicks: 0 });
  await page.screenshot({ path: info.outputPath('application-defaults.png'), fullPage: true });
});

test('selects a scoped Workday leaf and reverses it in the live DOM', async ({ page }, info) => {
  await openApplication(page, 'workday-nested', workdayUrl);
  const plan = await scan(page, {
    ...emptyProfile(), answers: [{ question: 'How did you hear about us?', answer: 'Design conference' }],
  });

  expect(plan.platform).toBe('Workday');
  expect(plan.fields).toEqual([expect.objectContaining({
    label: 'How did you hear about us?', kind: 'combobox', status: 'ready', value: 'Design conference',
  })]);
  expect(await fixtureEvents(page)).toMatchObject({ openings: 0, branches: [], selected: [] });
  expect(await fill(page, plan.scanId)).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  await expect(page.locator('#source')).toHaveText('Design conference');
  expect(await fixtureEvents(page)).toMatchObject({
    branches: expect.arrayContaining(['Job boards', 'Events']),
    selected: ['Design conference'], outsideClicks: 0, submissions: 0,
  });
  await page.screenshot({ path: info.outputPath('workday-referral.png'), fullPage: true });

  const undo = await page.evaluate(() => window.__jobrightLocal!.undo());
  expect(undo).toMatchObject({ restored: 1, skipped: 0 });
  await expect(page.locator('#source')).toHaveText('Select one');
});
