import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

function phoneFields(countryControl: string) {
  document.body.innerHTML = `<form><fieldset><legend>Phone</legend>
    <label for="phone-country">Country</label>${countryControl}
    <label for="phone-number">Phone Number</label><input id="phone-number" type="tel">
  </fieldset></form>`;
}

function phoneProfile(country: string, phone: string, phoneCountryCode = '') {
  const profile = emptyProfile();
  Object.assign(profile.personal, { country, phone, phoneCountryCode });
  return profile;
}

function selectOptions(labels: string[]) {
  phoneFields(`<select id="phone-country"><option value="">Choose</option>${labels.map(label => `<option>${label}</option>`).join('')}</select>`);
}

test.each([
  ['United States', '(313) 555-0100', ['Canada +1', 'United States +1'], 'United States +1'],
  ['GB', '020 7946 0000', ['Australia +61', 'United Kingdom (+44)'], 'United Kingdom (+44)'],
])('commits the unique phone-country choice for %s with a local number', async (country, phone, labels, expected) => {
  selectOptions(labels);
  const engine = createEngine(document);
  const plan = await engine.scan(phoneProfile(country, phone));
  const field = plan.fields.find(field => field.label === 'Country')!;
  expect(field).toMatchObject({ status: 'ready', value: expected });
  expect(await engine.fill(plan.scanId, [field.id])).toMatchObject({ filled: 1, failed: 0 });
  expect(document.querySelector<HTMLSelectElement>('#phone-country')?.value).toBe(expected);
});

test.each([
  ['a compatible 00 international prefix', '0044 20 7946 0000', '+44'],
  ['a 00 international prefix without a saved code', '0044 20 7946 0000', ''],
  ['an explicit code and blank phone number', '', '+44'],
])('matches the calling code with %s', async (_case, phone, code) => {
  selectOptions(['France +33', 'United Kingdom +44']);
  const plan = await createEngine(document).scan(phoneProfile('United Kingdom', phone, code));
  expect(plan.fields.find(field => field.label === 'Country')).toMatchObject({ status: 'ready', value: 'United Kingdom +44' });
});

test.each([
  ['missing country', '', '313-555-0100', '', ['United States +1']],
  ['missing number', 'United States', '', '', ['United States +1']],
  ['invalid number', 'United States', 'local 313-555-0100', '', ['United States +1']],
  ['uncorroborated international number', 'United States', '0044 20 7946 0000', '', ['United States +1']],
  ['option naming a different country', 'United States', '313-555-0100', '', ['Canada +1']],
  ['choice without a dialing code', 'United States', '313-555-0100', '', ['United States']],
  ['multiple matching country options', 'United States', '313-555-0100', '', ['United States +1', 'USA (+1)']],
  ['conflicting saved code', 'United States', '313-555-0100', '+44', ['United States +1', 'United Kingdom +44']],
  ['conflicting international number', 'United States', '+44 20 7946 0000', '', ['United States +1', 'United Kingdom +44']],
  ['a 00 international prefix conflicting with the saved code', 'United States', '0044 20 7946 0000', '+1', ['United States +1', 'United Kingdom +44']],
  ['an invalid 00-prefixed number despite a saved code', 'United States', '0044 office', '+1', ['United States +1']],
  ['an invalid plus-prefixed number despite a saved code', 'United States', '+44 office', '+1', ['United States +1']],
  ['malformed saved code', 'United States', '313-555-0100', 'USA', ['United States +1']],
] as const)('leaves the phone-country choice unanswered with %s', async (_case, country, phone, code, labels) => {
  selectOptions([...labels]);
  const plan = await createEngine(document).scan(phoneProfile(country, phone, code));
  expect(plan.fields.find(field => field.label === 'Country')).toMatchObject({ status: 'unanswered' });
});

test.each([
  [['Canada +1', 'United States +1'], 'United States +1'],
  [['Canada +1'], ''],
  [['United States +1', 'USA (+1)'], ''],
] as const)('rechecks the live phone-country options %j before selection', async (labels, expected) => {
  phoneFields('<input id="phone-country" role="combobox" aria-expanded="false" aria-controls="phone-countries">');
  const trigger = document.querySelector<HTMLInputElement>('#phone-country')!;
  trigger.addEventListener('click', () => {
    const menu = document.createElement('div');
    menu.id = 'phone-countries';
    menu.setAttribute('role', 'listbox');
    for (const label of labels) {
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
    trigger.after(menu);
  });

  const engine = createEngine(document);
  const plan = await engine.scan(phoneProfile('US', '313-555-0100'));
  const field = plan.fields.find(field => field.label === 'Country')!;
  expect(field).toMatchObject({ status: 'ready', value: 'US' });
  expect(document.getElementById('phone-countries')).toBeNull();
  const result = await engine.fill(plan.scanId, [field.id]);
  expect(result).toMatchObject({ filled: expected ? 1 : 0, failed: expected ? 0 : 1 });
  expect(trigger.value).toBe(expected);
});
