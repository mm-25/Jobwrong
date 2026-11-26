import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { formUrls, profile } from './fixtures';

const candidate = {
  ...profile,
  answers: [],
  personal: { ...profile.personal, preferredFirstName: 'Mo', phone: '(313) 555-0123', phoneCountryCode: '' },
  education: [
    { ...profile.education[0], current: false },
    {
      ...profile.education[1], school: 'University of Michigan', campus: 'Ann Arbor',
      startDate: '2026-09', endDate: '2028-05', current: true,
    },
  ],
  applicationDefaults: { ...profile.applicationDefaults, referralSource: 'linkedin' as const },
  workAuthorizations: [
    { country: 'United States', authorized: true, fullTimeAuthorized: false },
    { country: 'Canada', authorized: false },
  ],
};

async function open(page: Page, browserName: string, fixture: 'lever' | 'greenhouse') {
  const url = formUrls[fixture];
  const html = await readFile(resolve('fixtures/common-fields.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
  await page.goto(url);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });
}

async function fill(page: Page, data = candidate) {
  const plan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), data);
  return page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), plan.scanId);
}

async function expectUnsubmitted(page: Page, fixture: 'lever' | 'greenhouse') {
  await expect(page.locator('#application-form')).toHaveAttribute('data-submit-events', '0');
  await expect(page.locator('#application-form')).toHaveAttribute('data-submit-clicks', '0');
  await expect(page).toHaveURL(formUrls[fixture]);
}

test('fills Lever education, preferred name, scoped authorization, and referral without changing a manual answer', async ({ page, browserName }) => {
  await open(page, browserName, 'lever');
  // The applicant's residence differs from the country of the posting.
  const outcome = await fill(page, { ...candidate, personal: { ...candidate.personal, country: 'Canada' } });

  await expect(page.locator('#preferred-name')).toHaveValue('Mo');
  const university = page.locator('#university');
  await expect(university).toHaveValue('michigan-ann-arbor');
  await expect(university.locator('option:checked')).toHaveText('University of Michigan - Ann Arbor');
  await expect(page.locator('#graduation-year')).toHaveValue('2028');
  await expect(page.locator('#work-yes')).toBeChecked();
  await expect(page.locator('#work-no')).not.toBeChecked();
  await expect(page.locator('#referral')).toHaveValue('linkedin');
  await expect(page.locator('#location-input')).toHaveValue('Manual location');
  expect(outcome).toMatchObject({ filled: 5, failed: 0 });
  await expectUnsubmitted(page, 'lever');
});

test('commits Greenhouse country and full-time authorization through delayed linked menus', async ({ page, browserName }) => {
  await open(page, browserName, 'greenhouse');
  const outcome = await fill(page);

  const phoneCountry = page.locator('#dialing-country .select__single-value');
  await expect(phoneCountry).toHaveText('+1');
  await expect(phoneCountry.locator('.iti__flag.iti__us')).toBeVisible();
  await expect(page.locator('#full-time .select__single-value')).toHaveText('No');
  const values = await page.locator('form').evaluate((form: HTMLFormElement) => {
    const data = new FormData(form);
    return { country: data.get('country'), authorization: data.get('work_authorization') };
  });
  expect(values).toEqual({ country: 'us', authorization: 'no' });
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByLabel('First name')).toHaveValue('Manual first name');
  expect(outcome).toMatchObject({ filled: 3, failed: 0 });
  await expectUnsubmitted(page, 'greenhouse');
});
