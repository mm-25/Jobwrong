import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { QuestionMeaning } from '../../src/shared/interpretation';
import { emptyProfile } from '../../src/shared/profile';
import type { Profile, ScanResult } from '../../src/shared/types';

const applicationUrl = 'https://application.example.test/careers/fixture/apply';
const profile: Profile = {
  ...emptyProfile(),
  personal: { ...emptyProfile().personal, firstName: 'Morgan' },
  applicationDefaults: { relocation: 'yes', gender: 'male' },
  workAuthorizations: [{ country: 'Canada', authorized: true }],
};
const name = 'First name';
const relocation = 'Is moving for this position off the table?';
const authorization = 'Could you lawfully work in Canada without additional permission?';
const gender = 'Select one';
const genderHelp = 'Which gender category best reflects how you identify?';

test.beforeEach(async ({ page, browserName }) => {
  const html = await readFile(resolve('fixtures/hybrid-application.html'), 'utf8');
  await page.route('**/*', (route) => route.request().url() === applicationUrl
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.goto(applicationUrl);
  await page.addScriptTag({ path: resolve('dist', browserName, 'content.js') });
});

function scan(page: Page) {
  return page.evaluate(candidate => window.__jobrightLocal!.scan(candidate), profile);
}

function classification(
  scanResult: ScanResult, label: string, fact: QuestionMeaning['fact'], evidence: string,
  { inverse = false, country = null }: Pick<Partial<QuestionMeaning>, 'inverse' | 'country'> = {},
): QuestionMeaning {
  const field = scanResult.fields.find(field => field.label === label);
  if (!field) throw new Error(`Question missing from fixture scan: ${label}`);
  return { fieldId: field.id, fact, inverse, country, confidence: 'high', evidence };
}

function interpret(page: Page, scanId: string, meanings: QuestionMeaning[]) {
  return page.evaluate(({ scanId, profile, meanings }) => window.__jobrightLocal!.interpret!(scanId, profile, meanings), {
    scanId, profile, meanings,
  });
}

function fixtureEvents(page: Page) {
  return page.evaluate(() => Reflect.get(window, 'fixtureEvents'));
}

test('combines local and interpreted answers in one undo across native and lazy controls', async ({ page }) => {
  const initial = await scan(page);
  expect(initial.fields.map(({ label, status, interpretationEligible }) => [label, status, interpretationEligible ?? false])).toEqual([
    [name, 'ready', false], [relocation, 'unanswered', true], [authorization, 'unanswered', true], [gender, 'unanswered', true],
  ]);
  expect(initial.fields.find(field => field.label === gender)).toMatchObject({ kind: 'combobox', interpretationContext: genderHelp });
  expect(await fixtureEvents(page)).toMatchObject({ menuOpens: 0, selections: [] });
  expect(await page.evaluate(scanId => window.__jobrightLocal!.fill(scanId), initial.scanId)).toMatchObject({
    filled: 1, failed: 0, undoAvailable: true,
  });
  await expect(page.locator('#first-name')).toHaveValue('Morgan');
  await expect(page.locator('#relocation')).toHaveValue('');

  const followUp = await scan(page);
  const meanings = [
    classification(followUp, relocation, 'relocation', 'moving for this position off the table', { inverse: true }),
    classification(followUp, authorization, 'workAuthorization', 'lawfully work in Canada', { country: 'Canada' }),
    classification(followUp, gender, 'gender', 'gender category best reflects how you identify'),
  ];
  const plan = await interpret(page, followUp.scanId, meanings);
  expect(plan?.fields.filter(field => field.answerSource === 'interpreted').map(field => field.label)).toEqual([
    relocation, authorization, gender,
  ]);
  expect(await fixtureEvents(page)).toMatchObject({ menuOpens: 0, selections: [] });
  expect(await page.evaluate(({ followUpId, firstPassId }) => window.__jobrightLocal!.fill(followUpId, undefined, firstPassId), {
    followUpId: followUp.scanId, firstPassId: initial.scanId,
  })).toMatchObject({ filled: 3, failed: 0, undoAvailable: true });
  await expect(page.locator('#relocation')).toHaveValue('no');
  await expect(page.locator('#canada-authorized')).toBeChecked();
  await expect(page.locator('#canada-not-authorized')).not.toBeChecked();
  await expect(page.locator('#gender')).toHaveText('Man');

  expect(await page.evaluate(scanId => window.__jobrightLocal!.undo(scanId), followUp.scanId)).toEqual({ restored: 4, skipped: 0 });
  await expect(page.locator('#first-name')).toBeEmpty();
  await expect(page.locator('#relocation')).toHaveValue('');
  await expect(page.locator('#canada-authorized')).not.toBeChecked();
  await expect(page.locator('#gender')).toHaveText('Select one');
  expect(await fixtureEvents(page)).toEqual({
    menuOpens: 1, selections: ['Man', ''], changes: 0, submitEvents: 0, submitButtonClicks: 0,
  });
});

test('keeps a lazy combobox cleared after the applicant chooses and clears it during interpretation', async ({ page }) => {
  const checkpoint = await scan(page);
  const meaning = classification(checkpoint, gender, 'gender', 'gender category best reflects how you identify');
  await page.locator('#gender').click();
  await page.getByRole('option', { name: 'Woman', exact: true }).click();
  await expect(page.locator('#gender')).toHaveText('Woman');
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.locator('#gender')).toHaveText('Select one');

  const plan = await interpret(page, checkpoint.scanId, [meaning]);
  expect(plan?.fields.find(field => field.id === meaning.fieldId)).toMatchObject({ status: 'unanswered' });
  expect(await page.evaluate(({ scanId, fieldId }) => window.__jobrightLocal!.fill(scanId, [fieldId]), {
    scanId: checkpoint.scanId, fieldId: meaning.fieldId,
  })).toMatchObject({ filled: 0, undoAvailable: false });
  await expect(page.locator('#gender')).toHaveText('Select one');
  expect(await fixtureEvents(page)).toMatchObject({ menuOpens: 1, selections: ['Woman', ''], changes: 0 });
});
