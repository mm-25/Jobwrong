import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { installBrowserBoundary } from './boundary.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({
  options: { browser: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
});
const targets = values.browser ? [values.browser] : ['chromium', 'firefox'];
if (values.help) {
  console.log('Usage: node tests/ui/check.mjs [--browser chromium|firefox]');
} else if (targets.some(name => !['chromium', 'firefox'].includes(name))) {
  console.error('Choose chromium or firefox with --browser.');
  process.exitCode = 1;
} else {
  await main();
}

async function main() {
  const tempRoot = resolve(root, '.cache/tmp');
  await mkdir(tempRoot, { recursive: true });
  const runDirectory = await mkdtemp(resolve(tempRoot, 'jobright-ui-'));
  process.env.TMPDIR = runDirectory;
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, '.cache/ms-playwright');

  try {
    const { chromium, firefox } = await import('playwright');
    const browsers = { chromium, firefox };
    const assets = await bundleAssets();
    for (const name of targets) {
      try {
        await checkBrowser(name, browsers[name], assets, runDirectory);
      } catch (error) {
        console.error(`${name} UI checks failed`, error);
        process.exitCode = 1;
      }
    }
  } finally {
    await rm(runDirectory, { recursive: true, force: true });
  }
}

async function bundleAssets() {
  const assets = new Map();
  for (const name of ['options', 'popup']) {
    const { outputFiles: [bundle] } = await build({
      entryPoints: [resolve(root, 'src/ui', `${name}.ts`)],
      bundle: true,
      write: false,
      format: 'iife',
      target: ['chrome120', 'firefox140'],
    });
    const html = await readFile(resolve(root, 'public', `${name}.html`), 'utf8');
    assets.set(`/${name}.js`, { contentType: 'text/javascript', body: bundle.text });
    assets.set(`/${name}.html`, { contentType: 'text/html', body: html });
  }
  assets.set('/extension.css', {
    contentType: 'text/css',
    body: await readFile(resolve(root, 'public/extension.css'), 'utf8'),
  });
  return assets;
}

async function checkBrowser(name, launcher, assets, runDirectory) {
  const browser = await launcher.launch({
    ...(name === 'chromium' ? { channel: 'chromium' } : {}),
    downloadsPath: runDirectory,
  });
  try {
    for (const [label, run] of [['popup', checkPopup], ['profile', checkProfile]]) {
      const context = await browser.newContext({ viewport: { width: 388, height: 586 } });
      try {
        context.setDefaultTimeout(8_000);
        await context.addInitScript(installBrowserBoundary);
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          const asset = url.origin === 'http://extension.test' && assets.get(url.pathname);
          return asset ? route.fulfill(asset) : route.abort();
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => { errors.push(error); });
        await run(page);
        assert.deepEqual(errors, [], 'Uncaught page errors');
        console.log(`${name} ${label} checks passed`);
      } catch (error) {
        console.error(`${name} ${label} checks failed`, error);
        process.exitCode = 1;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function checkPopup(page) {
  const fillOne = page.getByRole('button', { name: 'Fill selected (1)', exact: true });
  const suggest = page.getByRole('button', { name: 'Suggest with AI' });
  const addToPreview = page.getByRole('button', { name: 'Add to preview' });
  const review = page.locator('#ai-review');
  const notes = page.getByRole('textbox', { name: 'Notes for this application' });
  const applicationNotes = 'I enjoy making the first experience easier for new users.';

  await page.goto('http://extension.test/popup.html');
  await page.getByRole('button', { name: 'View Obsidian sources', exact: true }).click();
  await page.getByText('Portfolio/Research.md · Study · lines 4–8', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => fixtureState.aiRequests.length), 0, 'Source lookup never calls AI');
  assert.deepEqual(await page.evaluate(() => fixtureState.sourceRequests), [{ channel: 'jobright-local-vault-v1', command: 'sources', tabId: 44, url: 'https://example.test/apply' }]);
  await page.getByRole('button', { name: 'Review fields', exact: true }).click();
  await fillOne.waitFor();
  assert.match(await page.locator('#scan-summary').textContent(), /7 fields detected/);
  assert.equal(await page.locator('#frames .field-row').count(), 7, 'Every detected field remains visible, including manual fields');
  assert.match(await page.locator('#manual-summary').textContent(), /1 required field needs your attention/);
  assert.match(await page.locator('#frames .field-row').filter({hasText:'Visa sponsorship'}).textContent(), /Required.*Needs your answer/s);
  assert(await page.getByText('Kept · user@example.com').isVisible());
  assert.equal(await page.evaluate(() => fixtureState.aiRequests.length), 0);
  await page.getByRole('button', { name: 'Show field: Visa sponsorship', exact: true }).click();
  await page.getByText('Field highlighted on the application.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Show field: What did you design?', exact: true }).nth(1).click();
  await page.getByText('Field highlighted on the application.', { exact: true }).waitFor();
  const jumps = await page.evaluate(() => fixtureState.focusRequests);
  assert.deepEqual(jumps.map(({ tabId, url, focus }) => ({ tabId, url, focus })), [
    { tabId: 44, url: 'https://example.test/apply', focus: { fieldId: 'sensitive', frameId: 0, frameUrl: 'https://example.test/apply', documentId: 'document-0' } },
    { tabId: 44, url: 'https://example.test/apply', focus: { fieldId: 'same', frameId: 7, frameUrl: 'https://example.test/embedded', documentId: 'document-7' } },
  ]);
  assert.equal(await page.evaluate(() => fixtureState.fills.length), 0, 'Locating fields never fills them');
  assert.equal(await page.evaluate(() => fixtureState.aiRequests.length), 0, 'Locating fields never requests AI');
  await page.getByRole('checkbox', { name: 'Replace existing answers' }).check();
  await page.getByRole('button', { name: 'Fill selected (2)', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'Replace existing answers' }).uncheck();
  await fillOne.waitFor();
  await notes.fill(`  ${applicationNotes}  `);
  assert.equal(await page.evaluate(() => fixtureState.aiRequests.length), 0, 'Typing notes does not request AI');
  await suggest.evaluate(button => button.click());
  assert.equal(await page.evaluate(() => fixtureState.aiRequests.length), 0, 'A scripted click does not send application notes');

  await page.evaluate(() => { fixtureState.permissionDenied = true; });
  await suggest.click();
  await page.getByText('AI provider access was declined.', { exact: false }).waitFor();
  assert(await fillOne.isEnabled());
  assert.equal(await page.evaluate(() => fixtureState.aiRequests.length), 0);

  await page.evaluate(() => {
    fixtureState.permissionDenied = false;
    fixtureState.providerUnavailable = true;
  });
  await suggest.click();
  await page.getByText('AI request failed (503).', { exact: false }).waitFor();
  assert(await fillOne.isEnabled());

  await page.evaluate(() => { fixtureState.providerUnavailable = false; });
  await suggest.click();
  await page.getByRole('heading', { name: 'Review AI suggestions' }).waitFor();
  assert(await addToPreview.isDisabled());
  const topDraft = review.locator('.field-row').filter({ hasNotText: 'Embedded form' }).filter({ hasText: 'What did you design?' });
  const embeddedDraft = review.locator('.field-row').filter({ hasText: 'Embedded form' });
  const draftText = embeddedDraft.getByRole('textbox', { name: 'Draft answer for What did you design?' });
  assert.equal(await draftText.inputValue(), 'Designed the setup flow.');
  const optionRow = review.locator('.field-row').filter({ hasText: 'Which design discipline is closest to your background?' });
  assert(await optionRow.getByText('Product design', { exact: true }).isVisible());
  assert.equal(await optionRow.getByRole('textbox').count(), 0, 'Exact choice cannot be edited into arbitrary text');
  assert(!(await optionRow.getByRole('checkbox').isChecked()));
  await embeddedDraft.getByRole('checkbox').check();
  await draftText.fill('  ');
  assert(await addToPreview.isDisabled());
  assert(await embeddedDraft.getByText('Enter a draft of 1 to 4,000 characters.').isVisible());
  await draftText.evaluate(node => {
    node.value = 'x'.repeat(4001);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert(await addToPreview.isDisabled());
  const editedDraft = 'Designed a clearer setup flow for new users.';
  await draftText.fill(`  ${editedDraft}  `);
  assert(await addToPreview.isEnabled());
  await page.getByRole('checkbox', { name: /First name.*Harper/ }).uncheck();
  await addToPreview.click();
  await page.getByText('Reviewed suggestions added to the preview.').waitFor();
  const firstApproval = await page.evaluate(() => fixtureState);
  assert.deepEqual(firstApproval.scans.slice(-2).map(frame => frame.reviewedAnswers), [
    undefined,
    { same: editedDraft },
  ]);
  assert.deepEqual(firstApproval.aiRequests[1].questions.map(question => question.fieldId), ['0:same', '0:choice', '7:same']);
  assert.equal(firstApproval.aiRequests[1].applicationNotes, applicationNotes);
  assert(!JSON.stringify(firstApproval.aiRequests[1]).includes('sample@example.com'));
  assert.equal(await notes.inputValue(), `  ${applicationNotes}  `, 'Notes remain available for the same review');

  // A later approval must keep earlier answers in the preview without
  // reselecting a field the applicant deliberately unchecked.
  await page.getByRole('checkbox', { name: new RegExp(editedDraft) }).uncheck();
  await suggest.click();
  await topDraft.getByRole('checkbox').check();
  await addToPreview.click();
  await page.getByText('Reviewed suggestions added to the preview.').waitFor();
  const secondApproval = await page.evaluate(() => fixtureState);
  assert.deepEqual(secondApproval.scans.slice(-2).map(frame => frame.reviewedAnswers), [
    { same: 'Designed the reporting view.' },
    { same: editedDraft },
  ]);
  assert.deepEqual(secondApproval.aiRequests[2].questions.map(question => question.fieldId), ['0:same', '0:choice']);
  assert(await page.getByRole('checkbox', { name: new RegExp(editedDraft) }).isVisible());
  assert(!(await page.getByRole('checkbox', { name: new RegExp(editedDraft) }).isChecked()));
  assert.equal(secondApproval.fills.length, 0);
  assert.deepEqual(secondApproval.values['jobright.profile.v1'].answers, [], 'AI drafts are not persisted as saved answers by the profile migration');
  assert(!JSON.stringify(secondApproval.values).includes(applicationNotes), 'Application notes are not persisted');

  await fillOne.click();
  await page.getByText('1 filled. Preview refreshed. Review remaining fields before filling again.').waitFor();
  await page.getByRole('button', { name: 'Fill selected', exact: true }).isDisabled().then(disabled => assert.equal(disabled, true));
  assert.deepEqual(await page.evaluate(() => fixtureState.fills), [{ frameId: 0, ids: ['same'] }]);
  await page.getByRole('button', { name: 'Undo last fill' }).click();
  await page.getByText('1 restored.').waitFor();
  await page.getByRole('button', { name: 'Refresh field review', exact: true }).click();
  await fillOne.waitFor();
  assert.equal(await notes.inputValue(), '');
  assert.deepEqual(await page.evaluate(() => fixtureState.scans.slice(-2).map(frame => frame.reviewedAnswers)), [undefined, undefined]);

  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('heading', { name: 'Application profile' }).waitFor();
}

async function checkProfile(page) {
  await page.setViewportSize({ width: 1140, height: 850 });
  await page.goto('http://extension.test/options.html');
  const firstName = page.getByLabel('First name', { exact: true });
  const preferredFirstName = page.getByLabel('Preferred first name', { exact: true });
  const skills = page.getByRole('textbox', { name: 'Skills' });
  const workAuthorization = page.getByRole('region', { name: 'Work authorization' });
  const saveProfile = page.getByRole('button', { name: 'Save profile', exact: true });
  const provider = page.getByLabel('Provider', { exact: true });
  const apiKey = page.getByLabel('API key', { exact: true });
  const model = page.getByLabel('Model ID', { exact: true });
  const aiEnabled = page.getByRole('checkbox', { name: 'Enable AI suggestions' });
  const matchQuestions = page.getByRole('checkbox', { name: 'Match unfamiliar questions during Autofill' });
  const defaults = page.getByRole('region', { name: 'Application defaults' });
  const visa = defaults.getByLabel('Visa sponsorship required');
  const gender = defaults.getByLabel('Gender', { exact: true });
  const disability = defaults.getByLabel('Disability', { exact: true });
  const veteran = defaults.getByLabel('Veteran status');
  const hispanicLatino = defaults.getByLabel('Hispanic or Latino');
  const privacy = defaults.getByLabel('Automatically accept application privacy notices');
  const relocation = defaults.getByLabel('Willing to relocate');
  const onsiteWork = defaults.getByLabel('Willing to work onsite');
  const raceEthnicity = defaults.getByLabel('Race or ethnicity');
  const referral = page.getByLabel('How you heard about the opportunity');
  const defaultInputs = [visa, gender, disability, veteran, hispanicLatino, privacy, relocation, onsiteWork, raceEthnicity, referral];
  const requestedDefaults = ['yes', 'male', 'no', 'no', 'no', 'yes', 'yes', 'yes', 'south_asian', 'linkedin'];
  const resume = page.getByLabel('Choose resume file');
  const importInput = page.locator('#profile-import');

  assert.equal(await preferredFirstName.inputValue(), '');
  assert.equal(await skills.inputValue(), '');
  await firstName.fill('Avery');
  assert.deepEqual(await Promise.all(defaultInputs.map(input => input.inputValue())), requestedDefaults);
  assert.equal(await page.evaluate(() => fixtureState.values['jobright.application-defaults.revision']), 6);
  await gender.selectOption('decline');
  await disability.selectOption('');
  await privacy.selectOption('no');
  await onsiteWork.selectOption('no');
  await raceEthnicity.selectOption('asian');
  await preferredFirstName.fill('Ash');
  await skills.fill(' Figma \n\nPrototyping');
  await page.getByRole('button', { name: 'Add employment' }).click();
  await page.getByRole('textbox', { name: 'Company' }).last().fill('Second Studio');
  await page.getByRole('button', { name: 'Add education' }).click();
  await page.getByRole('textbox', { name: 'School' }).fill('Example University');
  await page.getByRole('textbox', { name: 'Campus', exact: true }).fill('Main Campus');
  const degreeAlternatives = page.getByRole('textbox', { name: /^Accepted degree alternatives/ });
  const orderedDegreeAlternatives = ['Bachelor of Engineering', 'Bachelor of Science'];
  await degreeAlternatives.fill(' Bachelor of Engineering\n\nBachelor of Science');
  const studyAlternatives = page.getByRole('textbox', { name: /^Field of study alternatives/ });
  const orderedStudyAlternatives = ['UX Research', 'Product Design', 'Web Design', 'Other'];
  await studyAlternatives.fill(' UX Research\nProduct Design\n\nWeb Design\nOther');
  const currentlyStudying = page.getByLabel('Currently studying');
  assert.equal(await currentlyStudying.inputValue(), '');
  await currentlyStudying.selectOption('no');
  const authorizationCountries = workAuthorization.getByLabel('Country', { exact: true });
  const fullTime = workAuthorization.getByLabel('Authorized for full-time work');
  assert.equal(await authorizationCountries.first().inputValue(), 'United States');
  assert.equal(await fullTime.first().inputValue(), 'yes');
  await workAuthorization.getByRole('button', { name: 'Add country' }).click();
  await authorizationCountries.last().fill('Canada');
  const authorized = workAuthorization.getByLabel('Authorized to work').last();
  const sponsorship = workAuthorization.getByLabel('Requires sponsorship').last();
  assert.equal(await authorized.inputValue(), '');
  assert.equal(await fullTime.last().inputValue(), '');
  assert.equal(await sponsorship.inputValue(), '');
  await authorized.selectOption('yes');
  await fullTime.last().selectOption('no');
  await sponsorship.selectOption('no');
  await page.getByRole('button', { name: 'Add answer' }).click();
  await page.getByRole('textbox', { name: 'Question' }).fill('Years of design experience?');
  await page.getByRole('textbox', { name: 'Answer', exact: true }).fill('5');

  await resume.setInputFiles({ name: 'application.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.5\nLocal resume') });
  await page.getByText('Resume added. Save the profile to keep it.').waitFor();
  await resume.setInputFiles({ name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  await page.getByText('Choose a resume that is 2 MiB or smaller.').waitFor();
  assert(await page.getByText('application.pdf', { exact: true }).isVisible());
  await saveProfile.click();
  await page.getByText('Profile saved.', { exact: true }).waitFor();
  const saved = await page.evaluate(() => fixtureState.values['jobright.profile.v1']);
  assert.equal(saved.personal.firstName, 'Avery');
  assert.equal(saved.personal.preferredFirstName, 'Ash');
  assert.deepEqual(saved.workAuthorizations, [
    { country: 'United States', authorized: true, fullTimeAuthorized: true },
    { country: 'Canada', authorized: true, fullTimeAuthorized: false, sponsorshipRequired: false },
  ]);
  assert.deepEqual(saved.skills, ['Figma', 'Prototyping']);
  assert.deepEqual(saved.applicationDefaults, {
    visaSponsorship: 'yes', gender: 'decline', veteran: 'no', hispanicLatino: 'no', acceptApplicationPrivacy: false,
    relocation: 'yes', onsiteWork: 'no', raceEthnicity: 'asian', referralSource: 'linkedin',
  });
  assert.equal(saved.employment[1].company, 'Second Studio');
  assert.equal(saved.education[0].school, 'Example University');
  assert.equal(saved.education[0].campus, 'Main Campus');
  assert.deepEqual(saved.education[0].degreeAlternatives, orderedDegreeAlternatives);
  assert.deepEqual(saved.education[0].fieldOfStudyAlternatives, orderedStudyAlternatives);
  assert.equal(saved.education[0].current, false);
  assert.deepEqual(saved.answers, [{ question: 'Years of design experience?', answer: '5' }]);
  assert.equal(saved.resume.name, 'application.pdf');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON', exact: true }).click(),
  ]);
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.deepEqual(exported, saved);
  assert(!JSON.stringify(exported).includes('test-credential'));

  await importInput.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"invalid":') });
  await page.getByText('This file contains invalid JSON.', { exact: false }).waitFor();
  assert.equal(await firstName.inputValue(), 'Avery');

  await importInput.setInputFiles({
    name: 'import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, personal: { firstName: 'Robin' }, education: saved.education, apiKey: 'untrusted-key' })),
  });
  await page.getByText('Profile imported into the editor.', { exact: false }).waitFor();
  assert.equal(await firstName.inputValue(), 'Robin');
  assert.equal(await preferredFirstName.inputValue(), '');
  assert.equal(await skills.inputValue(), '');
  assert.equal(await studyAlternatives.inputValue(), orderedStudyAlternatives.join('\n'));
  assert.equal(await workAuthorization.getByLabel('Country', { exact: true }).count(), 0);
  assert.equal(await apiKey.inputValue(), 'test-credential');
  assert.equal(await page.evaluate(() => fixtureState.values['jobright.profile.v1'].personal.firstName), 'Avery');
  assert.deepEqual(await Promise.all(defaultInputs.map(input => input.inputValue())), defaultInputs.map(() => ''));
  for (const input of defaultInputs) await input.selectOption('');
  await studyAlternatives.fill('');
  await saveProfile.click();
  await page.getByText('Profile saved.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => fixtureState.values['jobright.profile.v1'].applicationDefaults), {});
  assert.deepEqual(await page.evaluate(() => fixtureState.values['jobright.profile.v1'].education[0].fieldOfStudyAlternatives), []);
  assert.equal(await page.evaluate(() => fixtureState.values['jobright.application-defaults.revision']), 6);

  assert.equal(await provider.inputValue(), 'openai');
  assert(await matchQuestions.isChecked());
  await provider.selectOption('anthropic');
  assert.equal(await apiKey.inputValue(), '');
  assert.equal(await model.inputValue(), 'claude-sonnet-5-5');
  await apiKey.fill('sk-ant-fixture-credential');
  const vault = page.getByRole('checkbox', { name: 'Use Obsidian notes during Autofill', exact: true });
  assert.equal(await vault.isChecked(), false);
  await vault.check();
  await page.getByRole('button', { name: 'Test Obsidian connection', exact: true }).click();
  await page.getByText('Connected to Synthetic career notes.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => fixtureState.aiRequests.length), 0, 'Connection test does not call AI');
  assert.deepEqual(await page.evaluate(() => fixtureState.nativeRequests.map(item => item.request)), [{ v: 1, op: 'ping' }]);
  await matchQuestions.uncheck();
  await page.getByRole('button', { name: 'Save AI settings' }).click();
  await page.getByText('AI settings saved.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => fixtureState.values['jobright.ai.v1']), {
    provider: 'anthropic', enabled: true, apiKey: 'sk-ant-fixture-credential', model: 'claude-sonnet-5-5', interpretQuestions: false, useVault: true,
  });
  await page.setViewportSize({ width: 400, height: 700 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Clear local data' }).click();
  await page.getByText('Local data cleared.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => fixtureState.values), {});
  assert.equal(await firstName.inputValue(), '');
  assert.equal(await apiKey.inputValue(), '');
  assert.equal(await aiEnabled.isChecked(), false);
  assert(await matchQuestions.isChecked());
  assert.equal(await vault.isChecked(), false);
}
