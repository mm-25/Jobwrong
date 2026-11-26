import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const profile = { ...emptyProfile(), applicationDefaults: { acceptApplicationPrivacy: true } };
function form(notice = 'By clicking I Accept you confirm that you have read the Applicant & Candidate Privacy Notice for recruitment data processing.') {
  document.body.innerHTML = `<form><div class="field"><div class="legal">${notice}</div><div class="control"><div class="checkbox-group"><label class="checkbox"><input type="checkbox">I Accept</label></div></div></div></form>`;
  return createEngine(document);
}

test('uses the actual C3 legal-block structure for applicant privacy and undo', async () => {
  const engine = form();
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ label: 'I Accept', status: 'ready', value: true });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector('input')!.checked).toBe(true);
  expect(await engine.undo()).toMatchObject({ restored: 1 });
  expect(document.querySelector('input')!.checked).toBe(false);
});

test('does not reuse privacy context for an adjacent unrelated or mixed-contract checkbox', async () => {
  const engine = form('I accept applicant privacy processing and the Terms and Conditions.');
  document.querySelector('form')!.insertAdjacentHTML('beforeend', '<div class="field"><div class="control"><label><input type="checkbox">I Accept</label></div></div>');
  const scan = await engine.scan(profile);
  expect(scan.fields.map(field => field.status)).toEqual(['unsupported', 'unsupported']);
});

test('a changed legal block prevents a stale acceptance', async () => {
  const engine = form();
  const scan = await engine.scan(profile);
  document.querySelector('.legal')!.textContent += ' and Terms of Service';
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(document.querySelector('input')!.checked).toBe(false);
});

test('does not treat refusal or a descriptive notice as an acceptance label', async () => {
  const engine = form();
  const label = document.querySelector('label')!;
  label.lastChild!.textContent = 'I do not accept';
  expect((await engine.scan(profile)).fields[0].status).toBe('unsupported');
  label.lastChild!.textContent = 'Applicant privacy notice';
  expect((await engine.scan(profile)).fields[0].status).toBe('unsupported');
});

test.each([
  'electronically sign this application',
  'attest that the information I provided is true',
  'complete the applicant certification',
  'waive my right to a jury trial',
])('keeps privacy acceptance manual when it also asks to %s', async commitment => {
  const engine = form(`By clicking I Accept, you consent to applicant privacy processing and ${commitment}.`);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'unsupported', sensitive: true });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(document.querySelector('input')!.checked).toBe(false);
});
