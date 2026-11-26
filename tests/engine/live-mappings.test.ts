import { beforeEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { isResumeField } from '../../src/engine/answers';
import { discover } from '../../src/engine/discovery';
import type { Profile } from '../../src/shared/types';

const profile: Profile = {
  schemaVersion: 1,
  personal: {
    firstName: 'Maya', lastName: 'Patel', email: 'maya@example.test', phone: '',
    address: '10 Main St', city: 'Detroit', state: 'Michigan', postalCode: '48201',
    country: 'United States', linkedin: '', website: '', github: '',
  },
  employment: [],
  education: [],
  answers: [],
};

beforeEach(() => {
  document.body.replaceChildren();
});

function scan(markup: string, savedProfile = profile) {
  document.body.innerHTML = markup;
  return createEngine(document).scan(savedProfile);
}

test('recognizes a Greenhouse application embedded on a custom company site', async () => {
  const preview = await scan(`
    <form class="gh-apply-form">
      <label for="gh-location">Location (City)<span class="required">*</span></label>
      <input id="gh-location" name="location">
    </form>
  `);
  expect(preview.platform).toBe('Greenhouse');
});

test('ignores a Greenhouse-like class without a matching input in the same form', async () => {
  const preview = await scan(`
    <form class="gh-apply-form"><input name="search"></form>
    <form><input id="gh-location" name="location"></form>
  `);
  expect(preview.platform).toBe('Generic');
});

test('uses the saved city for Location (City)', async () => {
  const preview = await scan(`
    <form>
      <label for="gh-location">Location (City)<span class="required">*</span></label>
      <input id="gh-location" name="location" required>
    </form>
  `);
  expect(preview.fields[0]).toMatchObject({ label: 'Location (City)', status: 'ready', value: 'Detroit' });
});

test('uses the saved city, state, and country for a question about current location', async () => {
  const preview = await scan(`
    <form>
      <label for="gh-current-location">Where are you currently located?<span class="required">*</span></label>
      <input id="gh-current-location" name="question_38508358002" required>
    </form>
  `);
  expect(preview.fields[0]).toMatchObject({
    label: 'Where are you currently located?', status: 'ready', value: 'Detroit, Michigan, United States',
  });
});

test('omits missing components of the saved current location', async () => {
  const preview = await scan('<label>Current location <input></label>', {
    ...profile, personal: { ...profile.personal, state: ' ' },
  });
  expect(preview.fields[0]).toMatchObject({ status: 'ready', value: 'Detroit, United States' });
});

test('leaves the current location unanswered when the profile has no locality', async () => {
  const preview = await scan('<label>Where are you currently located? <input></label>', {
    ...profile, personal: { ...profile.personal, city: '', state: '', country: '' },
  });
  expect(preview.fields[0]).toMatchObject({ status: 'unanswered', aiEligible: false });
  expect(preview.fields[0].value).toBeUndefined();
});

test.each([
  'Location',
  'Preferred job location',
  'Which city would you prefer to work in?',
  'Where is your current employer located?',
  'Country of birth',
  'Nationality',
])('leaves an unrelated location question unanswered (%s)', async (label) => {
  const preview = await scan(`<label>${label} <input name="city"></label>`);
  expect(preview.fields[0]).toMatchObject({ status: 'unanswered' });
  expect(preview.fields[0].value).toBeUndefined();
});

test('recognizes the Resume/CV file field with a required marker', () => {
  document.body.innerHTML = `
    <form class="gh-apply-form">
      <div class="field">
        <label for="gh-resume">Resume/CV<span class="required">*</span></label>
        <input type="file" id="gh-resume" name="resume" accept=".pdf,.doc,.docx,.txt,.rtf">
      </div>
    </form>
  `;
  expect(discover(document).filter(isResumeField).map((field) => field.element.id)).toEqual(['gh-resume']);
});

test('leaves the alternate resume text area unanswered when only a file is saved', async () => {
  const preview = await scan(`
    <div class="field">
      <label for="gh-resume">Resume/CV<span class="required">*</span></label>
      <textarea id="gh-resume_text-alt" name="resume_text"></textarea>
    </div>
  `, {
    ...profile,
    resume: { name: 'maya-resume.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERg==', lastModified: 123 },
  });
  expect(preview.fields[0]).toMatchObject({ kind: 'text', status: 'unanswered', aiEligible: false });
  expect(preview.fields[0].value).toBeUndefined();
});

test('leaves optional portfolio passwords for manual entry', async () => {
  const preview = await scan(`
    <label>Portfolio Link <input></label>
    <label>Portfolio Password(if needed) <input></label>
  `, {
    ...profile,
    personal: { ...profile.personal, website: 'https://example.test/portfolio' },
    answers: [{ question: 'Portfolio Password(if needed)', answer: 'n/a' }],
  });
  expect(preview.fields).toEqual([
    expect.objectContaining({ status: 'ready', value: 'https://example.test/portfolio' }),
    expect.objectContaining({ status: 'unsupported', aiEligible: false }),
  ]);
  expect(preview.fields[1].value).toBeUndefined();
});
