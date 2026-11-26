import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import { formUrls } from './fixtures';

const jobUrl = 'https://example.wd5.myworkdayjobs.com/en-US/Careers/job/USA-CO-Boulder/Designer_JR-123-1/apply';
const jobEndpoint = 'https://example.wd5.myworkdayjobs.com/wday/cxs/example/Careers/job/USA-CO-Boulder/Designer_JR-123-1';
const jobMetadata = { jobPostingInfo: {
  title: 'Designer', jobReqId: 'JR-123', externalUrl: jobUrl.replace('/en-US', '').replace('/apply', ''),
  location: 'USA, CO, Boulder', country: { descriptor: 'United States of America', id: 'us-id' },
  jobRequisitionLocation: { descriptor: 'USA, CO, Boulder', country: { descriptor: 'United States of America', id: 'us-id', alpha2Code: 'US' } },
} };
const jobProfile = { ...emptyProfile(), personal: { ...emptyProfile().personal, country: 'Canada' },
  workAuthorizations: [{ country: 'US', authorized: true }, { country: 'Canada', authorized: false }],
  applicationDefaults: { relocation: 'yes' as const, visaSponsorship: 'yes' as const } };

test('Workday fieldset questions fill through lazy menus, preserve manual edits on Undo, and leave attestation alone', async ({ page, browserName }) => {
  const url = formUrls.workday + '?questionnaire=true';
  const html = await readFile(resolve('fixtures/workday-questionnaire.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
  await page.goto(url);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });
  const profile = { ...emptyProfile(), applicationDefaults: { relocation: 'yes' as const, visaSponsorship: 'yes' as const } };
  const plan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), profile);
  expect(plan.fields.filter(field => field.status === 'ready').map(field => field.label)).toEqual([
    'Would you consider relocating for this role?', 'Will you require visa sponsorship?',
  ]);
  const result = await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), plan.scanId);
  expect(result).toMatchObject({ filled: 2, failed: 0 });
  await expect(page.locator('#primaryQuestionnaire--relocation')).toHaveText('Yes');
  await expect(page.locator('#primaryQuestionnaire--sponsorship')).toHaveText('Yes');
  await expect(page.locator('#primaryQuestionnaire--attestation')).toHaveText('Select One');
  await page.locator('#primaryQuestionnaire--relocation').click();
  await page.getByRole('option', { name: 'No', exact: true }).click();
  const undo = await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), plan.scanId);
  // This Workday menu has a disabled placeholder and no clear control.
  expect(undo).toMatchObject({ restored: 0, skipped: 2 });
  await expect(page.locator('#primaryQuestionnaire--relocation')).toHaveText('No');
  await expect(page.locator('#primaryQuestionnaire--sponsorship')).toHaveText('Yes');
  await expect(page.locator('body')).toHaveAttribute('data-submits', '0');
  await expect(page).toHaveURL(url);
});

test('Workday grounds this-country authorization in the exact public job and fills an affirmative immigration OR question', async ({ page }) => {
  const html = (await readFile(resolve('fixtures/workday-questionnaire.html'), 'utf8')).replace('Will you require visa sponsorship?',
    'Do you now or in the future require any immigration filing or visa sponsorship to maintain work authorization, including sponsorship by Example Corp, renewal/extension of open work permit, permanent residency, etc.?');
  let lookups = 0;
  await page.route('**/*', route => {
    if (route.request().url() === jobUrl) return route.fulfill({ contentType: 'text/html', body: html });
    if (route.request().url() === jobEndpoint) {
      lookups++;
      expect(route.request().method()).toBe('GET');
      expect(route.request().postData()).toBeNull();
      expect(route.request().headers().cookie).toBeUndefined();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(jobMetadata) });
    }
    return route.abort();
  });
  await page.goto(jobUrl);
  await page.addScriptTag({ path: resolve('dist/chromium/content.js') });
  const plan = await page.evaluate(profile => window.__jobrightLocal!.scan(profile), jobProfile);
  expect(plan.fields.filter(field => field.status === 'ready')).toHaveLength(3);
  expect(await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), plan.scanId)).toMatchObject({ filled: 3, failed: 0 });
  for (const id of ['authorization', 'sponsorship', 'relocation']) {
    await expect(page.locator('#primaryQuestionnaire--' + id)).toHaveText('Yes');
  }
  await page.evaluate(profile => window.__jobrightLocal!.scan(profile), jobProfile);
  expect(lookups).toBe(1);
  await expect(page.locator('#primaryQuestionnaire--attestation')).toHaveText('Select One');
  await expect(page.locator('body')).toHaveAttribute('data-submits', '0');
});

test('Workday stops a pending metadata scan when the application step changes', async ({ page }) => {
  const html = await readFile(resolve('fixtures/workday-questionnaire.html'), 'utf8');
  let received!: () => void, release!: () => void;
  const requested = new Promise<void>(resolve => { received = resolve; });
  const responseAllowed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*', async route => {
    if (route.request().url() === jobUrl) return route.fulfill({ contentType: 'text/html', body: html });
    if (route.request().url() === jobEndpoint) {
      received(); await responseAllowed;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(jobMetadata) });
    }
    return route.abort();
  });
  await page.goto(jobUrl);
  await page.addScriptTag({ path: resolve('dist/chromium/content.js') });
  const scan = page.evaluate(async profile => {
    try { await window.__jobrightLocal!.scan(profile); return 'unexpected success'; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }, jobProfile);
  await requested;
  await page.locator('h3').evaluate(element => { element.textContent = 'Application Questions 2 of 2'; });
  release();
  expect(await scan).toContain('application changed');
  await expect(page.locator('#primaryQuestionnaire--authorization')).toHaveText('Select One');
  await expect(page.locator('body')).toHaveAttribute('data-submits', '0');
});
