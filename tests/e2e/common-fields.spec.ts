import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { formUrls, profile } from './fixtures';
import { emptyProfile } from '../../src/shared/profile';

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

test('native controls accept numbered questions and nonempty placeholder values without inventing age', async ({ page, browserName }) => {
  const url = 'https://laketrust.csod.com/ux/ats/careersite/1/requisition/1404/application?c=laketrust&lang=en-US#2';
  const html = await readFile(resolve('fixtures/native-question-variants.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === url.split('#')[0]
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
  await page.goto(url);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });
  const data = { ...emptyProfile(), applicationDefaults: { gender: 'male' as const, referralSource: 'linkedin' as const },
    workAuthorizations: [{ country: 'United States', authorized: true }] };
  const plan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), data);
  const result = await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), plan.scanId);
  expect(result).toMatchObject({ filled: 3, failed: 0 });
  await expect(page.locator('input[name="source"][value="39"]')).toBeChecked();
  await expect(page.locator('input[name="authorization"][value="1-True"]')).toBeChecked();
  await expect(page.locator('select[id="EEOQuestion-1"]')).toHaveValue('2');
  await expect(page.locator('#age')).toHaveValue('0');
  await page.locator('select[id="EEOQuestion-1"]').selectOption('1');
  await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), plan.scanId);
  await expect(page.locator('select[id="EEOQuestion-1"]')).toHaveValue('1');
  await expect(page.locator('input[name="source"][value="39"]')).not.toBeChecked();
  await expect(page.locator('input[name="authorization"][value="1-True"]')).not.toBeChecked();
  await expect(page.locator('body')).toHaveAttribute('data-submits', '0');
  await expect(page).toHaveURL(url);
});

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

test('fills region-grounded authorization and a descriptive portfolio request, preserving a manual edit on Undo', async ({ page, browserName }) => {
  await open(page, browserName, 'lever');
  await page.locator('.posting-header .location').evaluate(element => { element.textContent = 'New York, NY'; });
  await page.locator('#application-form').evaluate(form => {
    const field = document.createElement('div');
    field.className = 'application-question';
    field.innerHTML = '<div class="application-label">Please provide the link to a portfolio demonstrating at least one software interface design project.</div>'
      + '<div class="application-field"><textarea id="design-portfolio"></textarea></div>';
    form.append(field);
  });
  const data = { ...candidate, personal: { ...candidate.personal, country: 'Canada' } };
  const scan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), data);
  const outcome = await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), scan.scanId);
  expect(outcome).toMatchObject({ filled: 6, failed: 0 });
  await expect(page.locator('#work-yes')).toBeChecked();
  await expect(page.locator('#design-portfolio')).toHaveValue(candidate.personal.website);
  await page.locator('#design-portfolio').fill('https://designer.example/specific-project');
  await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), scan.scanId);
  await expect(page.locator('#work-yes')).not.toBeChecked();
  await expect(page.locator('#work-no')).not.toBeChecked();
  await expect(page.locator('#design-portfolio')).toHaveValue('https://designer.example/specific-project');
  await expectUnsubmitted(page, 'lever');
});
