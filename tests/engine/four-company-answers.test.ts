import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const profile = emptyProfile();
profile.personal.website = 'https://portfolio.example.test';
profile.personal.city = 'Detroit';
profile.personal.state = 'Michigan';
profile.applicationDefaults = { visaSponsorship: 'yes', relocation: 'yes', onsiteWork: 'yes' };
afterEach(() => document.body.replaceChildren());

test.each([
  'Do you have a portfolio that you would like to share with us?',
  'Please link your website or portfolio.',
  'Please provide a link to your portfolio.',
  'Share your personal website URL here.',
  'Other Website',
])('fills an explicit portfolio-link request from the saved website: %s', async label => {
  document.body.innerHTML = `<label>${label}<input></label>`;
  const scan = await createEngine(document).scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: profile.personal.website });
});

test.each([
  'Describe a project in your portfolio.',
  'Do you have a portfolio?',
  'Please share your previous employer website.',
  'Please provide your portfolio password.',
])('does not turn an unrelated portfolio question into a link: %s', async label => {
  document.body.innerHTML = `<label>${label}<input></label>`;
  const scan = await createEngine(document).scan(profile);
  expect(scan.fields[0].value).toBeUndefined();
});

test('keeps an explicit portfolio request manual when no website is saved', async () => {
  document.body.innerHTML = '<label>Do you have a portfolio that you would like to share with us?<input></label>';
  const scan = await createEngine(document).scan(emptyProfile());
  expect(scan.fields[0]).toMatchObject({ status: 'unanswered', aiEligible: false });
  expect(scan.fields[0].value).toBeUndefined();
});

test.each([
  'We are unable to offer visa sponsorship for this position. Do you now or will you in the future require visa sponsorship?',
  'We do not provide visa sponsorship. Will you require visa sponsorship?',
  'Will you now or in the future require employer sponsorship for an employment visa (for example, H-1B)?',
  'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B, etc.)?',
  "If you're not located in San Francisco, CA, are you open to relocation?",
  'I understand this is an in-person role in Philadelphia, PA.',
  'Are you able to work out of our San Francisco, California office or Burlington, Vermont office a minimum of 3 days per week?',
])('uses the saved applicant preference for an unambiguous application question: %s', async label => {
  document.body.innerHTML = `<label>${label}<select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>`;
  const scan = await createEngine(document).scan(profile);
  expect(scan.fields[0]).toMatchObject({ status: 'ready', value: 'Yes' });
});

test.each([
  'We are unable to offer visa sponsorship. Can you work without visa sponsorship?',
  'If you receive relocation assistance, are you open to relocation?',
  'I understand this is an in-person role and I accept the employment agreement.',
  'I understand this is an in-person role in Philadelphia, PA (mandatory travel).',
  'I understand this is an in-person role in Philadelphia, PA. I need relocation support.',
  'If you are not located in the posted city, are you open to relocation?',
  'If you are not located in San Francisco Bay Area, are you open to relocation?',
])('does not answer Yes when the proposition is different or conditional: %s', async label => {
  document.body.innerHTML = `<label>${label}<select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>`;
  const scan = await createEngine(document).scan(profile);
  expect(scan.fields[0].value).not.toBe('Yes');
});

test.each(['San Francisco', ''])('leaves a conditional relocation question alone when its location condition is unmet or unknown: %s', async city => {
  document.body.innerHTML = `<label>If you're not located in San Francisco, CA, are you open to relocation?<select><option value="">Choose</option><option>Yes</option><option>No</option><option>Not applicable</option></select></label>`;
  const scan = await createEngine(document).scan({ ...profile, personal: { ...profile.personal, city } });
  expect(scan.fields[0].value).toBeUndefined();
});

test('does not equate a negative onsite preference with a negative acknowledgment', async () => {
  document.body.innerHTML = '<label>I understand this is an in-person role in Philadelphia, PA.<select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>';
  const scan = await createEngine(document).scan({ ...profile, applicationDefaults: { onsiteWork: 'no' } });
  expect(scan.fields[0].value).toBeUndefined();
});

test('does not turn an employer policy preface into an authorization answer', async () => {
  document.body.innerHTML = '<label>We are unable to offer visa sponsorship. Can you work without visa sponsorship?<select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>';
  const scan = await createEngine(document).scan({ ...profile, applicationDefaults: { visaSponsorship: 'no' } });
  expect(scan.fields[0].value).toBeUndefined();
});
