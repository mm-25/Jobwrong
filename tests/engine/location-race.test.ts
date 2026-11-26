import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { Profile } from '../../src/shared/types';

const profile: Profile = {
  ...emptyProfile(),
  applicationDefaults: { onsiteWork: 'yes', relocation: 'yes', raceEthnicity: 'south_asian' },
};

function form(markup: string) {
  document.body.innerHTML = '<form>' + markup + '</form>';
  return createEngine(document);
}

test.each([
  ['Are you willing to work from our Redwood City, CA office 5x week?', 'Yes'],
  ['Are you willing to work in Montréal, QC?', 'Yes'],
  ['Are you open to working on-site in New York?', 'Yes'],
  ['Would you be willing to work a hybrid schedule in our Chicago office?', 'Yes'],
  ['Are you able to work onsite at least three days per week?', 'Yes'],
  ['Are you able to be onsite at the London office three days a week?', 'Yes'],
  ['Are you comfortable working out of our Columbus office?', 'Yes'],
  ['Would you consider relocating to san jose?', 'Yes'],
  ['Are you willing to relocate to Atlanta, GA for this role?', 'Yes'],
  ['Would you relocate for this position?', 'Yes'],
  ['Are you unwilling to relocate to Boston?', 'No'],
  ['Are you not willing to work from our Austin office?', 'No'],
  ['Are you unwilling to work in the office three days a week?', 'No'],
  ['Are you willing to travel up to 50% for the job?', undefined],
  ['Are you willing to work night shifts onsite?', undefined],
  ['Are you willing to work onsite and work weekends?', undefined],
  ['Are you willing to work in Chicago and take emergency calls?', undefined],
  ['Are you willing to work in Engineering?', undefined],
  ['Can you work from Home?', undefined],
  ['Will you need relocation assistance?', undefined],
  ['Are you legally authorized to work in Chicago?', undefined],
  ['Are you willing to work onsite without visa sponsorship?', undefined],
  ['Would you like to work fully remotely?', undefined],
  ['What is your preferred office location?', undefined],
])('matches only the configured location proposition in %s', async (question, expected) => {
  const engine = form(`<label>${question}<input></label>`);
  expect((await engine.scan(profile)).fields[0].value).toBe(expected);
});

test('uses each location default independently and honors an exact saved exception', async () => {
  const engine = form(`
    <label>Are you willing to relocate? <input></label>
    <label>Are you willing to work in the office? <input></label>
    <label>Are you willing to work in Miami? <select><option value="">Choose</option>
      <option>Yes, I am willing to work in Miami</option><option>No, I am not willing to work in Miami</option>
    </select></label>
  `);
  const configured: Profile = {
    ...profile, applicationDefaults: { ...profile.applicationDefaults, relocation: 'no' },
    answers: [{ question: 'Are you willing to work in the office?', answer: 'No' }],
  };
  expect((await engine.scan(configured)).fields.map(({ value }) => value)).toEqual([
    'No', 'No', 'Yes, I am willing to work in Miami',
  ]);
});

const asianDefinition = 'Asian (A person having origins in any of the original peoples of the Far East, Southeast Asia, or the Indian subcontinent including, for example, Cambodia, China, India, Japan, Korea, Malaysia, Pakistan, the Philippine Islands, Thailand, and Vietnam.)';

test('chooses the unique South Asian option ahead of Asian in the same choice set', async () => {
  const engine = form(`
    <label>Race and ethnicity
      <select id="race"><option value="">Choose</option><option value="a">Asian</option><option value="b">South Asian</option></select>
    </label>
  `);
  const plan = await engine.scan(profile);
  expect(plan.fields[0]).toMatchObject({ value: 'South Asian', sensitive: true });
  expect(await engine.fill(plan.scanId)).toMatchObject({ filled: 1 });
  expect(document.querySelector<HTMLSelectElement>('#race')!.value).toBe('b');
});

test('falls back to the broad Asian EEO category when South Asian is absent', async () => {
  const engine = form(`
    <label>What is your race or ethnicity?
      <select><option value="">Choose</option><option>East Asian</option><option>Asian American</option><option>${asianDefinition}</option></select>
    </label>
  `);
  expect((await engine.scan(profile)).fields[0]).toMatchObject({ value: asianDefinition, sensitive: true });
});

test('leaves ambiguous or more specific race choices unanswered', async () => {
  const engine = form(`
    <label>Race/Ethnicity <select><option value="">Choose</option><option>South Asian</option><option>South-Asian</option><option>Asian</option></select></label>
    <label>What is your race? <select><option value="">Choose</option><option value="asian">East Asian</option><option>Asian American</option><option>Asian (East Asia, for example China or Japan)</option></select></label>
    <label>What is your ethnicity? <select><option value="">Choose</option><option>Asian (Not Hispanic or Latino)</option></select></label>
  `);
  expect((await engine.scan(profile)).fields.map(({ status, aiEligible }) => [status, aiEligible])).toEqual([
    ['unanswered', false], ['unanswered', false], ['unanswered', false],
  ]);
});

test('exact saved race answers override the category preference', async () => {
  const engine = form(`
    <label>Race <select><option value="">Choose</option><option>South Asian</option><option>Asian</option></select></label>
  `);
  const saved = { ...profile, answers: [{ question: 'Race', answer: 'Asian' }] };
  expect((await engine.scan(saved)).fields[0]).toMatchObject({ value: 'Asian' });
});

test('handles the exact C3 race prompt with only the broad Asian category available', async () => {
  const engine = form(`
    <label>Please identify your race <select><option value="">Choose</option><option>White</option>
      <option>Asian</option><option>Two or more races</option><option>Decline to self-identify</option>
    </select></label>
  `);
  expect((await engine.scan(profile)).fields[0]).toMatchObject({ value: 'Asian', sensitive: true });
});

test('keeps a broad Asian choice when only a narrower South Asian option is available', async () => {
  const engine = form('<label>Race <select><option value="">Choose</option><option>South Asian</option></select></label>');
  const broad: Profile = { ...profile, applicationDefaults: { raceEthnicity: 'asian' } };
  expect((await engine.scan(broad)).fields[0]).toMatchObject({ status: 'unanswered' });
});

test('uses a non-Hispanic race choice when both profile facts support it', async () => {
  const engine = form(`
    <label>Race and ethnicity <select><option value="">Choose</option><option>Asian</option>
      <option>South Asian (Not Hispanic or Latino)</option></select></label>
    <label>Race <select><option value="">Choose</option><option>Asian (Not Hispanic/Latino)</option></select></label>
    <label>Ethnicity <input></label>
  `);
  const nonHispanic: Profile = { ...profile, applicationDefaults: { ...profile.applicationDefaults, hispanicLatino: 'no' } };
  expect((await engine.scan(nonHispanic)).fields.map(({ value }) => value)).toEqual([
    'South Asian (Not Hispanic or Latino)', 'Asian (Not Hispanic/Latino)', 'South Asian',
  ]);
  const hispanic: Profile = { ...profile, applicationDefaults: { ...profile.applicationDefaults, hispanicLatino: 'yes' } };
  expect((await engine.scan(hispanic)).fields.map(({ value }) => value)).toEqual(['Asian', undefined, 'South Asian']);
});
