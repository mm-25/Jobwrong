import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import { normalizeQuestion } from '../../src/engine/discovery';

afterEach(() => document.body.replaceChildren());

function profile() {
  return { ...emptyProfile(), applicationDefaults: { gender: 'male' as const, referralSource: 'linkedin' as const, veteran: 'no' as const },
    workAuthorizations: [{ country: 'United States', authorized: true }] };
}

test.each(['0', '-1', 'placeholder'])('a Please Select option with nonempty value %s is still blank', async value => {
  document.body.innerHTML = `<label id="gender" for="gender">Gender</label><select id="gender" aria-labelledby="gender">
    <option value="${value}">Please Select</option><option value="1">Female</option><option value="2">Male</option></select>`;
  const engine = createEngine(document), plan = await engine.scan(profile());
  expect(plan.fields[0]).toMatchObject({ label: 'Gender', status: 'ready', value: 'Male' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(document.querySelector('select')!.value).toBe('2');
  expect(await engine.undo(plan.scanId)).toMatchObject({ restored: 1, skipped: 0 });
  expect(document.querySelector('select')!.value).toBe(value);
});

test('preserves a real answer whose option value happens to be zero', async () => {
  document.body.innerHTML = '<label>Gender<select><option value="0">Female</option><option value="1">Male</option></select></label>';
  const engine = createEngine(document), plan = await engine.scan(profile());
  expect(plan.fields[0].status).not.toBe('ready');
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 0 });
  expect(document.querySelector('select')!.value).toBe('0');
});

test('a numbered referral question matches the saved source', async () => {
  document.body.innerHTML = `<div role="radiogroup" aria-label="1. How did you hear about us?">
    <label><input type="radio" name="source" value="38">Indeed</label>
    <label><input type="radio" name="source" value="39">LinkedIn</label></div>`;
  const engine = createEngine(document), plan = await engine.scan(profile());
  expect(plan.fields[0]).toMatchObject({ status: 'ready', value: 'LinkedIn' });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(document.querySelector<HTMLInputElement>('input[value="39"]')!.checked).toBe(true);
});

test.each(['6. Are you lawfully entitled to be employed in the United States?', 'Are you lawfully authorized to work in the United States?'])(
  'uses an explicit authorization fact for %s', async question => {
    document.body.innerHTML = `<div role="radiogroup" aria-label="${question}">
      <label><input type="radio" name="authorization" value="1-True">Yes</label>
      <label><input type="radio" name="authorization" value="1-False">No</label></div>`;
    const engine = createEngine(document), plan = await engine.scan(profile());
    expect(plan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
    expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1, failed: 0 });
    expect(document.querySelector<HTMLInputElement>('input[value="1-True"]')!.checked).toBe(true);
  },
);

test('numbered exact answers normalize without removing a decimal or a year', async () => {
  expect(normalizeQuestion('2.  Favorite design tool?')).toBe(normalizeQuestion('Favorite design tool?'));
  expect(normalizeQuestion('1.5 years experience?')).toBe('1.5 years experience');
  expect(normalizeQuestion('2026. Graduation year?')).toBe('2026. graduation year');
  document.body.innerHTML = '<label>2. Favorite design tool?<input></label>';
  const engine = createEngine(document), p = profile();
  p.answers = [{ question: '1. Favorite design tool?', answer: 'Figma' }];
  const plan = await engine.scan(p);
  expect(plan.fields[0]).toMatchObject({ status: 'ready', value: 'Figma' });
});

test.each(['2. Are you 18 years of age or older?', '5. Have you ever been convicted of a felony?', '7. I acknowledge that these answers are accurate'])(
  'numbering does not grant a missing fact or consent: %s', async label => {
    document.body.innerHTML = `<label>${label}<select><option value="0">Please Select</option><option>Yes</option><option>No</option></select></label>`;
    const plan = await createEngine(document).scan(profile());
    expect(plan.fields[0].status).not.toBe('ready');
  },
);
