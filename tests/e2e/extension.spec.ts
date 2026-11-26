import { chromium, expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { formUrls, profile, resumeText, serveFixture } from './fixtures';

const fixtureKey = 'fixture-settings-key-never-injected';

interface InstalledExtension {
  context: BrowserContext;
  close(): Promise<void>;
  options: Page;
  url: string;
  manifest: {
    action: { default_popup: string };
    name: string;
    options_ui?: { page: string };
    options_page?: string;
    host_permissions?: string[];
    optional_host_permissions?: string[];
  };
}

async function loadExtension(info: TestInfo, fixtureOrigin?: string): Promise<InstalledExtension> {
  const productionPath = resolve('dist/chromium');
  const extensionPath = fixtureOrigin ? info.outputPath('fixture-extension') : productionPath;
  const manifest: InstalledExtension['manifest'] = JSON.parse(
    await readFile(resolve(productionPath, 'manifest.json'), 'utf8'),
  );

  if (fixtureOrigin) {
    // Playwright opens the popup URL as a page. This copy grants it only the
    // fixture origin in place of the activeTab grant from a browser toolbar click.
    await cp(productionPath, extensionPath, { recursive: true });
    await writeFile(resolve(extensionPath, 'manifest.json'), JSON.stringify({
      ...manifest,
      host_permissions: [fixtureOrigin + '/*'],
    }));
  }

  const userDataDir = info.outputPath('browser-profile');
  await mkdir(userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--disable-extensions-except=' + extensionPath,
      '--load-extension=' + extensionPath,
    ],
  });

  async function close(): Promise<void> {
    try {
      await context.close();
    } finally {
      await rm(userDataDir, { recursive: true, force: true });
    }
  }

  try {
    const options = context.pages()[0] ?? await context.newPage();
    await options.goto('chrome://extensions');
    const extension = options.locator('extensions-item').filter({ hasText: manifest.name });
    await expect(extension).toHaveCount(1);
    const extensionId = await extension.getAttribute('id');
    expect(extensionId).toMatch(/^[a-p]{32}$/);
    const url = `chrome-extension://${extensionId}`;
    await options.goto(url + '/' + (manifest.options_ui?.page ?? manifest.options_page));
    await expect(options.getByRole('heading', { name: 'Application profile' })).toBeVisible();
    return { context, close, options, url, manifest };
  } catch (error) {
    await close();
    throw error;
  }
}

async function saveProfile(options: Page): Promise<void> {
  await options.getByLabel('First name', { exact: true }).fill('Sasha');
  await options.getByLabel('Last name', { exact: true }).fill('Rivera');
  await options.getByLabel('Email', { exact: true }).fill('sasha.rivera@example.test');
  await options.getByRole('button', { name: 'Save profile' }).click();
  await expect(options.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();
}

async function openPopup({ context, url, manifest }: InstalledExtension, form: Page): Promise<Page> {
  const target = await context.newCDPSession(form);
  try {
    const pagePromise = context.waitForEvent('page');
    await target.send('Target.createTarget', {
      url: url + '/' + manifest.action.default_popup,
      background: true,
    });
    const popup = await pagePromise;
    await expect(popup.getByRole('heading', { name: 'Application autofill' })).toBeVisible();
    return popup;
  } finally {
    await target.detach();
  }
}

for (const unavailable of [false, true]) test(`one-click hybrid Autofill ${unavailable ? 'keeps local answers when Claude is unavailable' : 'matches question meanings and newly revealed fields through the installed worker'}`, async ({}, info) => {
  test.setTimeout(45_000);
  const extension = await loadExtension(info);
  const applicationUrl = 'https://application.example.test/hybrid?session=synthetic-session';
  const questionsSent: { id: string; label: string; context?: string }[][] = [];
  try {
    await saveProfile(extension.options);
    await extension.options.getByLabel('Provider', { exact: true }).selectOption('anthropic');
    await extension.options.getByLabel('API key', { exact: true }).fill('sk-ant-synthetic-hybrid-key');
    await extension.options.getByRole('checkbox', { name: 'Enable AI suggestions' }).check();
    await expect(extension.options.getByRole('checkbox', { name: 'Match unfamiliar questions during Autofill' })).toBeChecked();
    await extension.options.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(extension.options.locator('#ai-status')).toHaveText('AI settings saved.');
    const html = `<!doctype html><title>Synthetic hybrid application</title><h1>Application</h1><form>
      <label>First name<input id="first-name" autocomplete="given-name"></label>
      <label>Is moving for this position off the table?<select id="relocation"><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
      <p id="visa-question">Is employment visa sponsorship something you will not need?</p>
      <label>Status<select id="sponsorship" aria-describedby="visa-question"><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
      <label id="gender-field" hidden>Which gender category best reflects how you identify?<select id="gender"><option value="">Choose</option><option>Male</option><option>Female</option></select></label>
      <button type="submit">Submit application</button></form><script>
      window.submits = 0;
      document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); window.submits++; });
      document.querySelector('#relocation').addEventListener('change', e => { document.querySelector('#gender-field').hidden = e.target.value !== 'No'; });
      </script>`;
    await extension.context.route(/^https?:\/\//, async route => {
      const request = route.request();
      if (request.url() === applicationUrl) return route.fulfill({ contentType: 'text/html', body: html });
      if (request.url() !== 'https://api.anthropic.com/v1/messages') return route.abort();
      const body = request.postDataJSON();
      const serialized = JSON.stringify(body);
      for (const excluded of ['Sasha', 'Rivera', 'sasha.rivera@example.test', 'sk-ant-synthetic-hybrid-key', 'synthetic-session', 'application.example.test']) expect(serialized).not.toContain(excluded);
      const questions = JSON.parse(body.messages[0].content).questions as typeof questionsSent[number];
      questionsSent.push(questions);
      if (unavailable) return route.fulfill({ status: 503, body: '' });
      const meanings = questions.map(question => {
        const source = question.context || question.label;
        const fact = source.includes('sponsorship') ? 'visaSponsorship' : source.includes('gender') ? 'gender' : 'relocation';
        return { fieldId: question.id, fact, inverse: fact !== 'gender', country: null, confidence: 'high', evidence: source };
      });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'message', role: 'assistant', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ meanings }) }] }) });
    });
    const page = await extension.context.newPage();
    await page.goto(applicationUrl);
    await page.getByRole('button', { name: 'Open JobRight Local' }).click();
    const panel = page.getByRole('region', { name: 'JobRight Local autofill', exact: true });
    await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText(unavailable ? '1 filled' : '4 filled', { timeout: 20_000 });
    await expect(page.locator('#first-name')).toHaveValue('Sasha');
    expect(questionsSent).toHaveLength(unavailable ? 1 : 2);
    expect(questionsSent[0].find(question => question.label === 'Status')?.context).toBe('Is employment visa sponsorship something you will not need?');
    if (unavailable) {
      await expect(page.locator('#relocation')).toHaveValue('');
      await expect(page.locator('#sponsorship')).toHaveValue('');
      await expect(panel).toContainText('local profile and saved answers are still available');
    } else {
      await expect(page.locator('#relocation')).toHaveValue('No');
      await expect(page.locator('#sponsorship')).toHaveValue('No');
      await expect(page.locator('#gender')).toHaveValue('Male');
      await expect(panel.getByRole('status')).toContainText('3 matched with AI');
      await page.screenshot({ path: info.outputPath('hybrid-autofill.png'), fullPage: true });
    }
    expect(await page.evaluate(() => Reflect.get(window, 'submits'))).toBe(0);
    expect(await page.evaluate(() => typeof window.__jobrightPage)).toBe('undefined');
    await panel.getByRole('button', { name: 'Undo last fill' }).click();
    await expect(panel.getByRole('status')).toContainText(unavailable ? '1 restored' : '4 restored');
    await expect(page.locator('#first-name')).toBeEmpty();
    await expect(page.locator('#relocation')).toHaveValue('');
    await expect(page.locator('#sponsorship')).toHaveValue('');
    await expect(page.locator('#gender')).toHaveValue('');
    await expect(page.locator('#gender-field')).toBeHidden();
  } finally { await extension.close(); }
});

test('one-click autofill continues after closing the popup and switching tabs', async ({}, info) => {
  const extension = await loadExtension(info);
  const origin = 'https://application.example.test';
  try {
    await saveProfile(extension.options);
    const html = (await readFile(resolve('fixtures/semantic-application.html'), 'utf8')).replace('}, 40);', '}, 180);');
    await extension.context.route(/^https?:\/\//, route => route.request().url().startsWith(origin)
      ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    const first = await extension.context.newPage();
    await first.goto(origin + '/application/first');
    const second = await extension.context.newPage();
    await second.goto(origin + '/application/second');
    await first.bringToFront();
    const popup = await openPopup(extension, first);
    await popup.getByRole('button', { name: 'Autofill', exact: true }).click();
    await expect(popup.getByRole('status')).toContainText('running on the application page');
    await popup.close();
    await second.bringToFront();

    const panel = first.getByRole('region', { name: 'JobRight Local autofill', exact: true });
    await expect(panel.getByRole('status')).toContainText('12 filled', { timeout: 15_000 });
    await expect(first.locator('#gh-sponsorship')).toHaveValue('I need visa sponsorship');
    await expect(first.locator('#disability')).toHaveValue('n');
    await expect(first.locator('#veteran')).toHaveValue('not-protected');
    await expect(first.locator('input[name=privacy_accept]')).toBeChecked();
    await expect(first.locator('input[name=mixed_terms]')).not.toBeChecked();
    await expect(second.locator('#gh-sponsorship')).toBeEmpty();
    await expect(second.locator('#disability')).toHaveValue('');
    await expect(second.locator('input[name=privacy_accept]')).not.toBeChecked();
    await expect(second.getByRole('button', { name: 'Open JobRight Local' })).toBeVisible();

    await first.bringToFront();
    await panel.getByRole('button', { name: 'Minimize autofill' }).click();
    await first.getByRole('button', { name: 'Open JobRight Local' }).click();
    await expect(panel.getByRole('status')).toContainText('12 filled');
    await first.screenshot({ path: info.outputPath('on-page-autofill.png'), fullPage: true });
    // This custom button emits click only. An away-and-back manual edit still owns its value.
    await first.locator('#disability-check').click();
    await first.locator('#disability-check').click();
    await panel.getByRole('button', { name: 'Undo last fill' }).click();
    await expect(panel.getByRole('status')).toContainText('restored');
    await expect(first.locator('#disability')).toHaveValue('');
    await expect(first.locator('input[name=privacy_accept]')).not.toBeChecked();
    await expect(first.locator('#disability-check')).toHaveAttribute('aria-checked', 'true');
    for (const page of [first, second]) {
      expect(await page.evaluate(() => Reflect.get(window, 'fixtureEvents'))).toMatchObject({ submitEvents: 0, submitButtonClicks: 0 });
    }
  } finally { await extension.close(); }
});

test('corner autofill works without opening the toolbar and ignores page-created clicks', async ({}, info) => {
  const extension = await loadExtension(info);
  const url = 'https://application.example.test/apply';
  try {
    await saveProfile(extension.options);
    const html = `<!doctype html><h1>Job application</h1><form>
      <label>First name<input autocomplete="given-name"></label>
      <label>Last name<input autocomplete="family-name"></label>
      <label>Email<input type="email" autocomplete="email"></label>
      <button type="submit">Submit application</button></form>`;
    await extension.context.route(/^https?:\/\//, route => route.request().url() === url
      ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    const page = await extension.context.newPage();
    await page.goto(url);
    await page.getByRole('button', { name: 'Open JobRight Local' }).click();
    const panel = page.getByRole('region', { name: 'JobRight Local autofill', exact: true });
    await panel.getByRole('button', { name: 'Autofill', exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await expect(page.getByLabel('First name')).toBeEmpty();
    await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('3 filled');
    await expect(page.getByLabel('First name')).toHaveValue('Sasha');
    await expect(page.getByLabel('Email')).toHaveValue('sasha.rivera@example.test');
    // The content world never exposes the profile, controller, or API keys to page JS.
    expect(await page.evaluate(() => typeof window.__jobrightPage)).toBe('undefined');
    await panel.getByRole('button', { name: 'Undo last fill' }).click();
    await expect(page.getByLabel('First name')).toBeEmpty();
    await expect(page.getByLabel('Last name')).toBeEmpty();
  } finally { await extension.close(); }
});

test('remaining field links focus their own frame and refuse a stale document', async ({}, info) => {
  const extension = await loadExtension(info);
  const url = 'https://application.example.test/apply';
  const frameUrl = 'https://application.example.test/screening';
  const label = 'Share any additional details';
  const question = `<label>${label}<textarea id="details-answer" required></textarea></label>`;
  const protectForm = `<script>
    const form = document.querySelector('form');
    const answer = document.querySelector('#details-answer');
    answer.dataset.edits = '0';
    answer.dataset.focuses = '0';
    for (const event of ['input', 'change', 'click']) {
      answer.addEventListener(event, () => { answer.dataset.edits = String(Number(answer.dataset.edits) + 1); });
    }
    answer.addEventListener('focus', () => { answer.dataset.focuses = String(Number(answer.dataset.focuses) + 1); });
    form.dataset.submits = '0';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      form.dataset.submits = String(Number(form.dataset.submits) + 1);
    });
  </script>`;
  const gap = '<div aria-hidden="true" style="height: 140vh"></div>';
  let navigationCount = 0;
  try {
    await saveProfile(extension.options);
    await extension.context.route(/^https?:\/\//, (route) => {
      if (route.request().url() === url) return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <h1>Job application</h1><form>
          <label>First name<input autocomplete="given-name"></label>
          <label>Last name<input autocomplete="family-name"></label>
          <label>Email<input type="email" autocomplete="email"></label>
          ${gap}${question}<button type="submit">Submit application</button>
        </form>${protectForm}${gap}
        <iframe id="screening-frame" title="Screening questions" width="500" height="300" src="${frameUrl}"></iframe>` });
      if (route.request().url() === frameUrl) {
        const title = ++navigationCount === 1 ? 'Screening questions' : 'Replacement screening questions';
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><h1>${title}</h1>
          <form>${gap}${question}<button type="submit">Submit screening responses</button></form>${protectForm}` });
      }
      return route.abort();
    });
    const page = await extension.context.newPage();
    await page.goto(url);
    await page.bringToFront();
    const frame = page.frameLocator('#screening-frame');
    await expect(frame.getByRole('heading', { name: 'Screening questions', exact: true })).toBeVisible();
    const topAnswer = page.getByRole('textbox', { name: label });
    const frameAnswer = frame.getByRole('textbox', { name: label });
    await page.getByRole('button', { name: 'Open JobRight Local' }).click();
    const panel = page.getByRole('region', { name: 'JobRight Local autofill', exact: true });
    await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
    await expect(panel.getByText('3 filled · 2 need attention', { exact: true })).toBeVisible();
    await panel.getByText('Fields that need attention', { exact: true }).click();
    const links = panel.getByRole('button', { name: `Show field: ${label}`, exact: true });
    await expect(links).toHaveCount(2);

    await expect(topAnswer).not.toBeInViewport();
    await links.first().click();
    await expect(topAnswer).toBeFocused();
    await expect(topAnswer).toBeInViewport();
    await expect(panel.getByRole('status')).toContainText('Field highlighted on the application.');
    await expect(frameAnswer).toHaveAttribute('data-focuses', '0');

    await expect(frameAnswer).not.toBeInViewport();
    await links.last().click();
    await expect(frameAnswer).toBeFocused();
    await expect(frameAnswer).toBeInViewport();
    await expect(topAnswer).toHaveAttribute('data-focuses', '1');
    await expect(frameAnswer).toHaveAttribute('data-focuses', '1');
    await expect(frameAnswer).toBeEmpty();
    await expect(frameAnswer).toHaveAttribute('data-edits', '0');
    await expect(frame.locator('form')).toHaveAttribute('data-submits', '0');

    // Reload the same frame URL to keep its frame ID and replace its document.
    await page.locator('#screening-frame').evaluate((element: HTMLIFrameElement) => element.contentWindow!.location.reload());
    await expect(frame.getByRole('heading', { name: 'Replacement screening questions' })).toBeVisible();
    await links.last().click();
    await expect(panel.getByText(/This field is no longer available|This field changed/)).toBeVisible();
    await expect(frameAnswer).not.toBeFocused();
    await expect(frameAnswer).toHaveAttribute('data-focuses', '0');
    await expect(frameAnswer).toBeEmpty();
    await expect(frameAnswer).toHaveAttribute('data-edits', '0');
    await expect(topAnswer).toHaveAttribute('data-focuses', '1');
    await expect(topAnswer).toBeEmpty();
    await expect(topAnswer).toHaveAttribute('data-edits', '0');
    await expect(page.locator('form')).toHaveAttribute('data-submits', '0');
    await expect(frame.locator('form')).toHaveAttribute('data-submits', '0');
  } finally { await extension.close(); }
});

test('explicit saved preferences fill city, privacy, and dependent race questions in one click', async ({}, info) => {
  const extension = await loadExtension(info);
  const applicationUrl = 'https://application.example.test/c3-followup';
  try {
    // Synthetic profile: all preferences are explicitly supplied by this test.
    await extension.options.evaluate(async candidate => {
      const api = Reflect.get(window, 'browser') ?? Reflect.get(window, 'chrome');
      await api.storage.local.set({ 'jobright.profile.v1': candidate });
      await api.storage.local.remove('jobright.application-defaults.revision');
    }, { ...profile, answers: [], applicationDefaults: {
      visaSponsorship: 'yes', gender: 'male', disability: 'no', veteran: 'no',
      hispanicLatino: 'no', acceptApplicationPrivacy: true,
      onsiteWork: 'yes', relocation: 'yes', raceEthnicity: 'south_asian',
    } });
    await extension.options.reload();
    await expect(extension.options.getByLabel('Willing to work onsite', { exact: true })).toHaveValue('yes');
    await expect(extension.options.getByLabel('Willing to relocate', { exact: true })).toHaveValue('yes');
    await expect(extension.options.getByLabel('Race or ethnicity', { exact: true })).toHaveValue('south_asian');
    await expect(extension.options.getByRole('checkbox', { name: 'Enable AI suggestions' })).not.toBeChecked();

    const html = await readFile(resolve('fixtures/c3-followup.html'), 'utf8');
    await extension.context.route(/^https?:\/\//, route => route.request().url() === applicationUrl
      ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    const page = await extension.context.newPage();
    await page.goto(applicationUrl);
    await expect(page.locator('#gh-race')).toBeHidden();
    await page.getByRole('button', { name: 'Open JobRight Local' }).click();
    const panel = page.getByRole('region', { name: 'JobRight Local autofill', exact: true });
    await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('6 filled', { timeout: 15_000 });
    await expect(page.locator('#gh-onsite')).toHaveValue('Yes');
    await expect(page.locator('#other-city')).toHaveValue('y');
    await expect(page.locator('#gh-hispanic')).toHaveValue('No');
    await expect(page.locator('#gh-race')).toHaveValue('Asian');
    await expect(page.locator('#specific-race')).toHaveValue('South Asian');
    await expect(page.locator('.application-privacy input')).toBeChecked();
    await expect(page.locator('#terms')).not.toBeChecked();
    await page.screenshot({ path: info.outputPath('c3-followup-autofill.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Undo last fill' }).click();
    await expect(panel.getByRole('status')).toContainText('6 restored');
    await expect(page.locator('#gh-onsite')).toBeEmpty();
    await expect(page.locator('#other-city')).toHaveValue('');
    await expect(page.locator('#gh-hispanic')).toBeEmpty();
    await expect(page.locator('#gh-race')).toBeHidden();
    await expect(page.locator('#gh-race')).toBeEmpty();
    await expect(page.locator('#specific-race')).toBeEmpty();
    await expect(page.locator('.application-privacy input')).not.toBeChecked();
    expect(await page.evaluate(() => Reflect.get(window, 'fixtureEvents'))).toMatchObject({
      submitEvents: 0, submitButtonClicks: 0,
    });
  } finally { await extension.close(); }
});

test('advanced preview leaves dependent fields unchecked and undo preserves their manual answers', async ({}, info) => {
  const origin = 'https://example.test';
  const extension = await loadExtension(info, origin);
  try {
    await saveProfile(extension.options);
    const form = await extension.context.newPage();
    await form.route('**/*', route => route.request().url() === origin + '/dependent'
      ? route.fulfill({ contentType: 'text/html', body: `<!doctype html><form>
        <label>First Name<input name="firstName"></label><div id="dependent"></div>
        <button type="submit">Submit application</button></form>
        <script>
          window.submitCount = 0;
          document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); window.submitCount++; });
          document.querySelector('[name=firstName]').addEventListener('change', event => {
            if (!event.target.value) document.querySelector('#dependent').replaceChildren();
            if (event.target.value && !document.querySelector('[name=lastName]'))
              document.querySelector('#dependent').innerHTML = '<label>Last Name<input name="lastName" required></label>';
          });
        </script>` })
      : route.abort());
    await form.goto(origin + '/dependent');
    await form.bringToFront();
    const popup = await openPopup(extension, form);
    await popup.getByRole('button', { name: 'Review fields', exact: true }).click();
    await popup.getByRole('button', { name: 'Fill selected (1)', exact: true }).click();
    await expect(form.getByLabel('First Name')).toHaveValue('Sasha');
    await expect(form.getByLabel('Last Name')).toBeEmpty();
    const followup = popup.getByRole('checkbox', { name: /Last Name/ });
    await expect(followup).toBeVisible();
    await expect(followup).not.toBeChecked();
    await expect(popup.getByRole('button', { name: 'Fill selected', exact: true })).toBeDisabled();
    await expect(popup.getByRole('status')).toContainText('Preview refreshed');
    await followup.check();
    await form.getByLabel('Last Name').fill('Applicant edit');
    await popup.getByRole('button', { name: 'Fill selected (1)', exact: true }).click();
    await expect(popup.getByRole('status')).toContainText('1 skipped');
    await popup.getByRole('button', { name: /Undo last fill/i }).click();
    await expect(popup.getByRole('status')).toHaveText('0 restored. 1 skipped after the fields changed.');
    // Clearing the prerequisite would remove the dependent applicant edit.
    await expect(form.getByLabel('First Name')).toHaveValue('Sasha');
    await expect(form.getByLabel('Last Name')).toBeVisible();
    await expect(form.getByLabel('Last Name')).toHaveValue('Applicant edit');
    expect(await form.evaluate(() => Reflect.get(window, 'submitCount'))).toBe(0);
  } finally {
    await extension.close();
  }
});

test('production Chromium extension stores and reloads the profile', async ({}, info) => {
  const extension = await loadExtension(info);
  try {
    const { manifest, options, url, context } = extension;
    expect(manifest.host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(manifest.optional_host_permissions).toEqual(['https://api.openai.com/*', 'https://api.anthropic.com/*']);
    await saveProfile(options);
    await options.reload();
    await expect(options.getByLabel('First name', { exact: true })).toHaveValue('Sasha');
    await expect(options.getByLabel('Last name', { exact: true })).toHaveValue('Rivera');
    await expect(options.getByLabel('Email', { exact: true })).toHaveValue('sasha.rivera@example.test');
    await options.screenshot({ path: info.outputPath('options-profile.png'), fullPage: true });

    const popup = await context.newPage();
    await popup.goto(url + '/' + manifest.action.default_popup);
    await expect(popup.getByRole('heading', { name: 'Application autofill' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Fill selected' })).toBeDisabled();
  } finally {
    await extension.close();
  }
});

test('Chromium extension preview, selective fill, and undo use real browser APIs', async ({}, info) => {
  const fixtureOrigin = new URL(formUrls.lever).origin;
  const extension = await loadExtension(info, fixtureOrigin);
  const { options, context } = extension;
  try {
    await saveProfile(options);
    await options.getByLabel('API key', { exact: true }).fill(fixtureKey);
    await options.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(options.getByRole('status').filter({ hasText: 'AI settings saved.' })).toBeVisible();
    const form = await context.newPage();
    await serveFixture(form, 'lever');
    await form.bringToFront();

    let popup = await openPopup(extension, form);
    await popup.evaluate(() => {
      const api = Reflect.get(window, 'browser') ?? Reflect.get(window, 'chrome');
      const scripting = api.scripting;
      const execute = scripting.executeScript.bind(scripting);
      const injectionArguments: unknown[][] = [];
      Reflect.set(window, 'fixtureInjectionArguments', injectionArguments);
      scripting.executeScript = (details: { args?: unknown[] }) => {
        if (details.args) injectionArguments.push(details.args);
        return execute(details);
      };
    });
    await popup.getByRole('button', { name: 'Review fields' }).click();
    await expect(popup.getByRole('heading', { name: 'Form preview' })).toBeVisible();
    await expect(popup.getByText('Sasha Rivera', { exact: true })).toBeVisible();
    const injectionArguments = await popup.evaluate(() => JSON.stringify(Reflect.get(window, 'fixtureInjectionArguments')));
    expect(injectionArguments).toContain('sasha.rivera@example.test');
    expect(injectionArguments).not.toContain(fixtureKey);
    await expect(form.getByLabel('Full name')).toBeEmpty();
    await expect(form.getByLabel('Email')).toBeEmpty();
    await popup.getByRole('checkbox', { name: /email/i }).uncheck();
    await popup.getByRole('button', { name: 'Fill selected' }).click();
    await expect(form.getByLabel('Full name')).toHaveValue('Sasha Rivera');
    await expect(form.getByLabel('Email')).toBeEmpty();
    expect(await form.evaluate(() => typeof window.__jobrightLocal)).toBe('undefined');

    await popup.close();
    await form.bringToFront();
    popup = await openPopup(extension, form);
    await popup.getByRole('button', { name: 'Undo last fill' }).click();
    await expect(form.getByLabel('Full name')).toBeEmpty();
    await expect(form).toHaveURL(formUrls.lever);
    expect(await form.evaluate(() => Reflect.get(window, 'fixtureEvents'))).toEqual({
      submitEvents: 0, submitButtonClicks: 0,
    });
  } finally {
    await extension.close();
  }
});

test('Chromium extension previews all C3 AI fields and fills only the local profile answers', async ({}, info) => {
  const applicationUrl = 'https://c3.ai/careers/job/example-product-designer/';
  const extension = await loadExtension(info, new URL(applicationUrl).origin);
  const { context, options } = extension;
  try {
    const html = await readFile(resolve('fixtures/c3-application.html'), 'utf8');
    await context.route(/^https?:\/\//, (route) => route.request().url() === applicationUrl
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      : route.abort());

    await expect(options.getByRole('button', { name: 'Import JSON' })).toBeEnabled();
    await options.locator('#profile-import').setInputFiles({
      name: 'fixture-profile.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...profile, answers: [], applicationDefaults: {} })),
    });
    await options.getByRole('button', { name: 'Save profile' }).click();
    await expect(options.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    await expect(options.getByRole('checkbox', { name: 'Enable AI suggestions' })).not.toBeChecked();

    const form = await context.newPage();
    await form.goto(applicationUrl);
    await form.bringToFront();
    const popup = await openPopup(extension, form);
    await popup.getByRole('button', { name: 'Review fields' }).click();

    const preview = popup.getByRole('region', { name: 'Form preview' });
    const fieldRows = preview.locator('.field-row');
    await expect(preview.getByText(/20 fields detected · 10 ready/)).toBeVisible();
    await expect(fieldRows).toHaveCount(20);
    await expect(preview.getByText(/6 required fields need your attention/)).toBeVisible();
    const privacy = fieldRows.filter({ has: popup.getByText('I Accept', { exact: true }) });
    await expect(privacy.getByText('Required · Complete manually')).toBeVisible();
    const referral = fieldRows.filter({ has: popup.getByText('How did you hear about C3 AI?', { exact: true }) });
    await expect(referral.getByText('Required · Needs your answer')).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Suggest with AI' })).toBeHidden();
    await expect(form.getByRole('combobox', { name: 'Country' })).toBeEmpty();
    await expect(form.getByLabel('Where are you currently located?')).toBeEmpty();
    await popup.locator('body').screenshot({ path: info.outputPath('c3-profile-preview.png') });

    await popup.getByRole('button', { name: 'Fill selected (10)', exact: true }).click();
    await expect(popup.getByRole('status')).toHaveText(/^10 filled\./);
    await expect(form.getByRole('combobox', { name: 'Country' })).toHaveValue('United States');
    expect(await form.locator('.gh-apply-form').evaluate((node: HTMLFormElement) =>
      new FormData(node).get('country_short_name'),
    )).toBe('US');
    await expect(form.getByLabel('Location (City)')).toHaveValue('Detroit');
    await expect(form.getByLabel('Where are you currently located?')).toHaveValue('Detroit, Michigan, United States');
    const attachedResume = await form.locator('input[type="file"]').evaluate(async (input: HTMLInputElement) => {
      const file = input.files?.item(0);
      return file ? { name: file.name, body: await file.text() } : null;
    });
    expect(attachedResume).toEqual({ name: 'Morgan Lee - Resume.pdf', body: resumeText });

    const customAnswers = await form.locator('input[role="combobox"]:not([name="country_short_name"])')
      .evaluateAll((inputs: HTMLInputElement[]) => inputs.map((input) => input.value));
    expect(customAnswers).toEqual(['', '', '', '', '', '', '']);
    await expect(form.getByLabel('Portfolio Password (if needed)')).toBeEmpty();
    await expect(form.getByRole('checkbox', { name: 'I Accept', exact: true })).not.toBeChecked();
    expect(await form.evaluate(() => Reflect.get(window, 'fixtureEvents'))).toMatchObject({
      submitEvents: 0, submitButtonClicks: 0,
    });
    await expect(form).toHaveURL(applicationUrl);
  } finally {
    await extension.close();
  }
});


test('public profiles start blank and retain only explicitly saved preferences', async ({}, info) => {
  const extension = await loadExtension(info);
  try {
    const options = extension.options;
    const defaults = options.locator('select[id^="default-"]');
    await expect(defaults).toHaveCount(10);
    for (const field of await defaults.all()) await expect(field).toHaveValue('');
    for (const name of ['First name', 'Last name', 'Email', 'Phone', 'City', 'LinkedIn', 'Personal website', 'GitHub']) {
      await expect(options.getByLabel(name, { exact: true })).toBeEmpty();
    }
    await expect(options.locator('#education-list input')).toHaveCount(0);
    await expect(options.locator('#work-authorization-list input')).toHaveCount(0);
    await expect(options.getByLabel('API key', { exact: true })).toBeEmpty();
    await expect(options.getByRole('checkbox', { name: 'Enable AI suggestions' })).not.toBeChecked();

    await options.getByLabel('Gender', { exact: true }).selectOption('decline');
    await options.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(options.getByText('Profile saved.', { exact: true })).toBeVisible();
    await options.reload();
    await expect(options.getByLabel('Gender', { exact: true })).toHaveValue('decline');
    for (const id of ['default-visa-sponsorship', 'default-disability', 'default-veteran', 'default-hispanic-latino',
      'default-privacy', 'default-relocation', 'default-onsite-work', 'default-race-ethnicity', 'default-referral-source']) {
      await expect(options.locator('#' + id)).toHaveValue('');
    }
    await expect(options.locator('#work-authorization-list input')).toHaveCount(0);
  } finally { await extension.close(); }
});
