import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';
import type { PersonalDetails } from '../../src/shared/types';

afterEach(() => document.body.replaceChildren());

function choices(options: readonly string[]): string {
  return `<select><option value="">Choose</option>${options.map(option => `<option>${option}</option>`).join('')}</select>`;
}

function phoneProfile(details: Partial<PersonalDetails>) {
  const profile = emptyProfile();
  Object.assign(profile.personal, { country: 'United States', ...details });
  return profile;
}

const phoneChoices = ['Canada +1', 'United States +1', 'United Kingdom +44'];

function phoneGroup(countryControl: string) {
  document.body.innerHTML = `<form><fieldset><legend>Phone</legend>
    <label>Country${countryControl}</label><label>Phone<input type="tel"></label></fieldset></form>`;
}

test.each([
  ['a local number and a unique profile country', { phone: '313-555-0100' }, 'United States +1'],
  ['an explicit calling code', { phone: '313-555-0100', phoneCountryCode: '+1' }, 'United States +1'],
  ['a valid international phone number', { phone: '+1 (313) 555-0100' }, 'United States +1'],
  ['an explicitly different phone country', { phone: '+14165550100', phoneCountryCode: 'Canada (+1)' }, 'Canada +1'],
] as const)('selects the exact country-qualified phone option from %s', async (_case, details, expected) => {
  phoneGroup(choices(phoneChoices));
  const plan = await createEngine(document).scan(phoneProfile(details));
  expect(plan.fields.find(field => field.label === 'Country')).toMatchObject({ status: 'ready', value: expected });
});

test.each([
  ['a shared dialing code with no known country', { country: '', phone: '+13135550100', phoneCountryCode: '+1' }],
  ['a residence country that does not match the number', { phone: '+442079460000' }],
  ['conflicting saved dialing code and phone number', { phone: '+442079460000', phoneCountryCode: '+1' }],
  ['an invalid international number', { phone: '+1 office' }],
] as const)('leaves a phone-country choice blank with %s', async (_case, details) => {
  phoneGroup(choices(phoneChoices));
  const plan = await createEngine(document).scan(phoneProfile(details));
  expect(plan.fields.find(field => field.label === 'Country')).toMatchObject({ status: 'unanswered' });
});

test('does not select a less specific country code or arbitrarily pick between aliases', async () => {
  phoneGroup(choices([...phoneChoices, 'Bahamas +1242']));
  const bahamas = await createEngine(document).scan(phoneProfile({ phone: '+12425550100' }));
  expect(bahamas.fields.find(field => field.label === 'Country')).toMatchObject({ status: 'unanswered' });

  phoneGroup(choices([...phoneChoices, 'USA +1']));
  const duplicate = await createEngine(document).scan(phoneProfile({ phone: '+13135550100' }));
  expect(duplicate.fields.find(field => field.label === 'Country')).toMatchObject({ status: 'unanswered' });
});

test('previews the known phone country before the menu has rendered its options', async () => {
  phoneGroup('<input type="text" role="combobox" aria-expanded="false" aria-controls="phone-countries">');
  const known = await createEngine(document).scan(phoneProfile({ phone: '+13135550100' }));
  expect(known.fields.find(field => field.label === 'Country')).toMatchObject({ status: 'ready', value: 'United States' });
  const local = await createEngine(document).scan(phoneProfile({ phone: '313-555-0100' }));
  expect(local.fields.find(field => field.label === 'Country')).toMatchObject({ status: 'ready', value: 'United States' });
});

test('matches the country and calling code together when options load during a fill', async () => {
  phoneGroup('<input type="text" role="combobox" aria-expanded="false" aria-controls="phone-countries">');
  const trigger = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  trigger.addEventListener('click', () => {
    const menu = document.createElement('div');
    menu.id = 'phone-countries';
    menu.setAttribute('role', 'listbox');
    for (const label of phoneChoices) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.textContent = label;
      option.addEventListener('click', () => {
        trigger.value = label;
        trigger.setAttribute('aria-expanded', 'false');
        menu.remove();
      });
      menu.append(option);
    }
    trigger.setAttribute('aria-expanded', 'true');
    trigger.closest('label')!.after(menu);
  });

  const engine = createEngine(document);
  const plan = await engine.scan(phoneProfile({ country: 'US', phone: '+13135550100' }));
  const country = plan.fields.find(field => field.label === 'Country')!;
  expect(country).toMatchObject({ status: 'ready', value: 'US' });
  expect(document.getElementById('phone-countries')).toBeNull();
  expect(await engine.fill(plan.scanId, [country.id])).toMatchObject({ filled: 1, failed: 0 });
  expect(trigger.value).toBe('United States +1');
});

test('preserves canonical residence-country matching outside the Phone group', async () => {
  document.body.innerHTML = `<form><label>Country${choices(['United States', 'Canada'])}</label></form>`;
  const plan = await createEngine(document).scan(phoneProfile({ country: 'USA', phone: '' }));
  expect(plan.fields[0]).toMatchObject({ label: 'Country', status: 'ready', value: 'United States' });
});

async function degree(saved: string, options: readonly string[]) {
  document.body.innerHTML = `<form><fieldset><legend>Education</legend>
    <label>Degree${choices(options)}</label></fieldset></form>`;
  const profile = emptyProfile();
  profile.education = [{ school: 'Example University', degree: saved, fieldOfStudy: '', startDate: '', endDate: '', gpa: '' }];
  return (await createEngine(document).scan(profile)).fields[0];
}

test.each([
  ['B.S.', ["Bachelor's Degree", 'Bachelor of Arts', 'Bachelor of Science'], 'Bachelor of Science'],
  ['B.S.', ["Bachelor's Degree", 'Bachelor of Arts'], "Bachelor's Degree"],
  ['MBA', ["Master's Degree", 'Master of Business Administration (M.B.A.)'], 'Master of Business Administration (M.B.A.)'],
  ['M.S.', ["Master's Degree", 'Master of Business Administration (M.B.A.)'], "Master's Degree"],
  ["Master's Degree", ['Master of Science', "Master's", 'Master of Arts'], "Master's"],
  ['Masters', ["Master's Degree", 'Master of Science'], "Master's Degree"],
  ['Master’s degree', ['Master of Science', "Master's"], "Master's"],
  ['Bachelor Degree', ['Bachelor of Science', "Bachelor's"], "Bachelor's"],
  ['Master of Science in Information', ["Master's", 'Master of Science', 'Master of Arts'], 'Master of Science'],
  ['M.S. in Information', ['Master of Arts', "Master's"], "Master's"],
  ['Master of Science in Information (MSI)', ["Master's", 'Master of Science'], 'Master of Science'],
  ['Master of Information', ["Master's", 'Master of Arts', 'Master of Science'], "Master's"],
  ["Master's Degree (Information)", ['Master of Science', "Master's"], "Master's"],
  ['Master of Design in Interaction Design', ["Master's", 'Master of Design'], 'Master of Design'],
  ['Master of Science in Information', ["Master's", 'Master of Science', 'Master of Science in Information'], 'Master of Science in Information'],
] as const)('selects the most specific verified degree for %s', async (saved, options, expected) => {
  expect(await degree(saved, options)).toMatchObject({ status: 'ready', value: expected });
});

test.each([
  ['B.S.', ['Bachelor of Arts']],
  ['MBA', ['Master of Science', 'Master of Arts']],
  ["Master's Degree", ['Master of Science', 'Master of Arts']],
  ['B.S.', ["Bachelor's Degree", 'Bachelor Degree']],
  ['Design Fundamentals program', ["Bachelor's Degree", "Master's Degree"]],
  ['Masters', ['Master of Science', 'Master of Arts']],
  ["Master's Degree", ['Masters', "Master's"]],
  ['Masterclass in design', ["Master's Degree", 'Master of Science']],
  ["Master's Degree", ["Bachelor's Degree", 'Doctorate']],
  ["Master's in Information", ['Master of Science', 'Master of Arts']],
  ['Master of Science in Information', ['Master of Science in Chemistry', 'Master of Arts']],
  ['Master of Science in Information', ['Master of Science', 'M.S.', "Master's"]],
  ['Master of Science (MBA)', ['Master of Science', 'MBA', "Master's"]],
  ['MSI', ["Master's", 'Master of Science']],
] as const)('does not pick an unrelated or ambiguous degree for %s', async (saved, options) => {
  expect(await degree(saved, options)).toMatchObject({ status: 'unanswered' });
});
