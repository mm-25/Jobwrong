import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile, parseProfile } from '../../src/shared/profile';

const profile = () => parseProfile({ ...emptyProfile(), applicationDefaults: { referralSource: 'linkedin' } });

test.each([
  'How did you hear about us?',
  'How did you hear about this opportunity?',
  'Please tell us how you heard about this opportunity.',
  'Where did you learn about this position?',
  'Referral source',
])('fills the configured source for %s', async label => {
  document.body.innerHTML = `<form><label>${label}<select><option value="">Choose</option><option>Indeed</option><option>LinkedIn</option></select></label></form>`;
  const engine = createEngine(document);
  const scan = await engine.scan(profile());
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'LinkedIn' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector('select')?.value).toBe('LinkedIn');
});

test('uses the same explicit source for text and native radio inputs', async () => {
  document.body.innerHTML = `<form><label>How did you hear about us?<input></label>
    <fieldset><legend>How did you find this job?</legend><label><input type="radio" name="source" value="li">LinkedIn</label>
    <label><input type="radio" name="source" value="web">Company website</label></fieldset></form>`;
  const engine = createEngine(document);
  const scan = await engine.scan(profile());
  expect(scan.fields.map(f => f.value)).toEqual(['LinkedIn', 'LinkedIn']);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 2 });
  expect(document.querySelector<HTMLInputElement>('input[value="li"]')?.checked).toBe(true);
});

test('does not turn an employee referral or a recruiting message into a generic LinkedIn source', async () => {
  document.body.innerHTML = `<form><label>Who referred you?<input></label><label>Name of the employee who referred you<input></label>
    <label>How did you hear about us?<select><option value="">Choose</option><option>LinkedIn Recruiter</option><option>Employee referral via LinkedIn</option></select></label></form>`;
  const engine = createEngine(document);
  expect((await engine.scan(profile())).fields.every(f => f.status === 'unanswered')).toBe(true);
});

test('preserves existing and exact saved answers ahead of the general source preference', async () => {
  document.body.innerHTML = `<form><label>How did you hear about us?<input value="Indeed"></label>
    <label>Where did you hear about this opportunity?<input></label></form>`;
  const p = profile();
  p.answers.push({ question: 'Where did you hear about this opportunity?', answer: 'Company website' });
  const fields = (await createEngine(document).scan(p)).fields;
  expect(fields[0]).toMatchObject({ status: 'preserved', currentValue: 'Indeed' });
  expect(fields[1]).toMatchObject({ status: 'ready', value: 'Company website' });
});
