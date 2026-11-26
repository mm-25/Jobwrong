import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { profile, resumeText } from './fixtures';

const applicationUrl = 'https://c3.ai/careers/job/example-product-designer/';
const localProfile = { ...profile, answers: [] };

async function openApplication(page: Page): Promise<void> {
  const html = await readFile(resolve('fixtures/c3-application.html'), 'utf8');
  await page.route('**/*', (route) => route.request().url() === applicationUrl
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.goto(applicationUrl);
  await page.addScriptTag({ path: resolve('dist/chromium/content.js') });
}

function scan(page: Page) {
  return page.evaluate((candidate) => window.__jobrightLocal!.scan(candidate), localProfile);
}

function fill(page: Page, scanId: string) {
  return page.evaluate((id) => window.__jobrightLocal!.fill(id), scanId);
}

function pageState(page: Page) {
  return page.locator('.gh-apply-form').evaluate((form: HTMLFormElement) =>
    Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'), (control) => ({
      name: control.name,
      value: control.value,
      checked: control.matches(':checked'),
      expanded: control.getAttribute('aria-expanded'),
    })),
  );
}

const unansweredQuestions = [
  'How did you hear about C3 AI?',
  'Are you willing to work from our Redwood City CA office 5x week?',
  'Will you now or in the future require visa sponsorship?',
  'Do you consent to receive SMS messages about your application?',
  'Gender',
  'Are you Hispanic/Latino?',
  'Veteran Status',
];

test('scans every C3 AI application control without opening lazy choices', async ({ page }) => {
  await openApplication(page);
  const before = await pageState(page);
  const plan = await scan(page);

  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  expect(await pageState(page)).toEqual(before);
  expect(await page.evaluate(() => Reflect.get(window, 'fixtureEvents'))).toEqual({
    clicks: 0, edits: 0, listboxOpens: 0, submitEvents: 0, submitButtonClicks: 0,
  });
  await expect(page.locator('[role="listbox"]')).toHaveCount(0);

  expect(plan.platform).toBe('Greenhouse');
  expect(plan.fields).toHaveLength(20);
  expect(plan.fields.filter((field) => field.required)).toHaveLength(16);
  expect(plan.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'First Name', status: 'ready', value: 'Morgan', required: true }),
    expect.objectContaining({ label: 'Last Name', status: 'ready', value: 'Lee', required: true }),
    expect.objectContaining({ label: 'Email', status: 'ready', value: 'morgan.lee@example.test', required: true }),
    expect.objectContaining({ label: 'Country', kind: 'combobox', status: 'ready', value: 'United States', required: true }),
    expect.objectContaining({ label: 'Phone', status: 'ready', value: '+1 313 555 0123', required: true }),
    expect.objectContaining({ label: 'Location (City)', status: 'ready', value: 'Detroit', required: true }),
    expect.objectContaining({ label: 'Where are you currently located?', kind: 'text', status: 'ready', value: 'Detroit, Michigan, United States', required: true }),
    expect.objectContaining({ label: 'Resume/CV', kind: 'file', status: 'ready', required: true }),
    expect.objectContaining({ label: 'Portfolio Link', status: 'ready', value: 'https://morganlee.example.test', required: true }),
    expect.objectContaining({ label: 'Portfolio Password (if needed)', status: 'unsupported', aiEligible: false, required: true }),
    expect.objectContaining({ label: 'LinkedIn Profile', status: 'ready', value: 'https://www.linkedin.com/in/morganlee-example', required: true }),
    expect.objectContaining({ label: 'I Accept', kind: 'checkbox', status: 'unsupported', aiEligible: false, required: true }),
  ]));
  const resumePaste = plan.fields.find((field) => field.kind === 'text' && field.label === 'Resume/CV (paste as text)');
  expect(resumePaste).toMatchObject({ aiEligible: false, reason: expect.any(String) });
  expect(resumePaste).not.toMatchObject({ required: true });
  expect(resumePaste?.status).not.toBe('ready');

  for (const label of unansweredQuestions) {
    expect(plan.fields.find((field) => field.label === label)).toMatchObject({
      kind: 'combobox',
      status: label.includes('consent') ? 'unsupported' : 'unanswered',
      reason: expect.any(String),
    });
  }
});

test('fills trusted C3 AI profile data and commits the exact lazy Country choice', async ({ page }) => {
  await openApplication(page);
  const plan = await scan(page);
  const result = await fill(page, plan.scanId);

  expect(result.failed).toBe(0);
  expect(result.filled).toBe(10);
  await expect(page.getByLabel('First Name')).toHaveValue('Morgan');
  await expect(page.getByLabel('Last Name')).toHaveValue('Lee');
  await expect(page.getByLabel('Email')).toHaveValue('morgan.lee@example.test');
  await expect(page.getByLabel('Phone')).toHaveValue('+1 313 555 0123');
  await expect(page.getByLabel('Location (City)')).toHaveValue('Detroit');
  await expect(page.getByLabel('Where are you currently located?')).toHaveValue('Detroit, Michigan, United States');
  await expect(page.getByLabel('Portfolio Link')).toHaveValue('https://morganlee.example.test');
  await expect(page.getByLabel('LinkedIn Profile')).toHaveValue('https://www.linkedin.com/in/morganlee-example');
  await expect(page.getByRole('combobox', { name: 'Country' })).toHaveValue('United States');
  await expect(page.locator('[role="listbox"]')).toHaveCount(0);
  expect(await page.locator('.gh-apply-form').evaluate((form: HTMLFormElement) =>
    new FormData(form).get('country_short_name'),
  )).toBe('US');

  const resume = await page.locator('input[type="file"]').evaluate(async (control: HTMLInputElement) => {
    const file = control.files?.item(0);
    return file ? { name: file.name, type: file.type, body: await file.text() } : null;
  });
  expect(resume).toEqual({ name: 'Morgan Lee - Resume.pdf', type: 'application/pdf', body: resumeText });
  await expect(page.locator('[name="resume_text"]')).toBeEmpty();
  await expect(page.getByLabel('Portfolio Password (if needed)')).toBeEmpty();
  await expect(page.getByRole('checkbox', { name: 'I Accept', exact: true })).not.toBeChecked();
  for (const label of unansweredQuestions) {
    const question = page.getByRole('combobox', { name: label });
    await expect(question).toBeEmpty();
    await expect(question).toHaveAttribute('aria-expanded', 'false');
  }

  const email = page.getByLabel('Email');
  await email.fill('written-by-applicant@example.test');
  const rescan = await scan(page);
  expect(rescan.fields.find((field) => field.label === 'Email')).toMatchObject({ status: 'preserved' });
  await fill(page, rescan.scanId);
  await expect(email).toHaveValue('written-by-applicant@example.test');
  expect(await page.evaluate(() => Reflect.get(window, 'fixtureEvents'))).toMatchObject({
    submitEvents: 0, submitButtonClicks: 0,
  });
  await expect(page).toHaveURL(applicationUrl);
});
