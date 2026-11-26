// @vitest-environment-options {"url":"https://job-boards.greenhouse.io/example/jobs/123456"}
import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const question = 'Are you authorized to work in the country for which you applied?';
const profile = {
  ...emptyProfile(),
  personal: { ...emptyProfile().personal, country: 'United States' },
  workAuthorizations: [
    { country: 'United States', authorized: true, fullTimeAuthorized: true },
    { country: 'Canada', authorized: false },
  ],
};
const locations = 'San Francisco, CA • New York, NY • United States';

function posting(location: string, native = false): void {
  document.body.innerHTML = `<main class="job-post">
    <div class="job-post-container">
      <div><div class="job__header"><div class="job__title">
        <h1>Product Designer, CMS</h1>
        <div class="job__location"><svg aria-hidden="true"></svg><div>${location}</div></div>
      </div></div></div>
      <p>Our headquarters is in the United States.</p>
      <div class="application--container"><form id="application-form" class="application--form">
        <label for="question_123">${question}</label>
        ${native ? '<select id="question_123"><option value="">Select...</option><option>Yes</option><option>No</option></select>' :
          '<div class="select-shell"><div class="select__control"><div class="select__value-container"><div class="select__placeholder">Select...</div><input id="question_123" class="select__input" role="combobox" aria-expanded="false" aria-haspopup="true"></div></div></div>'}
      </form></div>
    </div></main>`;
}

test('plans an answer for the closed Greenhouse authorization combobox using the posting country', async () => {
  posting(locations);
  const scan = await createEngine(document).scan(profile);
  expect(scan.fields).toEqual([expect.objectContaining({ label: question, status: 'ready', value: 'Yes' })]);
  expect(document.querySelector('[role="combobox"]')?.getAttribute('aria-expanded')).toBe('false');
});

test.each([
  'San Francisco, CA • Toronto, ON • United States',
  'San Francisco, CA • Toronto, Canada • United States',
  'San Francisco, CA • London • United States',
  'San Francisco, CA • New York, NY',
  'London<span hidden>, United States</span>',
  '',
])('keeps mixed or unclear posting locations (%s) unanswered despite profile and employer countries', async location => {
  posting(location);
  const scan = await createEngine(document).scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'unanswered', aiEligible: false });
});

test('uses the explicit posting country even when the applicant and employer are elsewhere', async () => {
  posting('Toronto, ON • Canada', true);
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'No' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector<HTMLSelectElement>('select')?.value).toBe('No');
});

test('rejects a stale review when the job country changes', async () => {
  posting(locations, true);
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
  document.querySelector('.job__location')!.textContent = 'Toronto, Canada';
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, needsRescan: true });
  expect(document.querySelector<HTMLSelectElement>('select')?.value).toBe('');
});

test('preserves an authorization choice made after review', async () => {
  posting(locations, true);
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
  const select = document.querySelector<HTMLSelectElement>('select')!;
  select.value = 'No';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(select.value).toBe('No');
});
