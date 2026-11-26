import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { emptyProfile } from '../../src/shared/profile';
import type { JobRequest } from '../../src/shared/jobs';
import type { VaultQuestion, VaultRequest } from '../../src/shared/vault';

const applicationUrl = 'https://application.example.test/careers/vault-application';
const projectLabel = 'Describe a design project you led.';
const challengeLabel = 'Describe a collaboration challenge you faced.';
const answer = 'I led a keyboard accessibility audit and updated the onboarding flow.';
const savedAnswer = 'I interviewed customers about search behavior.';
const originalManual = "Applicant's pre-existing response.";
const profile = emptyProfile();
profile.personal.firstName = 'Morgan';
profile.answers = [{ question: 'Describe a research project you led.', answer: savedAnswer }];

type Scenario = 'success' | 'unavailable' | 'edit-during-draft';

async function openApplication(page: Page, browserName: string, scenario: Scenario) {
  const html = await readFile(resolve('fixtures/vault.html'), 'utf8');
  await page.route('**/*', route => route.request().url() === applicationUrl
    ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
    : route.abort());
  await page.addInitScript(({ savedProfile, scenario, projectLabel, answer }) => {
    const requests: VaultQuestion[][] = [];
    let release: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    Reflect.set(window, 'fixtureVaultRequests', requests);
    Reflect.set(window, 'fixtureReleaseDraft', release);
    Reflect.set(window, 'browser', {
      runtime: {
        id: 'synthetic-extension',
        async sendMessage(request: JobRequest | VaultRequest) {
          const controller = window.__jobrightPage!;
          if (request.channel === 'jobright-local-vault-v1') {
            requests.push(request.questions);
            if (scenario === 'unavailable') return { answers: [], error: 'The local Obsidian helper is unavailable.' };
            if (scenario === 'edit-during-draft') await pending;
            const project = request.questions.find(question => question.label === projectLabel);
            return { answers: project ? [{ fieldId: project.id, answer, sourceIds: ['synthetic-source'] }] : [] };
          }
          if (request.command === 'start') controller.start(savedProfile, false, undefined, {
            token: 'fixture-vault-token', topUrl: document.URL,
          });
          if (request.command === 'undo') await controller.undo();
          return { states: [controller.status()] };
        },
      },
    });
  }, { savedProfile: profile, scenario, projectLabel, answer });

  await page.goto(applicationUrl);
  await page.addScriptTag({ path: resolve(process.env.JOBRIGHT_E2E_DIST || 'dist', browserName, 'content.js') });
  const panel = page.getByRole('region', { name: 'JobRight Local autofill' });
  await page.getByRole('button', { name: 'Open JobRight Local' }).click();
  await expect(page.locator('#first-name')).toBeEmpty();
  await expect(page.locator('#project')).toBeEmpty();
  await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
  return panel;
}

async function checkProtectedFields(page: Page) {
  await expect(page.locator('#manual')).toHaveValue(originalManual);
  await expect(page.locator('#legal')).toBeEmpty();
  await expect(page.locator('#challenge')).toBeEmpty();
  expect(await page.evaluate(() => Reflect.get(window, 'fixtureSubmission'))).toEqual({ clicks: 0, submits: 0 });
}

test('one click applies saved and grounded answers in one undo while preserving manual edits', async ({ page, browserName }) => {
  const panel = await openApplication(page, browserName, 'success');
  await expect(panel.getByRole('status')).toContainText('1 from Obsidian');
  await expect(page.locator('#first-name')).toHaveValue('Morgan');
  await expect(page.locator('#project')).toHaveValue(answer);
  await expect(page.locator('#saved')).toHaveValue(savedAnswer);
  await checkProtectedFields(page);
  const requests: VaultQuestion[][] = await page.evaluate(() => Reflect.get(window, 'fixtureVaultRequests'));
  expect(requests).toHaveLength(1);
  expect(requests[0].map(({ label }) => label)).toEqual([projectLabel, challengeLabel]);
  expect(requests[0][0]).toMatchObject({ kind: 'text', maxLength: 250, context: 'Explain the process and the outcome.' });

  const edited = 'Morgana';
  await page.locator('#first-name').fill(edited);
  await panel.getByRole('button', { name: 'Undo last fill' }).click();
  await expect(panel.getByRole('status')).toContainText('2 restored');
  await expect(page.locator('#first-name')).toHaveValue(edited);
  await expect(page.locator('#saved')).toBeEmpty();
  await expect(page.locator('#project')).toBeEmpty();
  await checkProtectedFields(page);
});

test('helper failure leaves local fills and their undo available', async ({ page, browserName }) => {
  const panel = await openApplication(page, browserName, 'unavailable');
  await expect(panel).toContainText('The local Obsidian helper is unavailable.');
  await expect(panel.getByRole('status')).toContainText('2 filled');
  await expect(page.locator('#first-name')).toHaveValue('Morgan');
  await expect(page.locator('#saved')).toHaveValue(savedAnswer);
  await expect(page.locator('#project')).toBeEmpty();
  await panel.getByRole('button', { name: 'Undo last fill' }).click();
  await expect(page.locator('#first-name')).toBeEmpty();
  await expect(page.locator('#saved')).toBeEmpty();
  await checkProtectedFields(page);
});

test('typing and clearing a field while a draft is pending leaves it blank', async ({ page, browserName }) => {
  const panel = await openApplication(page, browserName, 'edit-during-draft');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'fixtureVaultRequests').length)).toBe(1);
  await page.locator('#project').fill('Temporary applicant edit');
  await page.locator('#project').fill('');
  await page.evaluate(() => Reflect.get(window, 'fixtureReleaseDraft')());
  await expect(panel.getByRole('status')).toContainText('2 filled');
  await expect(panel).toContainText('No Obsidian answers could be safely applied.');
  await expect(page.locator('#project')).toBeEmpty();
  await checkProtectedFields(page);
});
