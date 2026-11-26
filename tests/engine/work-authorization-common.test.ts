// @vitest-environment-options {"url":"https://jobs.lever.co/example/apply"}
import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const profile = { ...emptyProfile(), workAuthorizations: [
  { country: 'United States', authorized: true, fullTimeAuthorized: true },
  { country: 'Canada', authorized: false, fullTimeAuthorized: false },
] };
const radio = (label: string) => `<fieldset><legend>${label}</legend><label><input type="radio" name="authorization" value="yes">Yes</label><label><input type="radio" name="authorization" value="no">No</label></fieldset>`;
const posting = () => `<div class="posting-header"><div class="posting-categories"><div class="location">Washington, D.C.</div></div></div>`;

test('fills the explicit full-time authorization fact on the Perpay wording', async () => {
  document.body.innerHTML = `<form>${radio('Are you legally authorized to work in the U.S. on a full-time basis?')}</form>`;
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector<HTMLInputElement>('input[value="yes"]')?.checked).toBe(true);
});

test('does not reuse general authorization for a missing full-time fact', async () => {
  document.body.innerHTML = `<form>${radio('Are you legally authorized to work in the U.S. on a full-time basis?')}</form>`;
  const p = { ...profile, workAuthorizations: [{ country: 'United States', authorized: true }] };
  expect((await createEngine(document).scan(p)).fields[0]).toMatchObject({ status: 'unanswered', aiEligible: false });
});

test('grounds the application country in the Lever posting location', async () => {
  document.body.innerHTML = `${posting()}<form id="application-form">${radio('Are you legally authorized to work in the country for which you are applying?')}</form>`;
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
});

test('rejects a previously planned answer when the job country changes on the same page', async () => {
  document.body.innerHTML = `${posting()}<form id="application-form">${radio('Are you legally authorized to work in the country for which you are applying?')}</form>`;
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
  document.querySelector('.location')!.textContent = 'Toronto, Canada';
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, needsRescan: true });
  expect(document.querySelector('input:checked')).toBeNull();
});

test.each([
  ['New York, NY', 'Yes'],
  ['Austin, TX', 'Yes'],
  ['Seattle, WA', 'Yes'],
  ['Toronto, ON', 'No'],
  ['Montreal, QC', 'No'],
])('grounds authorization in an unambiguous posting region: %s', async (location, answer) => {
  document.body.innerHTML = `${posting()}<form id="application-form">${radio('Are you legally authorized to work in the country for which you are applying?')}</form>`;
  document.querySelector('.location')!.textContent = location;
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: answer });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector<HTMLInputElement>('input:checked')?.value).toBe(answer.toLowerCase());
});

test.each(['Toronto, CA', 'Berlin, DE', 'Boston, MA', 'London', 'New York, ny', 'Canada, NY', 'New York and Toronto, NY'])
('does not infer a country from ambiguous or malformed region evidence: %s', async location => {
  document.body.innerHTML = `${posting()}<form id="application-form">${radio('Are you legally authorized to work in the country for which you are applying?')}</form>`;
  document.querySelector('.location')!.textContent = location;
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'unanswered', aiEligible: false });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(document.querySelector('input:checked')).toBeNull();
});
