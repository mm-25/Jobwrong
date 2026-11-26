import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

function fixture() {
  document.body.innerHTML = `<div class="ashby-application-form-field-entry" data-field-path="_systemfield_location">
    <label for="_systemfield_location">Location</label><div>
      <input class="ashby-application-form-input-autocomplete" placeholder="Start typing..." aria-autocomplete="list" aria-expanded="false" aria-haspopup="listbox" role="combobox">
      <button type="button">Expand</button>
    </div></div>`;
}

test('uses complete saved location only for the recognized system-location search field', async () => {
  fixture();
  const profile = emptyProfile();
  Object.assign(profile.personal, { city: 'Detroit', state: 'Michigan', country: 'United States' });
  const plan = await createEngine(document).scan(profile);
  expect(plan.fields[0]).toMatchObject({ label: 'Location', status: 'ready', value: 'Detroit, Michigan, United States' });
  expect(plan.fields[0].aiEligible).not.toBe(true);
});

test.each(['city', 'state', 'country'] as const)('leaves a location search blank without the saved %s', async missing => {
  fixture();
  const profile = emptyProfile();
  Object.assign(profile.personal, { city: 'Detroit', state: 'Michigan', country: 'United States' });
  profile.personal[missing] = '';
  const plan = await createEngine(document).scan(profile);
  expect(plan.fields[0].value).toBeUndefined();
});

test('does not infer current residence from another custom location question', async () => {
  fixture();
  document.querySelector('[data-field-path]')!.setAttribute('data-field-path', 'preferred_job_location');
  const profile = emptyProfile();
  Object.assign(profile.personal, { city: 'Detroit', state: 'Michigan', country: 'United States' });
  const plan = await createEngine(document).scan(profile);
  expect(plan.fields[0].value).toBeUndefined();
});
