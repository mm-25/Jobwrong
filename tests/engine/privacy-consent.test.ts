import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const applicantNotice = 'Read the applicant privacy policy for details on how we collect, retain, process, and share your personal data when you apply for a role.';

function application() {
  document.body.innerHTML = `
    <form>
      <div class="field">
        <label id="applicant-notice">${applicantNotice}<span class="required">*</span></label>
        <div class="checkbox-group">
          <label><input id="privacy" name="privacy_accept" type="checkbox">I Accept</label>
        </div>
      </div>
      <div class="field">
        <label>I certify that this application is accurate.</label>
        <div class="checkbox-group">
          <label><input id="certify" name="certify" type="checkbox">I Accept</label>
        </div>
      </div>
      <div class="field">
        <label>Read the applicant privacy policy and agree to the Terms and Conditions.</label>
        <div class="checkbox-group">
          <label><input id="mixed" name="terms_accept" type="checkbox">I Accept</label>
        </div>
      </div>
      <div class="field">
        <label>I accept the applicant privacy policy and consent to recruitment SMS.</label>
        <div class="checkbox-group">
          <label><input id="sms" name="sms_accept" type="checkbox">I Accept</label>
        </div>
      </div>
      <label>Applicant signature<input id="signature" type="text"></label>
    </form>`;
  const engine = createEngine(document);
  const privacy = document.querySelector<HTMLInputElement>('#privacy')!;
  const notice = document.getElementById('applicant-notice')!;
  const checked = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((element) => element.id);
  return { engine, privacy, notice, checked };
}

function optedIn() {
  return { ...emptyProfile(), applicationDefaults: { acceptApplicationPrivacy: true } };
}

test('requires the dedicated opt-in even when an exact saved answer or review says Yes', async () => {
  const { engine, checked } = application();
  const profile = { ...emptyProfile(), answers: [{ question: 'I Accept', answer: 'Yes' }] };
  const initial = await engine.scan(profile);
  const reviewedAnswers = { [initial.fields[0].id]: 'Yes' };
  const scan = await engine.scan(profile, { reviewedAnswers });

  expect(scan.fields[0]).toMatchObject({ status: 'unsupported', aiEligible: false, sensitive: true });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, undoAvailable: false });
  expect(checked()).toEqual([]);
});

test('fills only applicant privacy when opted in and restores the original checkbox state', async () => {
  const { engine, checked } = application();
  const profile = optedIn();
  profile.answers = [
    { question: 'I Accept', answer: 'Yes' },
    { question: 'Applicant signature', answer: 'Lin Smith' },
  ];
  const scan = await engine.scan(profile);

  expect(scan.fields[0]).toMatchObject({ label: 'I Accept', status: 'ready', value: true, required: true, aiEligible: false, sensitive: true });
  expect(scan.fields.slice(1).map((field) => field.status)).toEqual(Array.from({ length: 4 }, () => 'unsupported'));
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  expect(checked()).toEqual(['privacy']);
  expect(document.querySelector<HTMLInputElement>('#signature')!.value).toBe('');

  expect(await engine.undo()).toMatchObject({ restored: 1, skipped: 0 });
  expect(checked()).toEqual([]);
});

test('skips fill after the applicant privacy notice changes following review', async () => {
  const { engine, privacy, notice } = application();
  document.getElementById('mixed')!.closest('.field')!.remove();
  const scan = await engine.scan(optedIn());
  notice.textContent = 'The applicant privacy notice permits our processing for related applications and other future recruitment.';

  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, skipped: 1, undoAvailable: false });
  expect(privacy.checked).toBe(false);
});

test('preserves the checkbox when the applicant privacy notice changes after fill', async () => {
  const { engine, privacy, notice } = application();
  document.getElementById('mixed')!.closest('.field')!.remove();
  const scan = await engine.scan(optedIn());
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });

  notice.textContent = 'The applicant privacy notice permits our processing for related applications and other future recruitment.';
  expect(await engine.undo()).toMatchObject({ restored: 0, skipped: 1 });
  expect(privacy.checked).toBe(true);
});
