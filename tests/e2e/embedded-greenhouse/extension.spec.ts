import { chromium, expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const posting = 'https://careers.example.test/jobs/example/product-designer/?gh_jid=8302415';
const application = 'https://job-boards.greenhouse.io/embed/job_app?for=example&validityToken=synthetic&token=8302415&gh_jid=8302415';
const unrelated = 'https://unrelated.example.test/form';
const question = 'Is moving for this position off the table?';
const resumeName = 'synthetic-resume.pdf';

test('installed Autofill fills and undoes the original Greenhouse application frame', async ({}, info) => {
  test.setTimeout(45_000);
  const extensionPath = resolve(process.env.JOBRIGHT_TEST_EXTENSION ?? 'dist/chromium');
  const context = await chromium.launchPersistentContext(info.outputPath('browser-profile'), {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const options = await context.newPage();
    await options.goto(new URL('options.html', worker.url()).href);
    await options.getByLabel('First name', { exact: true }).fill('Sasha');
    await options.getByLabel('Choose resume file').setInputFiles({
      name: resumeName, mimeType: 'application/pdf', buffer: Buffer.from('%PDF synthetic regression fixture'),
    });
    await expect(options.locator('#resume-name')).toHaveText(resumeName);
    await options.getByRole('button', { name: 'Save profile' }).click();
    await expect(options.getByRole('status').filter({ hasText: /saved/i })).toBeVisible();
    await options.getByLabel('Provider', { exact: true }).selectOption('anthropic');
    await options.getByLabel('API key', { exact: true }).fill('sk-ant-synthetic-embedded-key');
    await options.getByRole('checkbox', { name: 'Enable AI suggestions' }).check();
    await options.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(options.locator('#ai-status')).toHaveText('AI settings saved.');
    const providerBodies: string[] = [];
    await context.route('https://api.anthropic.com/v1/messages', async route => {
      const body = route.request().postDataJSON();
      providerBodies.push(JSON.stringify(body));
      const questions = JSON.parse(body.messages[0].content).questions as { id: string; label: string }[];
      const meanings = questions.filter(item => item.label === question).map(item => ({
        fieldId: item.id, fact: 'relocation', inverse: true, country: null, confidence: 'high',
        evidence: 'moving for this position off the table',
      }));
      await route.fulfill({ json: { type: 'message', role: 'assistant', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ meanings }) }] } });
    });

    await context.route(posting, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <title>Product Designer</title><h1>Product Designer</h1><h2>Apply For This Position</h2>
      <iframe title="Another Greenhouse frame" src="${application.replaceAll('&', '&amp;')}"></iframe>
      <div id="grnhse_app"><iframe id="grnhse_iframe" title="Greenhouse Job Board" src="${application.replaceAll('&', '&amp;')}"></iframe></div>
      <iframe title="Unrelated" src="${unrelated}"></iframe>
      <iframe hidden></iframe>
    ` }));
    await context.route(application, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <h2>Apply for this job</h2><form id="application-form" class="application--form">
        <label>First Name <input id="first_name" autocomplete="given-name" required></label>
        <label>Last Name <input id="last_name" autocomplete="family-name" required></label>
        <label>Email <input id="email" autocomplete="email" required></label>
        <label>Phone <input id="phone" type="tel"></label>
        <div class="file-upload" role="group" aria-labelledby="upload-label-resume" aria-required="true" data-allow-s3="false">
          <div id="upload-label-resume" class="label upload-label">Resume/CV<span aria-hidden="true">*</span></div>
          <div class="file-upload__wrapper"><label for="resume">Attach</label><input id="resume" type="file" accept=".pdf" hidden></div>
        </div>
        <label>${question}<select id="mobility"><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
        <button type="submit">Submit application</button>
      </form>
      <form id="newsletter"><label>First Name <input autocomplete="given-name"></label></form>
      <script>
        const input = document.getElementById('resume');
        const wrapper = input.parentNode;
        input.addEventListener('change', () => {
          const filename = input.files[0]?.name;
          if (!filename) return;
          wrapper.innerHTML = '<progress aria-label="Uploading résumé"></progress>';
          setTimeout(() => {
            wrapper.innerHTML = '<div class="file-upload__filename"><p class="body body__secondary"></p><button class="icon-button" type="button" aria-label="Remove file"></button></div>';
            wrapper.querySelector('p').textContent = filename;
            wrapper.querySelector('button').addEventListener('click', () => wrapper.replaceChildren());
          }, 40);
        });
        document.querySelector('button[type="submit"]').addEventListener('click', () => { document.body.dataset.submitClick = 'yes'; });
        document.addEventListener('submit', event => { event.preventDefault(); document.body.dataset.submitted = 'yes'; });
      </script>
    ` }));
    await context.route(unrelated, route => route.fulfill({ contentType: 'text/html', body: '<label>First Name <input autocomplete="given-name"></label>' }));
    const page = await context.newPage();
    await page.goto(posting);
    const frame = page.frameLocator('#grnhse_iframe');
    await expect(frame.locator('#first_name')).toBeVisible();
    await page.getByRole('button', { name: 'Open JobRight Local' }).click();
    const panel = page.getByRole('region', { name: 'JobRight Local autofill' });
    await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
    await expect(frame.locator('#first_name')).toHaveValue('Sasha', { timeout: 3500 });
    await expect(frame.locator('.file-upload__filename')).toHaveText(resumeName);
    await expect(frame.locator('#resume')).toHaveCount(0);
    await expect(panel.getByRole('status')).toContainText('1 matched with AI', { timeout: 12_000 });
    await expect(panel.getByRole('status')).toContainText('3 filled');
    await expect(frame.locator('#mobility')).toHaveValue('No');
    expect(providerBodies).toHaveLength(1);
    for (const privateValue of ['Sasha', resumeName, '8302415', 'validityToken', 'careers.example.test', 'sk-ant-synthetic-embedded-key']) {
      expect(providerBodies[0]).not.toContain(privateValue);
    }
    await expect(frame.locator('#newsletter input')).toBeEmpty();
    await expect(page.frameLocator('iframe[title="Another Greenhouse frame"]').locator('#first_name')).toBeEmpty();
    await expect(page.frameLocator('iframe[title="Unrelated"]').getByRole('textbox')).toBeEmpty();
    await panel.locator('summary').click();
    await panel.getByRole('button', { name: 'Show field: Email' }).click();
    await expect(frame.locator('#email')).toBeFocused();
    await panel.getByRole('button', { name: 'Undo last fill' }).click();
    await expect(frame.locator('#first_name')).toBeEmpty();
    await expect(frame.locator('#mobility')).toHaveValue('');
    await expect(frame.locator('.file-upload__filename')).toHaveText(resumeName);

    const cdp = await context.newCDPSession(page);
    const popupReady = context.waitForEvent('page');
    try {
      await cdp.send('Target.createTarget', { url: new URL('popup.html', worker.url()).href, background: true });
    } finally { await cdp.detach(); }
    const popup = await popupReady;
    const review = popup.getByRole('button', { name: /^(Review fields|Refresh field review)$/ });
    const fill = popup.getByRole('button', { name: 'Fill selected (1)', exact: true });
    await review.click();
    await expect(fill).toBeEnabled();
    await frame.locator('#application-form').evaluate(form => form.replaceWith(form.cloneNode(true)));
    await fill.click();
    await expect(popup.getByRole('status')).toContainText('1 failed');
    await expect(frame.locator('#first_name')).toBeEmpty();
    await review.click();
    await fill.click();
    await expect(frame.locator('#first_name')).toHaveValue('Sasha');
    await popup.getByRole('button', { name: 'Undo last fill' }).click();
    await expect(frame.locator('#first_name')).toBeEmpty();
    await expect(frame.locator('body')).not.toHaveAttribute('data-submitted');
    await expect(frame.locator('body')).not.toHaveAttribute('data-submit-click');
  } finally {
    await context.close();
  }
});
