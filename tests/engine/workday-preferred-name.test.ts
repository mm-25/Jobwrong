import { afterEach, expect, test, vi } from 'vitest';
import { createEngine } from '../../src/engine';
import { createPageController } from '../../src/page-controller';
import { emptyProfile } from '../../src/shared/profile';
import type { PersonalDetails } from '../../src/shared/types';

afterEach(() => document.body.replaceChildren());

const profile = emptyProfile();
Object.assign(profile.personal, { firstName: 'Jordan', middleName: 'Quinn', lastName: 'Lee' });

function workdayNamePage(preferredOpen = false) {
  const input = (group: string, part: string, label: string) => {
    const name = group + '--' + part;
    return `<div data-automation-id="formField-${name}">
      <label for="name--${name}">${label}<span aria-hidden="true">*</span></label>
      <input id="name--${name}" name="${name}" type="text">
    </div>`;
  };
  document.body.innerHTML = `<main data-automation-id="applyFlowPage">
    <div data-automation-id="legalNameSection">
      ${input('legalName', 'firstName', 'First Name')}
      ${input('legalName', 'lastName', 'Last Name')}
      <div><input id="name--preferredCheck" type="checkbox"${preferredOpen ? ' checked' : ''}>
        <label for="name--preferredCheck">I have a preferred name</label></div>
      <div id="preferred-name-controls"${preferredOpen ? '' : ' hidden'}>
        ${input('preferredName', 'firstName', 'First Name')}
        ${input('preferredName', 'lastName', 'Last Name')}
      </div>
    </div>
  </main>`;
  const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const preferred = document.querySelector<HTMLElement>('#preferred-name-controls')!;
  checkbox.addEventListener('change', () => { preferred.hidden = !checkbox.checked; });
  const values = (group: string) => [...document.querySelectorAll<HTMLInputElement>(`input[name^="${group}--"]`)]
    .map(control => control.value);
  return { checkbox, preferred, values };
}

test('legal names alone do not turn on the Workday preferred-name checkbox', async () => {
  const { checkbox, preferred, values } = workdayNamePage();
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields.find(field => field.label === 'I have a preferred name')).toMatchObject({ status: 'unanswered' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 2 });
  expect(values('legalName')).toEqual(['Jordan', 'Lee']);
  expect(checkbox.checked).toBe(false);
  expect(preferred.hidden).toBe(true);
});

test('does not fill legal names into already revealed Workday preferred name fields', async () => {
  const { checkbox, values } = workdayNamePage(true);
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  expect(scan.fields.filter(field => field.label.startsWith('Preferred '))).toEqual([
    expect.objectContaining({ label: 'Preferred First Name', status: 'unanswered', required: true }),
    expect.objectContaining({ label: 'Preferred Last Name', status: 'unanswered', required: true }),
  ]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 2 });
  expect(checkbox.checked).toBe(true);
  expect(values('legalName')).toEqual(['Jordan', 'Lee']);
  expect(values('preferredName')).toEqual(['', '']);
});

test.each([
  [{ preferredFirstName: 'Casey', preferredLastName: 'Lane' }, ['Casey', 'Lane']],
  [{ preferredFirstName: 'Casey' }, ['Casey', '']],
] as const)('Autofill reveals the Workday section and uses only the saved preferred parts (%j)', async (preferredNames, expected) => {
  const { checkbox, preferred, values } = workdayNamePage();
  const candidate = { ...profile, personal: { ...profile.personal, ...preferredNames } };
  const controller = createPageController(document, createEngine(document), () => {});
  expect(controller.start(candidate)).toBe(true);
  await vi.waitFor(() => expect(controller.status().running).toBe(false), { timeout: 2500 });
  expect(checkbox.checked).toBe(true);
  expect(preferred.hidden).toBe(false);
  expect(values('legalName')).toEqual(['Jordan', 'Lee']);
  expect(values('preferredName')).toEqual(expected);
});

test('does not infer a legal name for a verified Workday preferred input with conflicting visible wording', async () => {
  workdayNamePage(true);
  document.querySelector('label[for="name--preferredName--firstName"]')!.textContent = 'Last Name';
  const engine = createEngine(document);
  const candidate = { ...profile, personal: { ...profile.personal, preferredFirstName: 'Casey' } };
  const scan = await engine.scan(candidate);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 2 });
  expect(document.querySelector<HTMLInputElement>('#name--preferredName--firstName')?.value).toBe('');
});

test.each([
  ['a provisional ID', (input: HTMLInputElement, label: HTMLLabelElement) => {
    input.id = 'provisional-preferred-name';
    label.htmlFor = input.id;
  }],
  ['only a placeholder', (input: HTMLInputElement, label: HTMLLabelElement) => {
    label.remove();
    input.placeholder = 'First Name';
  }],
  ['ARIA masking a conflicting visible caption', (input: HTMLInputElement, label: HTMLLabelElement) => {
    label.textContent = 'Last Name';
    input.setAttribute('aria-label', 'First Name');
  }],
  ['a contradictory aria-label behind aria-labelledby', (input: HTMLInputElement, label: HTMLLabelElement) => {
    label.id = 'workday-first-name-caption';
    input.setAttribute('aria-labelledby', label.id);
    input.setAttribute('aria-label', 'Last Name');
  }],
] as const)('keeps a Workday preferred field manual with %s', async (_description, change) => {
  workdayNamePage(true);
  const input = document.querySelector<HTMLInputElement>('#name--preferredName--firstName')!;
  change(input, input.labels![0]);
  const engine = createEngine(document);
  const candidate = { ...profile, personal: { ...profile.personal, preferredFirstName: 'Casey' } };
  const scan = await engine.scan(candidate);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 2 });
  expect(input.value).toBe('');
});

test.each([
  'Preferred First Name',
  'Please enter your preferred first name',
  'Preferred Last Name',
])('neither autocomplete nor semantic matching substitutes a legal name for %s', async label => {
  const part: keyof PersonalDetails = label.toLowerCase().includes('last') ? 'lastName' : 'firstName';
  const autocomplete = part === 'lastName' ? 'family-name' : 'given-name';
  document.body.innerHTML = `<label>${label}<input autocomplete="${autocomplete}"></label>`;
  const engine = createEngine(document);
  const scan = await engine.scan(profile);
  const field = scan.fields[0];
  expect(field).toMatchObject({ status: 'unanswered', aiEligible: false });
  expect(field.interpretationEligible).not.toBe(true);
  const interpretation = await engine.interpret(scan.scanId, profile, [{
    fieldId: field.id, fact: part, country: null, inverse: false, confidence: 'high',
    evidence: part === 'lastName' ? 'Last Name' : 'First Name',
  }]);
  expect(interpretation?.fields[0].value).toBeUndefined();
});
