// @vitest-environment-options {"url":"https://jobs.lever.co/example-studio/illustration-role/apply"}
import { expect, test } from 'vitest';
import { answerWorkAuthorization, leverPostingLocation } from '../../src/engine/work-authorization';

const general = 'Are you legally authorized to work in the United States?';
const fullTime = 'Are you legally authorized to work in the U.S. on a full-time basis?';
const jobCountry = 'Are you legally authorized to work in the country for which you are applying?';

test.each([
  [general, { country: 'US', authorized: true }, 'US', true],
  ['Do you currently have the legal right to work in Canada?', { country: 'CA', authorized: false }, 'CA', false],
  ['Do you have work authorisation for the United Kingdom?', { country: 'UK', authorized: true }, 'GB', true],
  ['Are you legally eligible to work in US? *', { country: 'USA', authorized: false }, 'US', false],
])('matches an explicit general work authorization for %s', (question, record, country, answer) => {
  expect(answerWorkAuthorization(question, [record])).toEqual({ fact: 'authorized', country, answer });
});

test.each([
  fullTime,
  'Are you currently eligible to work full time in the United States?',
  'Are you legally permitted to work on a full-time basis in the U.S.?',
  'Do you have legal work authorization in the United States for full-time employment?',
])('uses only the explicit full-time fact for %s', question => {
  expect(answerWorkAuthorization(question, [{ country: 'US', authorized: true }]))
    .toEqual({ fact: 'fullTimeAuthorized', country: 'US' });
  expect(answerWorkAuthorization(question, [{ country: 'United States', authorized: true, fullTimeAuthorized: false }]))
    .toEqual({ fact: 'fullTimeAuthorized', country: 'US', answer: false });
  expect(answerWorkAuthorization(question, [{ country: 'USA', authorized: true, fullTimeAuthorized: true }]))
    .toEqual({ fact: 'fullTimeAuthorized', country: 'US', answer: true });
});

test('requires the matching authorization fact even with sponsorship and citizenship data', () => {
  const records = [{ country: 'US', sponsorshipRequired: false, citizenship: 'United States', fullTimeAuthorized: true }];
  expect(answerWorkAuthorization(general, records)).toEqual({ fact: 'authorized', country: 'US' });
  expect(answerWorkAuthorization(fullTime, [{ country: 'US', authorized: false, sponsorshipRequired: true }]))
    .toEqual({ fact: 'fullTimeAuthorized', country: 'US' });
});

test('does not use an authorization saved for a different country', () => {
  expect(answerWorkAuthorization(general, [{ country: 'Canada', authorized: true }]))
    .toEqual({ fact: 'authorized', country: 'US' });
  expect(answerWorkAuthorization(general, [
    { country: 'Canada', authorized: false }, { country: 'USA', authorized: true }, { country: 'U.S.', authorized: true },
  ])).toEqual({ fact: 'authorized', country: 'US', answer: true });
});

test('reports conflicting saved facts across equivalent country spellings', () => {
  expect(answerWorkAuthorization(general, [{ country: 'US', authorized: true }, { country: 'U.S.', authorized: false }]))
    .toEqual({ fact: 'authorized', country: 'US', conflict: true });
  expect(answerWorkAuthorization(fullTime, [
    { country: 'USA', authorized: true, fullTimeAuthorized: false }, { country: 'United States', fullTimeAuthorized: true },
  ])).toEqual({ fact: 'fullTimeAuthorized', country: 'US', conflict: true });
  expect(answerWorkAuthorization(fullTime, [{ country: 'US', authorized: false, fullTimeAuthorized: true }]))
    .toEqual({ fact: 'fullTimeAuthorized', country: 'US', conflict: true });
});

test.each([
  ['Washington, D.C.', 'US'],
  ['Washington, District of Columbia', 'US'],
  ['Washington, DC, United States', 'US'],
  ['United States', 'US'],
  ['Toronto, Ontario, Canada', 'CA'],
  ['London, United Kingdom', 'GB'],
])('resolves applying-country wording only from the supplied posting location %s', (location, country) => {
  const records = [{ country: 'US', authorized: true }, { country: 'Canada', authorized: false },
    { country: 'United Kingdom', authorized: false }];
  expect(answerWorkAuthorization(jobCountry, records, location)).toEqual({ fact: 'authorized', country, answer: country === 'US' });
});

test.each([
  undefined, '', 'Washington', 'US Government', 'London', 'Ontario, CA', 'Canada or the United States',
  'London, United Kingdom / Toronto, Canada', 'London, United Kingdom, Toronto, Canada', 'Washington, D.C., Canada',
])('keeps a referential jurisdiction unresolved without reliable single-country evidence (%s)', location => {
  expect(answerWorkAuthorization(jobCountry, [{ country: 'United States', authorized: true }], location))
    .toEqual({ fact: 'authorized' });
});

test('uses an explicit question jurisdiction when the posting suggests a different location', () => {
  expect(answerWorkAuthorization(general, [{ country: 'Canada', authorized: true }, { country: 'US', authorized: false }], 'Toronto, Canada'))
    .toEqual({ fact: 'authorized', country: 'US', answer: false });
});

function leverField(locationMarkup: string): Element {
  document.body.innerHTML = `<div class="section page-centered posting-header">
    <h2>Example Designer, US Government</h2>
    <div class="posting-categories">${locationMarkup}<div class="department">Design</div></div>
  </div>
  <form id="application-form"><input name="authorized"><div class="location">Canada</div></form>`;
  return document.querySelector('input')!;
}

test('binds a referential authorization to the exact Lever posting location', () => {
  const field = leverField('<div class="location">Washington, D.C.</div>');
  expect(leverPostingLocation(field)).toBe('Washington, D.C.');
  expect(answerWorkAuthorization(jobCountry, [{ country: 'US', authorized: true }], leverPostingLocation(field)))
    .toEqual({ fact: 'authorized', country: 'US', answer: true });
});

test.each([
  '<div class="location" hidden>Washington, D.C.</div>',
  '<div class="location">Washington, D.C.</div><div class="location">Toronto, Canada</div>',
  '<div class="location">Washington, D.C.</div><div class="location" hidden>Washington, D.C.</div>',
  '<div class="location">London<span style="display:none">, United States</span></div>',
  '<div class="location"><input value="Washington, D.C."></div>',
  '',
])('ignores absent, hidden, live, or ambiguous Lever posting location markup (%s)', markup => {
  expect(leverPostingLocation(leverField(markup))).toBeUndefined();
});

test('does not trust Lever-shaped markup from another origin or an unassociated field', () => {
  leverField('<div class="location">Washington, D.C.</div>');
  const other = document.implementation.createHTMLDocument();
  other.body.innerHTML = document.body.innerHTML;
  expect(leverPostingLocation(other.querySelector('input')!)).toBeUndefined();
  expect(leverPostingLocation(document.querySelector('h2')!)).toBeUndefined();
});

test.each([
  'Are you legally authorized to work in us?',
  'Are you legally authorized to work in the United States or Canada?',
  'Are you authorized to work in CA?',
  'Are you eligible to work in Georgia?',
  'Will you be authorized to work in the United States by your start date?',
  'Are you authorized to work in the United States without employer sponsorship?',
  'Are you authorized to work unrestricted in the United States?',
  'Are you authorized to work part-time in the United States?',
  'Are you authorized to work in the United States full-time or part-time?',
  'Are you authorized to work in the United States on a full-time basis and travel internationally?',
  'Are you legally authorized to work in your country?',
  'Do you hold United States citizenship?',
  'Will you require sponsorship to work in the United States?',
])('leaves compounded, ambiguous, or different questions outside the matcher (%s)', question => {
  expect(answerWorkAuthorization(question, [{ country: 'United States', authorized: true, fullTimeAuthorized: true }], 'Washington, D.C.'))
    .toBeUndefined();
});
