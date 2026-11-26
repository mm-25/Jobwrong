import { chromium, expect, test } from '@playwright/test';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { VAULT_CHANNEL, type VaultSourcesResult } from '../../src/shared/vault';

const applicationUrl = 'https://application.example.test/careers/vault-application?session=synthetic-session';
const projectLabel = 'Describe a design project you led.';
const challengeLabel = 'Describe a collaboration challenge you faced.';
const projectEvidence = 'I led a keyboard accessibility audit and updated the onboarding flow.';
const challengeEvidence = 'I collaborated with another designer to investigate onboarding friction.';
const testKey = 'sk-ant-synthetic-vault-test';
const notePath = 'Synthetic Projects/Audit.md';

test('installed extension opts in, validates Claude evidence and keeps provenance bound to the current document', async ({}, info) => {
  test.setTimeout(45_000);
  const extensionPath = info.outputPath('fixture-extension');
  const browserProfile = info.outputPath('browser-profile');
  const productionPath = resolve(process.env.JOBRIGHT_E2E_DIST || 'dist', 'chromium');
  await cp(productionPath, extensionPath, { recursive: true });
  const manifestPath = resolve(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(manifestPath, JSON.stringify({
    ...manifest,
    permissions: [...manifest.permissions, 'nativeMessaging'],
    optional_permissions: (manifest.optional_permissions ?? []).filter((permission: string) => permission !== 'nativeMessaging'),
  }));
  const workerPath = resolve(extensionPath, manifest.background.service_worker);
  // Stub only native transport in this isolated extension copy. Claude responses
  // use Chromium's network routing, so the normal provider parser still runs.
  const nativeFixture = `
globalThis.fixtureNativeRequests = [];
chrome.runtime.sendNativeMessage = async (host, request) => {
  if (host !== 'com.jobright_local.obsidian' || request.v !== 1) throw new Error('Unexpected native host request');
  globalThis.fixtureNativeRequests.push(request);
  return { v: 1, ok: true, rootLabel: 'Synthetic Notes', files: 1, revision: 'fixture', hits: request.questions.map(({ id, query }, index) => ({
    id: 'fixture_source_' + index, questionId: id, path: ${JSON.stringify(notePath)}, heading: 'Keyboard audit',
    text: query.includes('design project') ? ${JSON.stringify(projectEvidence)} : ${JSON.stringify(challengeEvidence)},
    lineStart: index ? 15 : 7, lineEnd: index ? 15 : 8,
  })) };
};
`;
  await writeFile(workerPath, nativeFixture + await readFile(workerPath, 'utf8'));

  const context = await chromium.launchPersistentContext(browserProfile, {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + extensionPath, '--load-extension=' + extensionPath],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionOrigin = 'chrome-extension://' + new URL(worker.url()).hostname;
    const options = await context.newPage();
    await options.goto(extensionOrigin + '/' + manifest.options_ui.page);
    await options.getByLabel('First name', { exact: true }).fill('Morgan');
    await options.getByRole('button', { name: 'Save profile' }).click();
    await expect(options.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();
    await options.getByLabel('Provider', { exact: true }).selectOption('anthropic');
    await options.getByLabel('API key', { exact: true }).fill(testKey);
    await options.getByRole('checkbox', { name: 'Enable AI suggestions' }).check();
    await options.getByRole('checkbox', { name: 'Match unfamiliar questions during Autofill' }).uncheck();
    const optIn = options.getByRole('checkbox', { name: 'Use Obsidian notes during Autofill' });
    await expect(optIn).not.toBeChecked();
    await options.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(options.locator('#ai-status')).toHaveText('AI settings saved.');

    const html = await readFile(resolve('fixtures/vault.html'), 'utf8');
    const providerRequests: string[] = [];
    const providerQuestions: Array<{ id: string; label: string; context?: string; maxLength: number; snippets: Array<{ id: string; text: string }> }> = [];
    await context.route(/^https?:\/\//, async route => {
      const request = route.request();
      if (request.url() === applicationUrl) return route.fulfill({ contentType: 'text/html', body: html });
      if (request.url() !== 'https://api.anthropic.com/v1/messages') return route.abort();
      const body = request.postDataJSON();
      providerRequests.push(JSON.stringify(body));
      const { questions } = JSON.parse(body.messages[0].content);
      providerQuestions.push(...questions);
      const answers = (questions as typeof providerQuestions).map(({ id, label, snippets }) => ({
        fieldId: id,
        answer: label === projectLabel ? projectEvidence : 'I improved adoption by 47%.',
        evidence: [{ snippetId: snippets[0].id, quote: snippets[0].text }],
      }));
      return route.fulfill({
        json: {
          type: 'message', role: 'assistant', stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify({ answers }) }],
        },
      });
    });

    const page = await context.newPage();
    await page.goto(applicationUrl);
    await page.getByRole('button', { name: 'Open JobRight Local' }).click();
    const panel = page.getByRole('region', { name: 'JobRight Local autofill' });
    const autofill = panel.getByRole('button', { name: 'Autofill', exact: true });
    const undo = panel.getByRole('button', { name: 'Undo last fill' });
    await autofill.click();
    await expect(panel.getByRole('status')).toContainText('1 filled');
    await expect(page.locator('#first-name')).toHaveValue('Morgan');
    await expect(page.locator('#project')).toBeEmpty();
    expect(providerRequests).toHaveLength(0);
    expect(await worker.evaluate(() => Reflect.get(globalThis, 'fixtureNativeRequests'))).toEqual([]);
    await undo.click();
    await expect(page.locator('#first-name')).toBeEmpty();

    await options.bringToFront();
    await optIn.check();
    await options.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(options.locator('#ai-status')).toHaveText('AI settings saved.');
    await page.bringToFront();
    await autofill.click();
    await expect(panel.getByRole('status')).toContainText('1 from Obsidian', { timeout: 20_000 });
    await expect(page.locator('#first-name')).toHaveValue('Morgan');
    await expect(page.locator('#project')).toHaveValue(projectEvidence);
    await expect(page.locator('#challenge')).toBeEmpty();
    await expect(page.locator('#legal')).toBeEmpty();
    await expect(page.locator('#manual')).toHaveValue("Applicant's pre-existing response.");
    expect(providerRequests).toHaveLength(1);
    for (const privateValue of ['Morgan', testKey, notePath, 'synthetic-session', 'application.example.test', "Applicant's pre-existing response."]) {
      expect(providerRequests[0]).not.toContain(privateValue);
    }
    expect(providerQuestions.map(question => question.label)).toEqual([projectLabel, challengeLabel, 'Describe a research project you led.']);
    expect(providerQuestions[0]).toMatchObject({ context: 'Explain the process and the outcome.', maxLength: 250, snippets: [{ text: projectEvidence }] });
    expect(await page.evaluate(() => Reflect.get(window, 'fixtureSubmission'))).toEqual({ clicks: 0, submits: 0 });
    expect(await page.evaluate(() => typeof window.__jobrightPage)).toBe('undefined');

    const sources = () => options.evaluate(async ({ channel, url }) => {
      const api = Reflect.get(globalThis, 'chrome');
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      return api.runtime.sendMessage({ channel, command: 'sources', tabId: tab.id, url }) as Promise<VaultSourcesResult>;
    }, { channel: VAULT_CHANNEL, url: applicationUrl });
    const receipt = await sources();
    expect(receipt.receipts).toEqual([{
      question: projectLabel,
      sources: [{ id: 'fixture_source_0', path: notePath, heading: 'Keyboard audit', lineStart: 7, lineEnd: 8 }],
    }]);
    expect(JSON.stringify(receipt)).not.toContain(projectEvidence);

    await undo.click();
    await expect(panel.getByRole('status')).toContainText('2 restored');
    await expect(page.locator('#first-name')).toBeEmpty();
    await expect(page.locator('#project')).toBeEmpty();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Open JobRight Local' })).toBeVisible();
    expect((await sources()).receipts).toEqual([]);
  } finally {
    await context.close();
    await rm(browserProfile, { recursive: true, force: true });
  }
});
