import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

const gender = 'How would you describe your gender identity? (mark all that apply)';
const race = 'How would you describe your racial/ethnic background? (mark all that apply)';

function application({ question = gender, values = ['Female', 'Male ', 'Non-Binary', 'Prefer not to disclose'], commit = true,
  wrongChip = false } = {}) {
  document.body.innerHTML = `<form id="application-form"><div class="select"><div class="select__container">
    <label id="45201-label" for="45201">${question}</label>
    <div class="select-shell"><div><div class="select__control">
      <div class="select__value-container select__value-container--is-multi">
        <div class="select__placeholder" id="react-select-45201-placeholder">Select...</div>
        <div class="select__input-container"><input id="45201" type="text" class="select__input" role="combobox"
          aria-haspopup="true" aria-autocomplete="list" aria-expanded="false" aria-labelledby="45201-label"
          aria-describedby="react-select-45201-placeholder 45201-error"></div>
      </div>
      <div class="select__indicators"><button type="button" aria-label="Clear selections"></button>
        <button type="button" aria-label="Toggle flyout"></button></div>
    </div></div></div>
    <div id="45201-error" aria-live="polite"></div>
  </div></div><button type="submit">Submit</button></form>`;
  const input = document.querySelector<HTMLInputElement>('input')!;
  const select = input.closest('.select__value-container')!;
  const shell = input.closest('.select-shell')!;
  const activity: string[] = [];
  document.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); activity.push('submit'); });
  shell.querySelector('[aria-label="Clear selections"]')!.addEventListener('click', () => activity.push('clear all'));
  const addChip = (value: string) => {
    const placeholder = select.querySelector('.select__placeholder');
    placeholder?.remove();
    input.setAttribute('aria-describedby', '45201-error');
    select.classList.add('select__value-container--is-multi--has-value');
    const chip = document.createElement('div');
    chip.className = 'select__multi-value';
    chip.innerHTML = `<div class="select__multi-value__label">${value}</div>
      <div role="button" class="select__multi-value__remove" aria-label="Remove ${value}">
        <button type="button" aria-label="Remove selection"></button>
      </div>`;
    chip.querySelector('[role="button"]')!.addEventListener('click', () => {
      activity.push(`remove ${value.trim()}`);
      chip.remove();
      if (!select.querySelector('.select__multi-value')) {
        select.classList.remove('select__value-container--is-multi--has-value');
        select.insertAdjacentHTML('afterbegin', '<div class="select__placeholder" id="react-select-45201-placeholder">Select...</div>');
        input.setAttribute('aria-describedby', 'react-select-45201-placeholder 45201-error');
      }
    });
    select.prepend(chip);
  };
  const close = () => {
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-controls');
    shell.querySelector('[role="listbox"]')?.remove();
  };
  shell.querySelector('[aria-label="Toggle flyout"]')!.addEventListener('mouseup', () => {
    activity.push('open');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'react-select-45201-listbox');
    shell.insertAdjacentHTML('beforeend', `<div id="react-select-45201-listbox" role="listbox" aria-multiselectable="true">
      ${values.map((label, index) => `<div id="react-select-45201-option-${index}" role="option">${label}</div>`).join('')}
    </div>`);
    for (const option of shell.querySelectorAll('[role="option"]')) {
      if (wrongChip && option.textContent?.trim() === 'Male') option.setAttribute('data-value', 'Female');
      option.addEventListener('click', () => {
        const optionLabel = option.textContent!;
        activity.push(`select ${optionLabel.trim()}`);
        close();
        if (commit) addChip(wrongChip ? 'Female' : optionLabel);
        else input.value = optionLabel.trim();
      });
    }
  });
  input.addEventListener('keyup', event => { if (event.key === 'Escape') close(); });
  const profile = emptyProfile();
  profile.applicationDefaults = { gender: 'male', raceEthnicity: 'south_asian', hispanicLatino: 'no' };
  const chips = () => [...select.querySelectorAll('.select__multi-value__label')].map(chip => chip.textContent?.trim());
  return { engine: createEngine(document), input, profile, addChip, chips, activity };
}

test.each([
  [gender, ['Female', 'Male ', 'Non-Binary', 'Prefer not to disclose'], 'Male'],
  [race, ['White', 'Asian', 'Two or More', 'Prefer not to disclose'], 'Asian'],
  [race, ['White', 'Asian', 'South Asian', 'Prefer not to disclose'], 'South Asian'],
] as const)('selects and undoes only the verified Greenhouse chip for %s (%s)', async (question, values, chosen) => {
  const { engine, profile, chips, activity, input } = application({ question, values: [...values] });
  const scan = await engine.scan(profile);
  expect(scan.fields).toEqual([expect.objectContaining({ label: question, status: 'ready' })]);
  expect(activity).toEqual([]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  expect(chips()).toEqual([chosen]);
  expect(input.value).toBe('');
  expect(await engine.undo()).toMatchObject({ restored: 1, skipped: 0 });
  expect(chips()).toEqual([]);
  expect(activity).toEqual(['open', `select ${chosen}`, `remove ${chosen}`]);
});

test('keeps an existing Greenhouse selection even when overwrite is requested', async () => {
  const { engine, profile, chips, activity, addChip } = application();
  addChip('Female');
  const scan = await engine.scan(profile, { overwriteExisting: true });
  expect(scan.fields).toEqual([expect.objectContaining({ status: 'preserved', currentValue: 'Female' })]);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0 });
  expect(chips()).toEqual(['Female']);
  expect(activity).toEqual([]);
});

test('leaves the Greenhouse field untouched on Undo after the applicant adds a second chip', async () => {
  const { engine, profile, addChip, chips, activity } = application();
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1 });
  addChip('Female');
  expect(await engine.undo()).toMatchObject({ restored: 0, skipped: 1 });
  expect(chips()).toEqual(['Female', 'Male']);
  expect(activity).toEqual(['open', 'select Male']);
});

test('does not count matching query text as a Greenhouse multi-select commitment', async () => {
  const { engine, profile, input, chips, activity } = application({ commit: false });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(chips()).toEqual([]);
  expect(input.value).toBe('Male');
  expect(activity).toEqual(['open', 'select Male']);
});

test('does not accept a committed chip that matches only a Greenhouse option machine value', async () => {
  const { engine, profile, chips } = application({ wrongChip: true });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1, undoAvailable: false });
  expect(chips()).toEqual(['Female']);
  expect(await engine.undo()).toMatchObject({ restored: 0 });
});
