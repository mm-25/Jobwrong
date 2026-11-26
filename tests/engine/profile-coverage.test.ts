import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { Profile } from '../../src/shared/types';

const base = emptyProfile();
const profile: Profile = {
  ...base,
  personal: {
    ...base.personal,
    firstName: 'Morgan', middleName: 'Reese', lastName: 'Lee',
    preferredFirstName: 'Mo', preferredLastName: 'Li',
    address2: 'Unit 4', county: 'Wayne', country: 'US', state: 'MI',
    phone: '313-555-0101', phoneCountryCode: '1', phoneType: 'Mobile',
  },
  employment: [
    { company: 'Former Co', title: 'Associate', location: '', startDate: '2018', endDate: '2020-01', current: false, description: '' },
    { company: 'Current Co', title: 'Lead', location: '', startDate: '2020-02', endDate: '2020-07', current: true, description: '' },
  ],
  education: [
    { school: 'Example University', degree: 'B.S.', fieldOfStudy: '', startDate: 'Sep 2022', endDate: '2025', gpa: '', current: true },
  ],
  skills: ['TypeScript', 'Design systems'],
  workAuthorizations: [
    { country: 'US', authorized: true, sponsorshipRequired: false },
    { country: 'Canada', authorized: false, sponsorshipRequired: true },
  ],
};

function form(markup: string) {
  document.body.innerHTML = '<form>' + markup + '</form>';
  return createEngine(document);
}

test('fills explicit preferred names, middle name, second address line, county and split phone entries', async () => {
  const engine = form(`
    <label>Middle name <input id="middle"></label>
    <label>Preferred First Name <input id="preferred"></label>
    <label>Preferred Name <input id="display"></label>
    <label>Full legal name <input id="full"></label>
    <label>Apartment / Suite <input id="unit"></label>
    <label>County <input id="county"></label>
    <label>Phone device type <select id="device"><option value="">Choose</option><option>Mobile</option></select></label>
    <label>Country Phone Code <select id="dial"><option value="">Choose</option><option value="US">United States (+1)</option><option value="IN">India (+91)</option></select></label>
    <label>Phone number <input type="tel" id="number"></label>
  `);
  const { scanId, fields } = await engine.scan(profile);
  expect(fields.map(({ value }) => value)).toEqual([
    'Reese', 'Mo', 'Mo Li', 'Morgan Reese Lee', 'Unit 4', 'Wayne', 'Mobile', 'United States (+1)', '313-555-0101',
  ]);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 9 });
  expect((document.querySelector('#dial') as HTMLSelectElement).value).toBe('US');
});

test('filters country, region and degree aliases by the actual choice text', async () => {
  const engine = form(`
    <label>Country <select><option value="">Choose</option><option value="n1">United States of America</option></select></label>
    <label>State / Province <select><option value="">Choose</option><option value="n2">Michigan</option></select></label>
    <fieldset><legend>Education</legend>
      <label>School <input></label>
      <label>Degree <select><option value="">Choose</option><option value="n3">Bachelor of Science</option></select></label>
    </fieldset>
  `);
  expect((await engine.scan(profile)).fields.map(({ value }) => value)).toEqual([
    'United States of America', 'Michigan', 'Example University', 'Bachelor of Science',
  ]);
});

test('maps standalone current employer and job title from the unique current employment record', async () => {
  const engine = form(`
    <label>Current employer <input></label>
    <label>What is your current job title? <input></label>
  `);
  expect((await engine.scan(profile)).fields.map(({ value }) => value)).toEqual(['Current Co', 'Lead']);
  const roles = { ...profile, employment: profile.employment.map((entry) => ({ ...entry, current: true })) };
  expect((await engine.scan(roles)).fields.map(({ value, aiEligible }) => [value, aiEligible])).toEqual([
    [undefined, false], [undefined, false],
  ]);
});

test('resolves split dates by visible month and preserves missing parts', async () => {
  const engine = form(`
    <fieldset><legend>Employment record 1</legend>
      <label>Company <input></label>
      <label>Start Month <input></label>
      <label>Start Year <input type="number"></label>
      <label>End Date - Month <select id="end-month"><option value="">Choose</option><option value="0">January</option><option value="1">February</option></select></label>
    </fieldset>
    <fieldset><legend>Employment record 2</legend>
      <label>Current employer <input></label>
      <label>Start Month <select id="start-month"><option value="">Choose</option><option value="1">January</option><option value="2">February</option></select></label>
      <label>End Year <input></label>
      <label>I currently work here <input type="checkbox"></label>
    </fieldset>
  `);
  const { scanId, fields } = await engine.scan(profile);
  expect(fields.map(({ value }) => value)).toEqual([
    'Former Co', undefined, '2018', 'January', 'Current Co', 'February', undefined, true,
  ]);
  expect(await engine.fill(scanId)).toMatchObject({ filled: 6 });
  expect((document.querySelector('#end-month') as HTMLSelectElement).value).toBe('0');
});

test('uses known education date parts and distinguishes current enrollment from unknown', async () => {
  const engine = form(`
    <fieldset><legend>Education</legend>
      <label>School <input></label>
      <label>Start date month <select><option value="">Choose</option><option value="09">09</option></select></label>
      <label>Graduation Year <input type="number"></label>
      <label>I currently attend <input type="checkbox"></label>
    </fieldset>
  `);
  expect((await engine.scan(profile)).fields.map(({ value }) => value)).toEqual([
    'Example University', '09', undefined, true,
  ]);
  const [education] = profile.education;
  const former = { ...profile, education: [{ ...education, current: false }] };
  expect((await engine.scan(former)).fields.map(({ value }) => value)).toEqual([
    'Example University', '09', '2025', false,
  ]);
  const unknown = { ...profile, education: [{ ...education, current: undefined }] };
  expect((await engine.scan(unknown)).fields.at(-1)).toMatchObject({ status: 'unanswered' });
});

test('answers explicitly scoped authorization and sponsorship while leaving ambiguous questions blank', async () => {
  const radio = (label: string) => `<fieldset><legend>${label}</legend>
    <label><input type="radio" name="${label}" value="yes"> Yes</label>
    <label><input type="radio" name="${label}" value="no"> No</label></fieldset>`;
  const engine = form([
    'Are you legally authorized to work in the United States?',
    'Are you legally entitled to work in Canada?',
    'Will you now or in the future require visa sponsorship to work in the United States?',
    'Will you require sponsorship to work in Canada?',
    'Are you legally authorized to work in Canada and the United States?',
    'Are you legally authorized to work in the location of this role?',
    'Would you require sponsorship in Michigan?',
    'Are you a citizen of Canada?',
    'Are you legally authorized to work in the United Kingdom?',
  ].map(radio).join(''));
  const { fields } = await engine.scan(profile);
  expect(fields.map(({ value }) => value)).toEqual([
    'Yes', 'No', 'No', 'Yes', undefined, undefined, undefined, undefined, undefined,
  ]);
  const conflicting = {
    ...profile,
    workAuthorizations: [...profile.workAuthorizations!, { country: 'U.S.A.', authorized: false }],
    answers: [{ question: 'Will you require sponsorship to work in Canada?', answer: 'No' }],
  };
  const after = (await engine.scan(conflicting)).fields;
  expect(after[0]).toMatchObject({ sensitive: true, status: 'unanswered' });
  expect(after[3]).toMatchObject({ sensitive: true, value: 'No' });
});

test('supplies explicit skills to a skills list without using them for unrelated employment questions', async () => {
  const engine = form(`
    <label>Skills <select multiple><option>TypeScript</option><option>Design systems</option><option>Operations</option></select></label>
    <label>Describe your leadership skills <textarea></textarea></label>
  `);
  expect((await engine.scan(profile)).fields.map(({ value }) => value)).toEqual([['TypeScript', 'Design systems'], undefined]);
});

test('resolves a country alias without treating ambiguous geographic names as authorization scopes', async () => {
  const engine = form(`
    <label>Country <select><option value="">Choose</option><option value="gb">United Kingdom</option></select></label>
    <label>Are you entitled to work in the United Kingdom? <select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
    <label>Are you entitled to work in CA? <select><option value="">Choose</option><option>Yes</option><option>No</option></select></label>
    <label>Are you permitted to work in the location of the role? <input></label>
  `);
  const unitedKingdom = {
    ...profile,
    personal: { ...profile.personal, country: 'UK' },
    workAuthorizations: [{ country: 'UK', authorized: true }, { country: 'CA', authorized: true }],
  };
  expect((await engine.scan(unitedKingdom)).fields.map(({ value, aiEligible }) => [value, aiEligible])).toEqual([
    ['United Kingdom', false], ['Yes', false], [undefined, false], [undefined, false],
  ]);
});

test('does not assume numeric month values are one-based when visible labels include zero', async () => {
  const engine = form(`
    <fieldset><legend>Employment record</legend>
      <label>Company <input></label>
      <label>Start Month <select><option value="">Choose</option><option value="0">0</option><option value="1">1</option><option value="2">2</option></select></label>
    </fieldset>
  `);
  expect((await engine.scan({ ...profile, employment: [profile.employment[1]] })).fields.at(-1)).toMatchObject({ status: 'unanswered' });
});

test('can disambiguate duplicate dialing codes only with explicit matching country', async () => {
  const engine = form(`
    <label>Phone Country Code <select><option value="">Choose</option><option value="ca">Canada (+1)</option><option value="us">United States (+1)</option></select></label>
  `);
  expect((await engine.scan(profile)).fields[0]).toMatchObject({ value: 'United States (+1)' });
  const noCountry = { ...profile, personal: { ...profile.personal, country: '' } };
  expect((await engine.scan(noCountry)).fields[0]).toMatchObject({ status: 'unanswered' });
});

test('uses a comma-separated skills list for a single-line input', async () => {
  const engine = form('<label>Skills <input></label>');
  expect((await engine.scan(profile)).fields[0]).toMatchObject({ value: 'TypeScript, Design systems' });
});

test('does not select an option that carries the right dialing code and a conflicting country', async () => {
  const engine = form(`
    <label>Phone Country Code <select><option value="">Choose</option><option value="ca">Canada (+1)</option></select></label>
  `);
  expect((await engine.scan(profile)).fields[0]).toMatchObject({ status: 'unanswered' });
  const canadaPhone = { ...profile, personal: { ...profile.personal, phoneCountryCode: 'Canada (+1)' } };
  expect((await engine.scan(canadaPhone)).fields[0]).toMatchObject({ value: 'Canada (+1)' });
});
