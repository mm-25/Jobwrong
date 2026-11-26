import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

const currentJob = 'I currently work here';
const completed = (controller: ReturnType<typeof createPageController>) =>
  vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 5000 });

function workdayEmployment(addUnmatchedRow = false) {
  const rows = [
    { company: 'Example Studio', title: 'Designer' },
    ...(addUnmatchedRow ? [{ company: 'Independent', title: 'Volunteer' }] : []),
  ];
  document.body.innerHTML = `<main data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Work-Experience-section"><h4 id="Work-Experience-section">Work Experience</h4>
      ${rows.map(({ company, title }, i) => `<div role="group" aria-labelledby="Work-Experience-${i + 1}-panel">
        <h5 id="Work-Experience-${i + 1}-panel">Work Experience ${i + 1}</h5>
        <label>Job Title<input id="workExperience-${20 + i}--jobTitle" value="${title}"></label>
        <label>Company<input id="workExperience-${20 + i}--companyName" value="${company}"></label>
        <label>${currentJob}<input type="checkbox" id="workExperience-${20 + i}--currentlyWorkHere"></label>
      </div>`).join('')}
    </div>
  </main>`;
  const profile = emptyProfile();
  profile.employment = [
    { company: 'Example Studio', title: 'Designer', location: '', startDate: '', endDate: '', current: false, description: '' },
  ];
  const engine = createEngine(document);
  return { profile, engine, controller: createPageController(document, engine, () => {}) };
}

test('an engine-confirmed false Workday checkbox does not remain in the review list', async () => {
  const { profile, engine, controller } = workdayEmployment();
  const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const ready = (await engine.scan(profile)).fields.find(field => field.kind === 'checkbox');
  expect(ready).toMatchObject({ label: currentJob, kind: 'checkbox', value: false, status: 'ready' });

  controller.start(profile);
  await completed(controller);

  expect(checkbox.checked).toBe(false);
  expect(controller.status()).toMatchObject({ filled: 1, failed: 0, remaining: [] });
});

test('an unanswered same-label Workday checkbox keeps its own field link', async () => {
  const { profile, engine, controller } = workdayEmployment(true);
  const checkboxes = (await engine.scan(profile)).fields.filter(field => field.kind === 'checkbox');
  expect(checkboxes).toMatchObject([
    { label: currentJob, value: false, status: 'ready' },
    { label: currentJob, status: 'unanswered' },
  ]);

  controller.start(profile);
  await completed(controller);

  expect(controller.status()).toMatchObject({
    filled: 1,
    remaining: [{ id: checkboxes[1].id, label: currentJob, status: 'unanswered' }],
  });
  expect(controller.focus?.(checkboxes[1].id)).toEqual({ focused: true });
  expect(document.activeElement?.id).toBe('workExperience-21--currentlyWorkHere');
});

test('a failed write remains reviewable by exact field ID when the site leaves another value', async () => {
  document.body.innerHTML = `<form>
    <label>First Name<input autocomplete="given-name" id="changed"></label>
  </form>`;
  const input = document.querySelector<HTMLInputElement>('#changed')!;
  input.addEventListener('input', () => {
    input.value = 'Site replacement value';
    input.form!.insertAdjacentHTML('beforeend', '<label>First Name<input autocomplete="given-name" id="preserved" value="Existing applicant value"></label>');
  }, { once: true });
  const profile = emptyProfile();
  profile.personal.firstName = 'Saved given name';
  const engine = createEngine(document);
  const controller = createPageController(document, engine, () => {});
  const [planned] = (await engine.scan(profile)).fields;
  expect(planned.status).toBe('ready');

  controller.start(profile);
  await completed(controller);

  expect(input.value).toBe('Site replacement value');
  expect(document.querySelector<HTMLInputElement>('#preserved')!.value).toBe('Existing applicant value');
  expect(controller.status()).toMatchObject({
    filled: 0, failed: 1,
    remaining: [{ id: planned.id, label: 'First Name', status: 'unsupported', reason: expect.stringMatching(/retain/i) }],
  });
  expect(controller.focus?.(planned.id)).toEqual({ focused: true });
  expect(document.activeElement).toBe(input);
});

test('shows an unverified referral write after the page replaces its original field', async () => {
  document.body.innerHTML = `<form>
    <label>First Name<input autocomplete="given-name"></label>
    <label>Middle Name<input autocomplete="additional-name"></label>
    <label for="referral">Referral source</label>
    <button type="button" id="referral" aria-haspopup="listbox" aria-controls="referral-options"
      aria-expanded="true" aria-required="true">Select one</button>
    <ul role="listbox" id="referral-options"><li role="option">LinkedIn</li></ul>
  </form>`;
  const referral = document.querySelector<HTMLButtonElement>('#referral')!;
  const list = document.querySelector<HTMLElement>('#referral-options')!;
  list.querySelector('[role="option"]')!.addEventListener('click', () => {
    const replacement = referral.cloneNode() as HTMLButtonElement;
    replacement.setAttribute('aria-expanded', 'false');
    replacement.textContent = 'LinkedIn';
    referral.replaceWith(replacement);
    list.hidden = true;
  });
  const profile = emptyProfile();
  profile.personal.firstName = 'Robin';
  profile.applicationDefaults = { referralSource: 'linkedin' };
  const engine = createEngine(document);
  const controller = createPageController(document, engine, () => {});
  controller.start(profile);
  await completed(controller);

  expect(referral.isConnected).toBe(false);
  expect(document.querySelector('#referral')?.textContent).toBe('LinkedIn');
  const result = controller.status();
  expect(result).toMatchObject({ filled: 1, failed: 1, undoAvailable: true, message: '1 filled · 2 need attention · 1 could not be filled' });
  expect(result.remaining.find(field => field.label === 'Middle Name')).toMatchObject({ status: 'unanswered' });
  const failure = result.remaining.find(field => field.label === 'Referral source');
  expect(failure).toMatchObject({ status: 'unsupported', required: true, reason: expect.stringMatching(/retain/i) });
  expect(failure).not.toHaveProperty('id');
  await controller.undo();
  expect(document.querySelector('#referral')?.textContent).toBe('LinkedIn');
});
