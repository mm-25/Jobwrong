import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import type { Profile } from '../../src/shared/types';

const applicationUrl = 'https://c3.ai/careers/job/example-designer/followup/';
const profile: Profile = {
  ...emptyProfile(),
  applicationDefaults: {
    onsiteWork: 'yes', hispanicLatino: 'no', raceEthnicity: 'south_asian',
    acceptApplicationPrivacy: true,
  },
};

test('one autofill run fills onsite, applicant privacy, and both race questions that appear later', async ({ page }) => {
  const html = await readFile(resolve('fixtures/c3-followup.html'), 'utf8');
  await page.route('**/*', (route) => route.request().url() === applicationUrl
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.goto(applicationUrl);
  await page.addScriptTag({ path: resolve('dist/chromium/content.js') });

  const race = page.locator('#gh-race');
  const specificRace = page.locator('#specific-race');
  const privacy = page.locator('.application-privacy input');
  await expect(race).toBeHidden();
  await expect(specificRace).toBeHidden();
  await expect(privacy).not.toBeChecked();

  expect(await page.evaluate((candidate) => window.__jobrightPage!.start(candidate), profile)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__jobrightPage!.status())).toMatchObject({
    started: true, running: false, filled: 6, failed: 0, undoAvailable: true,
  });
  await expect(page.locator('#gh-onsite')).toHaveValue('Yes');
  await expect(page.locator('#other-city')).toHaveValue('y');
  await expect(page.locator('#gh-hispanic')).toHaveValue('No');
  await expect(race).toBeVisible();
  await expect(race).toHaveValue('Asian');
  await expect(specificRace).toHaveValue('South Asian');
  await expect(privacy).toBeChecked();
  await expect(page.locator('#terms')).not.toBeChecked();
  expect(await page.evaluate(() => Reflect.get(window, 'fixtureEvents'))).toEqual({
    committed: [
      ['gh-onsite', 'Yes'], ['gh-hispanic', 'No'], ['gh-race', 'Asian'], ['specific-race', 'South Asian'],
    ],
    submitEvents: 0, submitButtonClicks: 0,
  });

  await page.evaluate(() => window.__jobrightPage!.undo());
  await expect(page.locator('#gh-onsite')).toBeEmpty();
  await expect(page.locator('#other-city')).toHaveValue('');
  await expect(page.locator('#gh-hispanic')).toBeEmpty();
  await expect(privacy).not.toBeChecked();
  await expect(race).toBeHidden();
  await expect(race).toBeEmpty();
  await expect(specificRace).toBeEmpty();
  expect(await page.evaluate(() => window.__jobrightPage!.status())).toMatchObject({ undoAvailable: false });
});
