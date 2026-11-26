import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const question = 'Do you now or in the future require any immigration filing or visa sponsorship to maintain work authorization, including sponsorship by Example Corp, renewal/extension of open work permit, permanent residency, etc.?';
const profile = { ...emptyProfile(), applicationDefaults: { visaSponsorship: 'yes' as const } };
function form(label: string) {
  document.body.innerHTML = `<form><label>${label}<select><option value="">Select One</option><option>Yes</option><option>No</option></select></label></form>`;
  return createEngine(document);
}
afterEach(() => document.body.replaceChildren());

test.each([
  question,
  'Will you require immigration filings or employer sponsorship?',
  'Do you need visa sponsorship or immigration filing to maintain your work authorization?',
])('an affirmative sponsorship fact proves this OR question: %s', async label => {
  const engine = form(label), plan = await engine.scan(profile);
  expect(plan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(document.querySelector('select')!.value).toBe('Yes');
});

test.each([{ visaSponsorship: 'no' as const }, {}, undefined])('does not assume the other immigration fact from defaults %j', async defaults => {
  const plan = await form(question).scan({ ...profile, applicationDefaults: defaults });
  expect(plan.fields[0].status).not.toBe('ready');
});

test.each([
  'Do you require immigration filing and visa sponsorship?',
  'Do you not require immigration filing or visa sponsorship?',
  'Do you require immigration filing or visa sponsorship without employer support?',
  'Do you require immigration filing or visa sponsorship and hold citizenship?',
  'Do you require immigration filing or visa sponsorship, including citizenship or security clearance?',
  'Do you require immigration filing or visa sponsorship in Canada?',
  'Does your spouse require immigration filing or visa sponsorship?',
])('does not broaden the OR inference to another claim: %s', async label => {
  expect((await form(label).scan(profile)).fields[0].status).not.toBe('ready');
});

test('an exact saved answer takes precedence over the positive-only inference', async () => {
  const plan = await form(question).scan({ ...profile, answers: [{ question, answer: 'No' }] });
  expect(plan.fields[0]).toMatchObject({ status: 'ready', value: 'No' });
});
