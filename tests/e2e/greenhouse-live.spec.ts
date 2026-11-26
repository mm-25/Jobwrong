import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { emptyProfile } from '../../src/shared/profile';
import { profile as fixtureProfile, resumeText } from './fixtures';

const url = 'https://job-boards.greenhouse.io/example-studio/jobs/5003000';
const sponsorshipLabel = 'Will you now or in the future require visa sponsorship?';
const relocationLabel = 'Are you open to relocation?';
const profile = {
  ...emptyProfile(),
  resume: fixtureProfile.resume,
  answers: [{ question: sponsorshipLabel, answer: 'Yes' }, { question: relocationLabel, answer: 'Yes' }],
};

async function fixtureState(page: Page) {
  return page.evaluate(() => Reflect.get(window, 'fixtureEvents'));
}

async function formValue(page: Page, name: string) {
  return page.locator('form').evaluate((form: HTMLFormElement, name) => new FormData(form).get(name), name);
}

test.beforeEach(async ({ page, browserName }) => {
  const html = await readFile(resolve('fixtures/greenhouse-live.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === url
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }) : route.abort());
  await page.goto(url);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });
});

test('fills the delayed Greenhouse-controlled dropdown and recognizes the required resume behind Attach', async ({ page }) => {
  const sponsorship = page.getByRole('combobox', { name: sponsorshipLabel });
  const resume = page.locator('#resume');
  const coverLetter = page.locator('#cover_letter');
  let fileChoosers = 0;
  page.on('filechooser', () => { fileChoosers++; });

  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), profile);
  expect(plan.fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: sponsorshipLabel, status: 'ready', required: true }),
    expect.objectContaining({ label: relocationLabel, status: 'preserved', currentValue: 'No' }),
    expect.objectContaining({ label: 'Resume/CV', kind: 'file', required: true, status: 'ready' }),
    expect.objectContaining({ label: 'Cover Letter', kind: 'file', required: false, status: 'unsupported' }),
  ]));
  await expect(sponsorship).not.toHaveAttribute('aria-controls');
  expect(await fixtureState(page)).toMatchObject({ opened: [], selected: [], filesChanged: [], openerAttempts: [] });

  const outcome = await page.evaluate(id => window.__jobrightLocal!.fill(id), plan.scanId);
  expect(outcome).toMatchObject({ filled: 2, failed: 0, undoAvailable: true });
  await expect.poll(async () => (await fixtureState(page)).pendingActivations).toBe(0);
  await expect(sponsorship).toBeEmpty();
  await expect(sponsorship).toHaveAttribute('aria-expanded', 'false');
  await expect(sponsorship).not.toHaveAttribute('aria-controls');
  await expect(page.locator('#sponsorship .select__single-value')).toHaveText('Yes');
  expect(await formValue(page, 'sponsorship')).toBe('y');
  expect(await formValue(page, 'relocation')).toBe('n');
  expect(await resume.evaluate(async (field: HTMLInputElement) => field.files?.item(0)?.text())).toBe(resumeText);
  await expect(coverLetter).toBeEmpty();
  expect(await fixtureState(page)).toEqual({ submit: 0, submitClicks: 0, unrelatedClicks: 0,
    opened: ['react-select-question_401-listbox'], selected: [['sponsorship', 'y']], filesChanged: [['resume', 1]],
    openerAttempts: [['question_401', 'mouseup']], pendingActivations: 0 });

  const second = await page.evaluate(data => window.__jobrightLocal!.scan(data), profile);
  expect(second.fields.find(field => field.label === sponsorshipLabel)).toMatchObject({ status: 'preserved', currentValue: 'Yes' });
  const undo = await page.evaluate(id => window.__jobrightLocal!.undo(id), plan.scanId);
  expect(undo).toEqual({ restored: 1, skipped: 1 });
  await expect(resume).toBeEmpty();
  expect(await formValue(page, 'sponsorship')).toBe('y');
  expect(await fixtureState(page)).toMatchObject({ submit: 0, submitClicks: 0, unrelatedClicks: 0,
    filesChanged: [['resume', 1], ['resume', 0]] });
  expect(fileChoosers).toBe(0);
  await expect(page).toHaveURL(url);
});

test('Undo restores a preexisting React Select option through its next associated menu', async ({ page }) => {
  const control = page.getByRole('combobox', { name: relocationLabel });
  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data, { overwriteExisting: true }), profile);
  const relocation = plan.fields.find(field => field.label === relocationLabel)!;
  expect(relocation).toMatchObject({ status: 'ready', currentValue: 'No' });

  const filled = await page.evaluate(({ scanId, fieldId }) => window.__jobrightLocal!.fill(scanId, [fieldId]), {
    scanId: plan.scanId, fieldId: relocation.id,
  });
  expect(filled).toMatchObject({ filled: 1, failed: 0 });
  expect(await formValue(page, 'relocation')).toBe('y');

  const undo = await page.evaluate(id => window.__jobrightLocal!.undo(id), plan.scanId);
  expect(undo).toEqual({ restored: 1, skipped: 0 });
  await expect.poll(async () => (await fixtureState(page)).pendingActivations).toBe(0);
  await expect(page.locator('#relocation .select__single-value')).toHaveText('No');
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(control).not.toHaveAttribute('aria-controls');
  expect(await formValue(page, 'relocation')).toBe('n');
  expect(await formValue(page, 'sponsorship')).toBe('');
  expect(await fixtureState(page)).toEqual({ submit: 0, submitClicks: 0, unrelatedClicks: 0,
    opened: ['react-select-question_402-listbox', 'react-select-question_402-listbox'],
    selected: [['relocation', 'y'], ['relocation', 'n']], filesChanged: [],
    openerAttempts: [['question_402', 'mouseup'], ['question_402', 'mouseup']], pendingActivations: 0 });
});

test('an unmatched Greenhouse answer closes the opened menu without selecting anything', async ({ page }) => {
  const control = page.getByRole('combobox', { name: sponsorshipLabel });
  const applicant = { ...profile, answers: [{ question: sponsorshipLabel, answer: 'Prefer not to say' }] };
  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), applicant);
  const field = plan.fields.find(candidate => candidate.label === sponsorshipLabel)!;
  expect(field.status).toBe('ready');

  const filled = await page.evaluate(({ scanId, fieldId }) => window.__jobrightLocal!.fill(scanId, [fieldId]), {
    scanId: plan.scanId, fieldId: field.id,
  });

  expect(filled).toMatchObject({ filled: 0, failed: 1 });
  expect(await formValue(page, 'sponsorship')).toBe('');
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(control).not.toHaveAttribute('aria-controls');
  expect(await fixtureState(page)).toEqual({ submit: 0, submitClicks: 0, unrelatedClicks: 0,
    opened: ['react-select-question_401-listbox'], selected: [], filesChanged: [],
    openerAttempts: [['question_401', 'mouseup']], pendingActivations: 0 });
});

test('fills Greenhouse multi-select chips and keeps a manual edit when undoing the other field', async ({ page }) => {
  const applicant = { ...emptyProfile(), applicationDefaults: { gender: 'male', raceEthnicity: 'south_asian' } } as const;
  const plan = await page.evaluate(data => window.__jobrightLocal!.scan(data), applicant);
  const fields = plan.fields.filter(field => field.status === 'ready');
  expect(fields.map(field => field.label)).toEqual([
    'How would you describe your gender identity? (mark all that apply)',
    'How would you describe your racial/ethnic background? (mark all that apply)',
  ]);
  expect(await page.evaluate(id => window.__jobrightLocal!.fill(id), plan.scanId)).toMatchObject({ filled: 2, failed: 0 });
  expect(await formValue(page, 'gender')).toBe('male');
  expect(await formValue(page, 'race')).toBe('asian');
  await expect(page.locator('#gender-select .select__multi-value__label')).toHaveText('Male');
  await expect(page.locator('#race-select .select__multi-value__label')).toHaveText('Asian');

  await page.locator('#gender-select').getByRole('button', { name: 'Toggle flyout' }).click();
  await page.getByRole('option', { name: 'Female', exact: true }).click();
  expect(await page.evaluate(id => window.__jobrightLocal!.undo(id), plan.scanId)).toEqual({ restored: 1, skipped: 1 });
  expect(await formValue(page, 'gender')).toBe('male,female');
  expect(await formValue(page, 'race')).toBe('');
  expect(await fixtureState(page)).toMatchObject({ submit: 0, submitClicks: 0, unrelatedClicks: 0,
    selected: [['gender', 'male'], ['race', 'asian'], ['gender', 'female'], ['race', 'remove:asian']] });
});
