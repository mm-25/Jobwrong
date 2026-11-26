import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { Profile } from '../../src/shared/types';

const profile: Profile = {
  ...emptyProfile(),
  applicationDefaults: {
    visaSponsorship: 'yes', gender: 'male', disability: 'no', veteran: 'no', hispanicLatino: 'no',
  },
};

function form(markup: string) {
  document.body.innerHTML = '<form>' + markup + '</form>';
  return createEngine(document);
}

test('fills configured application answers in text, radio, select and checkbox controls', async () => {
  const engine = form(`
    <label>Will you now or in the future require visa sponsorship? <input id="visa"></label>
    <fieldset><legend>What is your gender identity?</legend>
      <label><input type="radio" name="gender" value="a">Woman</label>
      <label><input type="radio" name="gender" value="b" id="man">Man</label>
    </fieldset>
    <label>Disability status
      <select id="disability"><option value="">Choose</option>
        <option value="y">Yes, I have a disability, or have had one in the past</option>
        <option value="n">No, I do not have a disability and have not had one in the past</option>
        <option value="d">I do not want to answer</option>
      </select>
    </label>
    <label><input type="checkbox" id="veteran">I am not a protected veteran</label>
    <fieldset><legend>Are you Hispanic or Latino?</legend>
      <label><input type="checkbox" name="hispanic" value="a">Hispanic or Latino</label>
      <label><input type="checkbox" name="hispanic" value="b" id="nonhispanic">Not Hispanic or Latino</label>
    </fieldset>
  `);
  const { scanId, fields } = await engine.scan(profile);
  expect(fields.map(({ value, sensitive }) => [value, sensitive])).toEqual([
    ['Yes', true], ['Man', true],
    ['No, I do not have a disability and have not had one in the past', true],
    [true, true], ['Not Hispanic or Latino', true],
  ]);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 5 });
  expect(document.querySelector<HTMLInputElement>('#visa')!.value).toBe('Yes');
  expect(document.querySelector<HTMLInputElement>('#man')!.checked).toBe(true);
  expect(document.querySelector<HTMLSelectElement>('#disability')!.value).toBe('n');
  expect(document.querySelector<HTMLInputElement>('#veteran')!.checked).toBe(true);
  expect(document.querySelector<HTMLInputElement>('#nonhispanic')!.checked).toBe(true);
});

test('answers inverse questions according to the expressed proposition', async () => {
  const engine = form(`
    <label>Can you work without employer sponsorship? <select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
    <label>Do you not need visa sponsorship? <input></label>
    <label>Are you not Hispanic or Latino? <input></label>
    <label><input type="checkbox">I don't have a disability</label>
    <label><input type="checkbox">I am a veteran</label>
  `);
  expect((await engine.scan(profile)).fields.map(({ value }) => value)).toEqual(['No', 'No', 'Yes', true, false]);
});

test('keeps other facts, compound questions, and ambiguous options unanswered', async () => {
  const engine = form(`
    <label>Are you legally authorized to work in the United States? <input></label>
    <label>Are you a U.S. citizen? <input></label>
    <label>What security clearance do you hold? <input></label>
    <label>Is your spouse a veteran? <input></label>
    <fieldset><legend>Spouse information</legend><label>Veteran Status <input></label></fieldset>
    <label>Do you need visa sponsorship and hold citizenship? <input></label>
    <label>Gender <select><option value="">Choose</option><option value="Male">Transgender man</option></select></label>
    <label>Veteran Status <select><option value="">Choose</option><option value="No">Veteran, but not a protected veteran</option></select></label>
    <label>Are you Hispanic or Latino? <select><option value="">Choose</option><option>No</option><option>Not Hispanic or Latino</option></select></label>
  `);
  expect((await engine.scan(profile)).fields.map(({ status, aiEligible }) => [status, aiEligible])).toEqual(
    Array.from({ length: 9 }, () => ['unanswered', false]),
  );
});

test('keeps exact saved answers and country-specific sponsorship ahead of general defaults', async () => {
  const engine = form(`
    <label>Will you require sponsorship to work in Canada? <select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
    <label>Will you require sponsorship to work in the United States? <input></label>
    <label>Gender <input></label>
  `);
  const configured = {
    ...profile,
    workAuthorizations: [{ country: 'Canada', sponsorshipRequired: false }],
    answers: [{ question: 'Gender', answer: 'Prefer not to answer' }],
  };
  expect((await engine.scan(configured)).fields.map(({ value }) => value)).toEqual(['No', 'Yes', 'Prefer not to answer']);
});

test('does not infer protected veteran classification from an affirmative veteran answer', async () => {
  const engine = form(`
    <label>Are you a protected veteran? <input></label>
    <label>Are you a veteran? <input></label>
    <label>Veteran Status <select><option value="">Choose</option><option>Protected Veteran</option><option>Veteran, but not a protected veteran</option><option>Not a veteran</option></select></label>
  `);
  const veteran = { ...profile, applicationDefaults: { ...profile.applicationDefaults, veteran: 'yes' as const } };
  expect((await engine.scan(veteran)).fields.map(({ value }) => value)).toEqual([undefined, 'Yes', undefined]);
});

test('maps a configured decline to a unique disclosure option without treating it as No', async () => {
  const engine = form(`
    <label>Gender <select><option value="">Choose</option><option>Male</option><option>I choose not to disclose</option></select></label>
    <label>Are you disabled? <select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
  `);
  const declined: Profile = { ...profile, applicationDefaults: { gender: 'decline', disability: 'decline' } };
  expect((await engine.scan(declined)).fields.map(({ value }) => value)).toEqual(['I choose not to disclose', undefined]);
});

test('matches a lazy sponsorship choice after the associated menu opens', async () => {
  const engine = form(`
    <label id="visa-label">Will you now or in the future require employer sponsorship?</label>
    <button id="visa-menu" type="button" role="combobox" aria-controls="visa-options"
      aria-labelledby="visa-label" aria-expanded="false">Choose</button>
  `);
  const button = document.querySelector<HTMLButtonElement>('#visa-menu')!;
  button.addEventListener('click', () => {
    const menu = document.createElement('div');
    menu.id = 'visa-options';
    menu.setAttribute('role', 'listbox');
    menu.innerHTML = `
      <div role="option">I do not require employer sponsorship</div>
      <div role="option" id="requires-sponsorship">I require employer sponsorship</div>`;
    const choice = menu.querySelector('#requires-sponsorship')!;
    choice.addEventListener('click', () => {
      button.textContent = choice.textContent;
      button.setAttribute('aria-expanded', 'false');
      menu.remove();
    });
    button.after(menu);
    button.setAttribute('aria-expanded', 'true');
  });
  const { fields, scanId } = await engine.scan(profile);
  expect(fields[0]).toMatchObject({ value: 'Yes', sensitive: true });
  expect(document.querySelector('#visa-options')).toBeNull();
  expect(await engine.fill(scanId)).toMatchObject({ filled: 1 });
  expect(button.textContent).toBe('I require employer sponsorship');
});

test('recognizes an employment visa question with a common explanatory example', async () => {
  const engine = form(`
    <fieldset>
      <legend>Do you now, or will you in the future, require sponsorship for employment visa status (e.g., H-1B visa status)?</legend>
      <label><input type="radio" name="sponsor">Yes</label>
      <label><input type="radio" name="sponsor">No</label>
    </fieldset>
  `);
  expect((await engine.scan(profile)).fields[0]).toMatchObject({ value: 'Yes', sensitive: true });
});

test('keeps a literal saved choice selectable when equivalent demographic choices coexist', async () => {
  const engine = form('<label>Gender <select><option value="">Choose</option><option>Male</option><option>Man</option></select></label>');
  const saved: Profile = { ...profile, answers: [{ question: 'Gender', answer: 'Male' }] };
  expect((await engine.scan(saved)).fields[0]).toMatchObject({ status: 'ready', value: 'Male' });
  expect((await engine.scan(profile)).fields[0]).toMatchObject({ status: 'unanswered' });
});

test('matches the C3 AI employer-specific question and uses explicit U.S. sponsorship when supplied', async () => {
  const engine = form(`
    <label>Do you now or will you in the future need C3 AI to sponsor you for a visa to work in the United States (e.g., H-1B; O-1; TN; E-3)?
      <select><option value="">Choose</option><option>Yes</option><option>No</option></select>
    </label>
  `);
  expect((await engine.scan(profile)).fields[0]).toMatchObject({ value: 'Yes', sensitive: true });
  const scoped = { ...profile, workAuthorizations: [{ country: 'US', sponsorshipRequired: false }] };
  expect((await engine.scan(scoped)).fields[0]).toMatchObject({ value: 'No', sensitive: true });
});
