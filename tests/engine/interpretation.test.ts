import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import type { QuestionMeaning } from '../../src/shared/interpretation';
import { emptyProfile } from '../../src/shared/profile';
import type { Profile, ScanResult } from '../../src/shared/types';

const profile: Profile = {
  ...emptyProfile(),
  personal: { ...emptyProfile().personal, email: 'applicant@example.test' },
  applicationDefaults: {
    visaSponsorship: 'yes', gender: 'male', disability: 'no', veteran: 'yes',
    relocation: 'no', onsiteWork: 'yes', raceEthnicity: 'south_asian',
  },
  workAuthorizations: [
    { country: 'CA', authorized: true, sponsorshipRequired: false },
    { country: 'US', sponsorshipRequired: false },
    { country: 'United States', sponsorshipRequired: true },
  ],
};

const visa = 'Is employer visa sponsorship something you will need for this role in Canada?';
const authorization = 'Could you take up employment in Canada without additional permission?';
const relocation = 'Is moving for this position off the table?';
const gender = 'Which gender category best reflects how you identify?';
const email = 'Where should we send email updates about your candidacy?';

function form(html: string) {
  document.body.innerHTML = '<form>' + html + '</form>';
  return createEngine(document);
}

function meaning(scan: ScanResult, index: number, fact: QuestionMeaning['fact'], options: Partial<QuestionMeaning> = {}): QuestionMeaning {
  const field = scan.fields[index];
  return {
    fieldId: field.id, fact, inverse: false, country: null, confidence: 'high', evidence: field.label, ...options,
  };
}

test('grounds unfamiliar native controls with the local snapshot and the stated country', async () => {
  const engine = form(`
    <label>${visa}<select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
    <fieldset><legend>${authorization.replace('take up employment', 'lawfully work')}</legend>
      <label>Yes<input type="radio" name="auth" value="true"></label>
      <label>No<input type="radio" name="auth" value="false"></label>
    </fieldset>
    <label><input type="checkbox">${relocation}</label>
    <label>${email}<input type="email"></label>
  `);
  const scan = await engine.scan(profile);
  expect(scan.fields.map(field => [field.label, field.status, !!field.interpretationEligible])).toEqual([
    [visa, 'unanswered', true], [authorization.replace('take up employment', 'lawfully work'), 'unanswered', true], [relocation, 'unanswered', true], [email, 'unanswered', true],
  ]);
  const plan = await engine.interpret(scan.scanId, profile, [
    meaning(scan, 0, 'visaSponsorship', { country: 'Canada', evidence: 'employer visa sponsorship' }),
    meaning(scan, 1, 'workAuthorization', { country: 'Canada', evidence: 'lawfully work in Canada' }),
    meaning(scan, 2, 'relocation', { inverse: true, evidence: 'moving for this position off the table' }),
    meaning(scan, 3, 'email', { evidence: 'email updates' }),
  ]);
  expect(plan?.fields.map(field => [field.value, field.answerSource])).toEqual([
    ['No', 'interpreted'], ['Yes', 'interpreted'], [true, 'interpreted'], ['applicant@example.test', 'interpreted'],
  ]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 4 });
  expect(document.querySelector('select')?.value).toBe('No');
  expect(document.querySelector<HTMLInputElement>('input[type="radio"]')?.checked).toBe(true);
  expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
  expect(document.querySelector<HTMLInputElement>('input[type="email"]')?.value).toBe('applicant@example.test');
});

test('keeps exact local answers, conflicting saved answers, and known local semantics ahead of interpretation', async () => {
  const engine = form(`
    <label>${gender}<input></label>
    <label>${email}<input></label>
    <label>Gender <select><option value="">Choose</option><option>Man</option><option>Male</option></select></label>
    <label>Are you a protected veteran?<input></label>
  `);
  const saved: Profile = {
    ...profile,
    answers: [
      { question: gender, answer: 'Prefer not to answer' },
      { question: email, answer: 'first@example.test' },
      { question: email, answer: 'second@example.test' },
    ],
  };
  const scan = await engine.scan(saved);
  const plan = await engine.interpret(scan.scanId, saved, [
    meaning(scan, 0, 'gender'), meaning(scan, 1, 'email'), meaning(scan, 2, 'gender'), meaning(scan, 3, 'veteran'),
  ]);
  expect(plan?.fields.map(field => [field.status, field.value, !!field.interpretationEligible])).toEqual([
    ['ready', 'Prefer not to answer', false], ['unanswered', undefined, false],
    ['unanswered', undefined, false], ['unanswered', undefined, false],
  ]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
});

test.each([
  [visa.replace('Canada', 'United States'), 'visaSponsorship', 'United States', false, undefined],
  [visa.replace('Canada', 'Wakanda'), 'visaSponsorship', 'Wakanda', false, undefined],
  [visa, 'visaSponsorship', null, false, undefined],
  [visa, 'visaSponsorship', 'United States', false, undefined],
  [authorization.replace('Canada', 'United States'), 'workAuthorization', 'United States', false, undefined],
  [authorization.replace('Canada', 'this location'), 'workAuthorization', null, false, undefined],
  [authorization.replace('Canada', 'Canada or Mexico'), 'workAuthorization', 'Canada', false, undefined],
  [authorization.replace('Canada', 'Mexico'), 'workAuthorization', 'Mexico', false, undefined],
  [relocation, 'relocation', null, false, undefined],
  [gender, 'gender', null, true, undefined],
  [email, 'email', null, false, 'unbacked evidence'],
  [visa, 'workAuthorization', 'Canada', false, undefined],
  [authorization.replace('additional permission', 'employer visa sponsorship'), 'workAuthorization', 'Canada', false, undefined],
] satisfies [string, QuestionMeaning['fact'], string | null, boolean, string | undefined][])('leaves unsupported or ungrounded meaning unresolved for %s', async (label, fact, country, inverse, evidence) => {
  const engine = form(`<label>${label}<input></label>`);
  const scan = await engine.scan(profile);
  const plan = await engine.interpret(scan.scanId, profile, [
    meaning(scan, 0, fact, { country, inverse, ...(evidence && { evidence }) }),
  ]);
  expect(plan?.fields[0]).toMatchObject({ status: 'unanswered' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
});

test('does not offer protected, compound, irrelevant, or third-party application fields for interpretation', async () => {
  const engine = form(`
    <label>Sex assigned at birth, for gender reporting<input></label>
    <label>Sex<input></label>
    <label>Which gender label describes your transgender status?<input></label>
    <label>Which ethnicity applies to your East Asian heritage?<input></label>
    <label>Which protected veteran classification applies to you?<input></label>
    <label>Can you relocate and start next Monday?<input></label>
    <label>Will you relocate at your own expense?<input></label>
    <label>Is office work acceptable under this employment contract?<input></label>
    <label>Email address of the person who referred you<input></label>
    <fieldset><legend>Emergency Contact</legend><label>${email}<input></label></fieldset>
    <label>Can you relocate and agree to our terms of service?<input></label>
    <label>Do you have any relocation or availability restrictions you would like to explain?<textarea></textarea></label>
    <label>Why are you interested in this role?<textarea></textarea></label>
    <fieldset><legend>Employment history</legend><label>Which company currently employs you?<input name="employment[0].company"></label></fieldset>
    <label>${gender}<input type="file"></label>
  `);
  const scan = await engine.scan(profile);
  expect(scan.fields).toHaveLength(15);
  expect(scan.fields.filter(field => field.interpretationEligible)).toEqual([]);
  const plan = await engine.interpret(scan.scanId, profile, [
    meaning(scan, 0, 'gender'), meaning(scan, 1, 'gender'), meaning(scan, 2, 'raceEthnicity'),
    meaning(scan, 3, 'veteran'), meaning(scan, 4, 'relocation'), meaning(scan, 5, 'relocation'),
    meaning(scan, 6, 'onsiteWork'), meaning(scan, 7, 'email'), meaning(scan, 8, 'email'),
    meaning(scan, 9, 'relocation'), meaning(scan, 10, 'relocation'), meaning(scan, 14, 'gender'),
  ]);
  expect(plan?.fields.every(field => field.answerSource === undefined)).toBe(true);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
});

test('does not infer missing profile values or accept duplicate classifications', async () => {
  const engine = form(`<label>${gender}<input></label><label>${email}<input></label>`);
  const incomplete = { ...profile, applicationDefaults: {} };
  const scan = await engine.scan(incomplete);
  const duplicate = meaning(scan, 1, 'email');
  const plan = await engine.interpret(scan.scanId, incomplete, [meaning(scan, 0, 'gender'), duplicate, duplicate]);
  expect(plan?.fields.map(field => field.status)).toEqual(['unanswered', 'unanswered']);
});

test('keeps the original checkpoint across replacement controls, away-and-back edits, and fill-time edits', async () => {
  const engine = form(`
    <label>${visa}<input id="replace"></label>
    <label>${email}<input id="edited"></label>
    <label>${gender}<input id="late"></label>
  `);
  const scan = await engine.scan(profile);
  const replace = document.querySelector('#replace')!;
  replace.replaceWith(replace.cloneNode());
  const edited = document.querySelector<HTMLInputElement>('#edited')!;
  for (const value of ['manual', '']) {
    edited.value = value;
    edited.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const plan = await engine.interpret(scan.scanId, profile, [
    meaning(scan, 0, 'visaSponsorship', { country: 'Canada' }), meaning(scan, 1, 'email'), meaning(scan, 2, 'gender'),
  ]);
  expect(plan?.fields.map(field => field.status)).toEqual(['unanswered', 'unanswered', 'ready']);
  const late = document.querySelector<HTMLInputElement>('#late')!;
  late.value = 'Manual response';
  late.dispatchEvent(new Event('input', { bubbles: true }));
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, skipped: 1 });
  expect(late.value).toBe('Manual response');
});

test('groups interpreted changes with an earlier local fill for one undo', async () => {
  const engine = form(`<label>Email <input type="email"></label><label>${gender}<input></label>`);
  const local = await engine.scan(profile);
  expect(await engine.fill(local.scanId)).toMatchObject({ filled: 1, undoAvailable: true });
  const followUp = await engine.scan(profile);
  const plan = await engine.interpret(followUp.scanId, profile, [meaning(followUp, 1, 'gender')]);
  expect(plan?.fields[1]).toMatchObject({ value: 'Male', status: 'ready', answerSource: 'interpreted' });
  expect(await engine.fill(followUp.scanId, [followUp.fields[1].id], local.scanId)).toMatchObject({ filled: 1, undoAvailable: true });
  expect(await engine.undo(followUp.scanId)).toEqual({ restored: 2, skipped: 0 });
  expect([...document.querySelectorAll('input')].map(field => field.value)).toEqual(['', '']);
});

test.each([
  ['listbox', 'option'],
  ['tree', 'treeitem'],
])('uses semantic rankings after opening an interpreted lazy %s menu', async (popup, role) => {
  const engine = form(`
    <label for="ethnicity">Which ethnicity category best reflects how you identify?</label>
    <button type="button" id="ethnicity" aria-haspopup="${popup}" aria-controls="choices" aria-expanded="false">Select one</button>
  `);
  const trigger = document.querySelector<HTMLButtonElement>('button')!;
  trigger.addEventListener('click', () => {
    trigger.setAttribute('aria-expanded', 'true');
    const menu = document.createElement('div');
    menu.id = 'choices';
    menu.setAttribute('role', popup);
    for (const label of ['Asian', 'South Asian', 'East Asian']) {
      const item = document.createElement('div');
      item.setAttribute('role', role);
      item.textContent = label;
      item.addEventListener('click', () => {
        trigger.textContent = label;
        trigger.setAttribute('aria-expanded', 'false');
        menu.remove();
      });
      menu.append(item);
    }
    trigger.after(menu);
  });
  const scan = await engine.scan(profile);
  const plan = await engine.interpret(scan.scanId, profile, [meaning(scan, 0, 'raceEthnicity')]);
  expect(plan?.fields[0]).toMatchObject({ status: 'ready', answerSource: 'interpreted' });
  expect(document.querySelector('#choices')).toBeNull();
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0 });
  expect(trigger.textContent).toBe('South Asian');
});

test('locally handles simple office availability paraphrases without a model request', async () => {
  const engine = form('<label>Would working from the office be possible for you?<input></label>');
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes', answerSource: 'profile' });
  expect(scan.fields[0].interpretationEligible).not.toBe(true);
});

test('treats a work authorization legend as the radio question outside employment history rows', async () => {
  const engine = form(`
    <fieldset><legend>${authorization}</legend>
      <label><input type="radio" name="authorized">I am legally authorized to work in Canada</label>
      <label><input type="radio" name="authorized">I am not legally authorized to work in Canada</label>
    </fieldset>
  `);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'unanswered', interpretationEligible: true });
  const plan = await engine.interpret(scan.scanId, profile, [
    meaning(scan, 0, 'workAuthorization', { country: 'Canada', evidence: 'take up employment in Canada' }),
  ]);
  expect(plan?.fields[0]).toMatchObject({ value: 'I am legally authorized to work in Canada', answerSource: 'interpreted' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
});

test.each([
  ['Can I work in Wakanda with work authorization from Canada?', '', 'workAuthorization', 'Canada'],
  ['Could you take up employment in Wakanda without additional permission?', 'Job location: Canada', 'workAuthorization', 'Canada'],
  ['What is the source of your work authorization in Canada?', '', 'workAuthorization', 'Canada'],
  ['Do you have a LinkedIn profile?', '', 'linkedin', null],
  ['What country issued your work visa?', '', 'country', null],
  ['Which gender is printed on your identity document?', '', 'gender', null],
  ['Would you consider relocating, provided the company covers all moving costs?', '', 'relocation', null],
  ['Would you consider relocating, start next month?', '', 'relocation', null],
  ['What race did you complete last year?', '', 'raceEthnicity', null],
  ['Are you legally authorized to work full-time in Canada?', '', 'workAuthorization', 'Canada'],
  ['Are you a recently separated veteran?', '', 'veteran', null],
  ['Will you require relocation assistance?', '', 'relocation', null],
  ['Do you need disability adjustments?', '', 'disability', null],
  ['Do you require hybrid work?', '', 'onsiteWork', null],
] satisfies [string, string, QuestionMeaning['fact'], string | null][])('does not expose a plausible fact for a different proposition in %s', async (label, context, fact, country) => {
  const engine = form(`<label>${label}<input aria-describedby="help"></label><p id="help">${context}</p>`);
  const full = { ...profile, personal: { ...profile.personal, country: 'Canada', linkedin: 'https://example.test/applicant' } };
  const scan = await engine.scan(full);
  const plan = await engine.interpret(scan.scanId, full, [meaning(scan, 0, fact, { country })]);
  expect(plan?.fields[0]).toMatchObject({ status: 'unanswered' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
});

test('uses one current job and an explicit skills list for unfamiliar applicant fields', async () => {
  const engine = form(`
    <label>Which company presently employs you? <input></label>
    <label>What title do you presently hold at work? <input></label>
    <label>Please list your competencies
      <select multiple><option>TypeScript</option><option>Design systems</option><option>Operations</option></select>
    </label>
  `);
  const current = { company: 'Current Company', title: 'Designer', location: '', startDate: '', endDate: '', current: true, description: '' };
  const employed = { ...profile, employment: [{ ...current, company: 'Previous Company', current: false }, current], skills: ['TypeScript', 'Design systems'] };
  const scan = await engine.scan(employed);
  const plan = await engine.interpret(scan.scanId, employed, [
    meaning(scan, 0, 'currentEmployer'), meaning(scan, 1, 'currentJobTitle'), meaning(scan, 2, 'skills'),
  ]);
  expect(plan?.fields.map(field => field.value)).toEqual(['Current Company', 'Designer', ['TypeScript', 'Design systems']]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 3 });
});

test('ordinary choice values do not override misleading visible labels during interpretation', async () => {
  const engine = form(`<label>Which city are you currently located in?
    <select><option value="">Choose</option><option value="Detroit">Chicago</option></select>
  </label>`);
  const local = { ...profile, personal: { ...profile.personal, city: 'Detroit' } };
  const scan = await engine.scan(local);
  const plan = await engine.interpret(scan.scanId, local, [meaning(scan, 0, 'city')]);
  expect(plan?.fields[0]).toMatchObject({ status: 'unanswered' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
});

test('checks polarity and uses contextual wording only for a generic caption', async () => {
  const engine = form(`
    <label>Choose one <select aria-describedby="context"><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
    <p id="context">Is employment visa sponsorship something you will not need?</p>
  `);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({ interpretationEligible: true, interpretationContext: 'Is employment visa sponsorship something you will not need?' });
  const plan = await engine.interpret(scan.scanId, profile, [
    meaning(scan, 0, 'visaSponsorship', { inverse: true, evidence: 'employment visa sponsorship' }),
  ]);
  expect(plan?.fields[0]).toMatchObject({ status: 'ready', value: 'No', answerSource: 'interpreted' });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
});

test('includes visible associated context while omitting reflected applicant values and hidden or live text', async () => {
  const engine = form(`
    <label>${email}<input type="email" aria-describedby="safe reflected hidden output"></label>
    <p id="safe">Use an address where we can contact you.</p>
    <p id="reflected">Welcome ApplicantExample.</p>
    <p id="hidden" hidden>Hidden label content.</p>
    <output id="output">Live value.</output>
    <label>First name<input value="ApplicantExample"></label>
  `);
  const scan = await engine.scan(profile);
  expect(scan.fields[0]).toMatchObject({
    interpretationEligible: true,
    interpretationContext: 'Use an address where we can contact you.',
  });
});

test('distinguishes an employer pronoun from an explicit US sponsorship scope', async () => {
  const engine = form(`
    <label>Is employer visa sponsorship something you will need to work for us?<input></label>
    <label>Is employer visa sponsorship something you will need to work in the U.S.?<input></label>
    <label>Do you need employer sponsorship for us?<input></label>
    <label>Are you legally authorized to work in us?
      <select><option value="">Choose</option><option>Yes</option><option>No</option></select>
    </label>
  `);
  const local = { ...profile, workAuthorizations: [{ country: 'US', authorized: true, sponsorshipRequired: false }] };
  const scan = await engine.scan(local);
  expect(scan.fields.map(field => field.value)).toEqual([undefined, undefined, 'Yes', undefined]);
  const mistaken = await engine.interpret(scan.scanId, local, [
    meaning(scan, 0, 'visaSponsorship', { country: 'us' }),
    meaning(scan, 1, 'visaSponsorship', { country: 'U.S.' }),
  ]);
  expect(mistaken?.fields.map(field => field.value)).toEqual([undefined, 'No', 'Yes', undefined]);
  const grounded = await engine.interpret(scan.scanId, local, [meaning(scan, 0, 'visaSponsorship')]);
  expect(grounded?.fields.map(field => field.value)).toEqual(['Yes', 'No', 'Yes', undefined]);
});

test('withholds choice lists that contain a reflected applicant value or an email address', async () => {
  const engine = form(`
    <label>First name<input value="Avery Example"></label>
    <label>Which ethnicity category best reflects how you identify?
      <select><option value="">Choose</option><option>South Asian (Avery Example)</option></select>
    </label>
    <label>${gender}
      <select><option value="">Choose</option><option>avery@example.test</option><option>Man</option></select>
    </label>
    <label>Which ethnicity category best describes you?
      <select><option value="">Choose</option><option>South Asian</option><option>Asian</option></select>
    </label>
  `);
  const scan = await engine.scan(profile);
  expect(scan.fields.slice(1).map(field => !!field.interpretationEligible)).toEqual([false, false, true]);
  expect(scan.fields.slice(1).map(field => field.options)).toEqual([
    ['South Asian (Avery Example)'], ['avery@example.test', 'Man'], ['South Asian', 'Asian'],
  ]);
});
