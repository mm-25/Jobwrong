import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { ScanOptions, ScanResult } from '../../src/shared/types';
import { formUrls, profile, resumeText, serveFixture, type Fixture } from './fixtures';

const contentScript = resolve('dist/chromium/content.js');

async function openForm(page: Page, fixture: Fixture): Promise<void> {
  await serveFixture(page, fixture);
  await page.addScriptTag({ path: contentScript });
  expect(await page.evaluate(() => typeof window.__jobrightLocal?.scan)).toBe('function');
}

function scan(page: Page, options: ScanOptions = {}) {
  return page.evaluate(
    ({ profile, options }) => window.__jobrightLocal!.scan(profile, options),
    { profile, options },
  );
}

function fill(page: Page, scanned: ScanResult, fieldIds?: string[]) {
  return page.evaluate(
    ({ scanId, fieldIds }) => window.__jobrightLocal!.fill(scanId, fieldIds),
    { scanId: scanned.scanId, fieldIds },
  );
}

function undo(page: Page) {
  return page.evaluate(() => window.__jobrightLocal!.undo());
}

async function neverSubmitted(page: Page, fixture: Fixture): Promise<void> {
  expect(await page.evaluate(() => Reflect.get(window, 'fixtureEvents'))).toEqual({
    submitEvents: 0,
    submitButtonClicks: 0,
  });
  await expect(page).toHaveURL(formUrls[fixture]);
}

test('Lever preserves answers edited after scan or after fill', async ({ page }) => {
  await openForm(page, 'lever');
  const fullName = page.getByLabel('Full name');
  const email = page.getByLabel('Email');
  const phone = page.getByLabel('Phone');
  const website = page.getByLabel('Website');

  await email.fill('written-by-applicant@example.test');
  const earlier = await scan(page);
  expect(earlier.platform).toBe('Lever');
  expect(earlier.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: 'Full name', status: 'ready', value: 'Morgan Lee' }),
    expect.objectContaining({ label: 'Email', status: 'preserved' }),
  ]));
  await expect(fullName).toBeEmpty();

  await email.clear();
  const plan = await scan(page);
  await email.fill('edited-after-preview@example.test');
  const result = await fill(page, plan);
  expect(result.failed).toBe(0);
  expect(result.entries).toContainEqual(expect.objectContaining({ label: 'Email', status: 'skipped' }));
  await expect(fullName).toHaveValue('Morgan Lee');
  await expect(email).toHaveValue('edited-after-preview@example.test');
  await expect(phone).toHaveValue('+1 313 555 0123');
  await expect(website).toHaveValue('https://example.test/manual');
  await expect(page.locator('[name="first-name"]')).toBeEmpty();
  await expect(page.locator('[name="last-name"]')).toBeEmpty();

  await fullName.fill('Edited after autofill');
  await page.addScriptTag({ path: contentScript });
  const reverted = await undo(page);
  expect(reverted.skipped).toBeGreaterThan(0);
  await expect(fullName).toHaveValue('Edited after autofill');
  await expect(email).toHaveValue('edited-after-preview@example.test');
  await expect(phone).toBeEmpty();
  await neverSubmitted(page, 'lever');
});

test('Lever fills only selected fields and restores overwritten values', async ({ page }) => {
  await openForm(page, 'lever');
  const fullName = page.getByLabel('Full name');
  const email = page.getByLabel('Email');
  await email.fill('earlier-input@example.test');

  const plan = await scan(page, { overwriteExisting: true });
  const emailField = plan.fields.find((field) => field.label === 'Email');
  expect(emailField?.status).toBe('ready');
  const result = await fill(page, plan, [emailField!.id]);
  expect(result.filled).toBe(1);
  await expect(email).toHaveValue('morgan.lee@example.test');
  await expect(fullName).toBeEmpty();
  await expect(page.getByLabel('Phone')).toBeEmpty();

  await undo(page);
  await expect(email).toHaveValue('earlier-input@example.test');
  await neverSubmitted(page, 'lever');
});

test('Lever attaches the selected local resume and clears it on undo', async ({ page }) => {
  await openForm(page, 'lever');
  const fileInput = page.getByLabel('Resume');
  const plan = await scan(page);
  const resume = plan.fields.find((field) => field.kind === 'file');
  expect(resume?.status).toBe('ready');
  await expect(fileInput).toBeEmpty();

  const result = await fill(page, plan, [resume!.id]);
  expect(result.filled).toBe(1);
  const file = await fileInput.evaluate(async (node: HTMLInputElement) => {
    const uploaded = node.files?.item(0);
    if (!uploaded) return null;
    return { name: uploaded.name, type: uploaded.type, body: await uploaded.text() };
  });
  expect(file).toEqual({
    name: 'Morgan Lee - Resume.pdf',
    type: 'application/pdf',
    body: resumeText,
  });
  await expect(page.getByLabel('Full name')).toBeEmpty();

  await undo(page);
  await expect(fileInput).toBeEmpty();
  await neverSubmitted(page, 'lever');
});

test('Greenhouse commits framework-controlled text and native choices', async ({ page }) => {
  await openForm(page, 'greenhouse');
  const plan = await scan(page);
  expect(plan.platform).toBe('Greenhouse');
  expect(plan.fields).toContainEqual(expect.objectContaining({
    label: 'How did you hear about this role?',
    kind: 'radio',
    status: 'ready',
  }));
  const result = await fill(page, plan);
  expect(result.failed).toBe(0);

  // Wait for the fixture's controlled input to render its event-driven state.
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  await expect(page.getByLabel('First Name')).toHaveValue('Morgan');
  await expect(page.getByLabel('Last Name')).toHaveValue('Lee');
  await expect(page.getByLabel('Country')).toHaveValue('US');
  await expect(page.getByRole('radio', { name: 'Company careers page' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Industry conference' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Are you open to relocation?' })).toBeChecked();

  await undo(page);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  await expect(page.getByLabel('First Name')).toBeEmpty();
  await expect(page.getByLabel('Country')).toHaveValue('');
  await expect(page.getByRole('radio', { name: 'Company careers page' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Are you open to relocation?' })).not.toBeChecked();
  await neverSubmitted(page, 'greenhouse');
});

test('Greenhouse prompts a re-scan as dependent questions appear', async ({ page }) => {
  await openForm(page, 'greenhouse');
  const dependent = page.getByLabel('Which office would you prefer?');
  const plan = await scan(page);
  expect(plan.fields.some((field) => field.label === 'Which office would you prefer?')).toBe(false);
  await expect(dependent).toHaveCount(0);

  const result = await fill(page, plan);
  expect(result.needsRescan).toBe(true);
  await expect(dependent).toBeEmpty();

  const updated = await scan(page);
  const preferredOffice = updated.fields.find((field) => field.label === 'Which office would you prefer?');
  expect(preferredOffice).toMatchObject({ status: 'ready', value: 'Detroit' });
  const followup = await fill(page, updated, [preferredOffice!.id]);
  expect(followup.filled).toBe(1);
  await expect(dependent).toHaveValue('Detroit');
  await neverSubmitted(page, 'greenhouse');
});

test('Ashby commits the exact accessible option and undoes its stored value', async ({ page }) => {
  await openForm(page, 'ashby');
  const combo = page.getByRole('combobox', { name: 'Country' });
  const submittedValue = page.locator('[name="application_country"]');
  const plan = await scan(page);
  expect(plan.platform).toBe('Ashby');
  expect(plan.fields).toContainEqual(expect.objectContaining({
    label: 'Country',
    kind: 'combobox',
    status: 'ready',
    options: expect.arrayContaining(['United States', 'United States Minor Outlying Islands']),
  }));
  await expect(combo).toHaveAttribute('aria-expanded', 'false');
  await expect(submittedValue).toHaveValue('');

  const result = await fill(page, plan);
  expect(result.failed).toBe(0);
  await expect(combo).toHaveValue('United States');
  await expect(submittedValue).toHaveValue('US');
  await expect(page.getByLabel('Describe a design project you are proud of.')).toHaveValue('I redesigned a mobile app.');

  await undo(page);
  await expect(combo).toBeEmpty();
  await expect(submittedValue).toHaveValue('');
  await neverSubmitted(page, 'ashby');
});

test('Workday maps duplicate labels to their respective experience and education rows', async ({ page }) => {
  await openForm(page, 'workday');
  const plan = await scan(page);
  expect(plan.platform).toBe('Workday');
  const companies = plan.fields.filter((field) => field.label === 'Company');
  expect(companies).toHaveLength(3);
  expect(new Set(companies.map((field) => field.id)).size).toBe(3);
  expect(companies.map((field) => field.status)).toEqual(['ready', 'ready', 'unanswered']);

  const result = await fill(page, plan);
  expect(result.failed).toBe(0);
  const firstJob = page.getByRole('group', { name: 'Work Experience 1' });
  const secondJob = page.getByRole('group', { name: 'Work Experience 2' });
  const thirdJob = page.getByRole('group', { name: 'Work Experience 3' });
  const firstSchool = page.getByRole('group', { name: 'Education 1' });
  const secondSchool = page.getByRole('group', { name: 'Education 2' });

  await expect(firstJob.getByLabel('Company')).toHaveValue('Cedar Studio');
  await expect(firstJob.getByLabel('Job Title')).toHaveValue('Product Designer');
  await expect(secondJob.getByLabel('Company')).toHaveValue('Maple Co.');
  await expect(secondJob.getByLabel('Job Title')).toHaveValue('Senior Designer');
  await expect(thirdJob.getByLabel('Company')).toBeEmpty();
  await expect(firstSchool.getByLabel('School or University')).toHaveValue('Huron College');
  await expect(firstSchool.getByLabel('Degree')).toHaveValue('ba');
  await expect(secondSchool.getByLabel('School or University')).toHaveValue('Lakes University');
  await expect(secondSchool.getByLabel('Degree')).toHaveValue('ms');
  await neverSubmitted(page, 'workday');
});

test('iCIMS leaves unknown and sensitive required fields unanswered', async ({ page }) => {
  await openForm(page, 'icims');
  const plan = await scan(page);
  expect(plan.platform).toBe('iCIMS');
  expect(plan.fields).toContainEqual(expect.objectContaining({
    label: 'Will you now or in the future require sponsorship?',
    status: 'unanswered',
    sensitive: true,
  }));
  expect(plan.fields.filter((field) => field.label === 'Additional information')
    .map((field) => field.status)).toEqual(['unanswered', 'unanswered']);

  await fill(page, plan);
  await expect(page.getByLabel('First Name')).toHaveValue('Morgan');
  await expect(page.getByLabel('Last Name')).toHaveValue('Lee');
  await expect(page.getByLabel('Will you now or in the future require sponsorship?')).toHaveValue('');
  await expect(page.getByLabel('Additional information').nth(0)).toBeEmpty();
  await expect(page.getByLabel('Additional information').nth(1)).toBeEmpty();
  await expect(page.getByLabel('I consent to a background check')).not.toBeChecked();
  await expect(page.getByLabel('Electronic signature')).toBeEmpty();
  await expect(page.getByLabel('Create password')).toBeEmpty();
  await neverSubmitted(page, 'icims');
});

test('a reviewed answer targets one duplicate label and cannot override safe-answer rules', async ({ page }) => {
  await openForm(page, 'icims');
  const initial = await scan(page);
  const duplicate = initial.fields.filter((field) => field.label === 'Additional information');
  expect(duplicate).toHaveLength(2);
  const sponsorship = initial.fields.find((field) => field.label.includes('require sponsorship'));
  const firstName = initial.fields.find((field) => field.label === 'First Name');
  expect(sponsorship?.sensitive).toBe(true);
  expect(firstName?.status).toBe('ready');

  const response = 'I am looking to mentor early-career designers.';
  const plan = await scan(page, {
    reviewedAnswers: {
      [duplicate[1].id]: response,
      [sponsorship!.id]: 'Yes',
      [firstName!.id]: 'Unreviewed override',
    },
  });
  await fill(page, plan);
  await expect(page.getByLabel('Additional information').nth(0)).toBeEmpty();
  await expect(page.getByLabel('Additional information').nth(1)).toHaveValue(response);
  await expect(page.getByLabel('Will you now or in the future require sponsorship?')).toHaveValue('');
  await expect(page.getByLabel('First Name')).toHaveValue('Morgan');
  await neverSubmitted(page, 'icims');
});
