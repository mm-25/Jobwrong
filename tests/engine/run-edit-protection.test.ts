import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

function application() {
  document.body.innerHTML = `<form>
    <label>City<input id="city"></label>
    <label>Licensed driver<input id="license" type="checkbox"></label>
  </form>`;
  const profile = emptyProfile();
  profile.personal.city = 'Detroit';
  profile.personal.state = 'Michigan';
  profile.answers.push({ question: 'Licensed driver', answer: 'Yes' });
  const city = document.querySelector<HTMLInputElement>('#city')!;
  const license = document.querySelector<HTMLInputElement>('#license')!;
  return { engine: createEngine(document), profile, city, license };
}

function editAndClear(input: HTMLInputElement) {
  input.value = 'Applicant edit';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = '';
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

test('preserves manual clears across scans of an Autofill run, including fields revealed during a wait', async () => {
  const { engine, profile, city } = application();
  const options = { autofillRun: 'original-run', overwriteExisting: true };
  expect((await engine.scan(profile, options)).fields.find(field => field.label === 'City')?.status).toBe('ready');
  city.closest('form')!.insertAdjacentHTML('beforeend', '<label>State<input id="state"></label>');
  const state = document.querySelector<HTMLInputElement>('#state')!;
  editAndClear(city);
  editAndClear(state);
  expect((await engine.scan(profile)).fields.find(field => field.label === 'City')?.status).toBe('ready');

  const followup = await engine.scan(profile, options);
  expect(followup.fields.filter(field => field.kind === 'text')).toEqual([
    expect.objectContaining({ label: 'City', status: 'preserved' }),
    expect.objectContaining({ label: 'State', status: 'preserved' }),
  ]);
  expect(await engine.fill(followup.scanId)).toMatchObject({ filled: 1 });
  expect(city.value).toBe('');
  expect(state.value).toBe('');
  expect((await engine.scan(profile, { autofillRun: 'new-run' })).fields.filter(field => field.kind === 'text').map(field => field.status))
    .toEqual(['ready', 'ready']);
});

test('retains overwrite permission for an original field across a rescan while preserving newly parsed values', async () => {
  const { engine, profile, city } = application();
  city.value = 'Warren';
  city.closest('form')!.insertAdjacentHTML('beforeend', '<label>State<input id="state" value="Ohio"></label>');
  const state = document.querySelector<HTMLInputElement>('#state')!;
  const options = { autofillRun: 'original-run' };
  const initial = await engine.scan(profile, { ...options, overwriteExisting: true });
  const cityId = initial.fields.find(field => field.label === 'City')!.id;
  const stateId = initial.fields.find(field => field.label === 'State')!.id;
  state.value = 'Illinois';
  city.closest('form')!.insertAdjacentHTML('beforeend', '<label>City<input id="parsed-city" value="Ann Arbor"></label>');
  const after = await engine.scan(profile, { ...options, overwriteFieldIds: [cityId, stateId] });
  expect(after.fields.filter(field => field.label === 'City')).toEqual([
    expect.objectContaining({ id: cityId, status: 'ready' }),
    expect.objectContaining({ status: 'preserved', currentValue: 'Ann Arbor' }),
  ]);
  expect(after.fields.find(field => field.id === stateId)).toMatchObject({ status: 'preserved', currentValue: 'Illinois' });
  expect(await engine.fill(after.scanId, [cityId])).toMatchObject({ filled: 1 });
  expect(city.value).toBe('Detroit');
  expect(document.querySelector<HTMLInputElement>('#parsed-city')!.value).toBe('Ann Arbor');
});

test('keeps programmatic native fills eligible while recognizing a subsequent manual checkbox clear', async () => {
  const { engine, profile, city, license } = application();
  let events = 0;
  city.closest('form')!.addEventListener('input', () => events++);
  city.closest('form')!.addEventListener('change', () => events++);
  const options = { autofillRun: 'original-run', overwriteExisting: true };
  const initial = await engine.scan(profile, options);
  expect(await engine.fill(initial.scanId)).toMatchObject({ filled: 2 });
  expect(events).toBe(4);
  expect((await engine.scan(profile, options)).fields.map(field => field.status)).toEqual(['ready', 'ready']);

  license.click();
  const followup = await engine.scan(profile, options);
  expect(followup.fields.find(field => field.label === 'Licensed driver')?.status).toBe('preserved');
  expect(license.checked).toBe(false);
});
