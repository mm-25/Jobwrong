// @vitest-environment-options {"url":"https://job-boards.greenhouse.io/example-studio/jobs/5003000"}
import { expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

const base = emptyProfile();
const profile = { ...base, personal: { ...base.personal, country: 'United States', phone: '313-555-0100' } };
const choices = [
  { flag: 'ca', code: '1', label: 'Canada +1' },
  { flag: 'us', code: '1', label: 'United States +1' },
  { flag: 'gb', code: '44', label: 'United Kingdom +44' },
];

function phoneCountryForm({
  initial = '', commitFlag, commitCode, optionFlag, hideFlag = false, replaceDisplay = false, legend = 'Phone',
}: { initial?: string; commitFlag?: string; commitCode?: string; optionFlag?: string; hideFlag?: boolean; replaceDisplay?: boolean; legend?: string } = {}) {
  document.body.innerHTML = `<form><fieldset><legend>${legend}</legend>
    <label id="country-label" for="country">Country</label>
    <div class="select-shell"><div><div class="select__control">
      <div class="select__value-container">
        <div class="select__input-container" data-value="">
          <input type="text" id="country" class="select__input" role="combobox" aria-labelledby="country-label"
            aria-autocomplete="list" aria-haspopup="true" aria-expanded="false" value="">
        </div>
      </div>
      <div class="select__indicators"><button type="button" aria-label="Toggle flyout" tabindex="-1">⌄</button></div>
    </div></div></div>
    <label>Phone <input id="phone" type="tel" value="313-555-0100"></label>
  </fieldset><button type="submit">Submit</button></form>`;

  const trigger = document.querySelector<HTMLInputElement>('#country')!;
  const container = document.querySelector('.select__value-container')!;
  const shell = document.querySelector('.select-shell')!;
  const toggle = shell.querySelector('button')!;
  const clicks: string[] = [];
  let selectedFlag = initial;
  const selected = () => container.querySelector('.select__single-value');
  function render(flag: string, code: string) {
    selectedFlag = flag;
    selected()?.remove();
    const display = document.createElement('div');
    display.className = 'select__single-value';
    if (flag) {
      const badge = document.createElement('div');
      badge.className = `iti__flag iti__${flag}`;
      badge.hidden = hideFlag;
      display.append(badge);
    }
    const dial = document.createElement('span');
    dial.textContent = `+${code}`;
    display.append(dial);
    container.prepend(display);
  }
  function close() {
    shell.querySelector('[role="listbox"]')?.remove();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
  }
  document.querySelector('form')!.addEventListener('submit', event => {
    event.preventDefault();
    clicks.push('submit');
  });
  trigger.addEventListener('keyup', event => { if (event.code === 'Escape') close(); });
  shell.querySelector('.select__control')!.parentElement!.addEventListener('mouseup', event => {
    if (event.target !== toggle || event.button !== 0 || event.buttons !== 0) return;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', 'react-select-country-listbox');
    const listbox = document.createElement('div');
    listbox.id = 'react-select-country-listbox';
    listbox.setAttribute('role', 'listbox');
    for (const { flag, code, label } of choices) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(flag === selectedFlag));
      const badge = document.createElement('div');
      badge.className = `iti__flag iti__${flag === 'us' && optionFlag ? optionFlag : flag}`;
      option.append(badge, label);
      option.addEventListener('click', () => {
        clicks.push(flag);
        render(commitFlag ?? flag, commitCode ?? code);
        if (replaceDisplay) {
          const replacement = container.cloneNode(false) as Element;
          replacement.append(...container.childNodes);
          container.replaceWith(replacement);
        }
        close();
      });
      listbox.append(option);
    }
    shell.append(listbox);
  });
  const initialChoice = choices.find(choice => choice.flag === initial);
  if (initialChoice) render(initial, initialChoice.code);
  return { engine: createEngine(document), selected, clicks, trigger, render };
}

test('counts a matched country when Greenhouse replaces the full option label with its flag and dial code', async () => {
  const { engine, selected, clicks, trigger } = phoneCountryForm();
  const scan = await engine.scan(profile);
  expect(scan.fields.find(field => field.label === 'Country')).toMatchObject({ status: 'ready' });

  const filled = await engine.fill(scan.scanId);
  expect(clicks).toEqual(['us']);
  expect(selected()?.textContent).toBe('+1');
  expect(selected()?.querySelector('.iti__flag.iti__us')).not.toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(filled.entries.find(field => field.label === 'Country')).toMatchObject({ status: 'filled' });
  expect(filled).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
});

test.each([
  { commitFlag: 'ca' },
  { commitFlag: '' },
  { commitFlag: 'us iti__ca' },
  { hideFlag: true },
  { commitCode: '44' },
])('requires both the country flag and code to agree with the selected menu option (%o)', async options => {
  const { engine, clicks } = phoneCountryForm(options);
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(clicks).toEqual(['us']);
});

test('does not click a country option whose visible flag disagrees with its caption', async () => {
  const { engine, clicks, selected, trigger } = phoneCountryForm({ optionFlag: 'ca' });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(clicks).toEqual([]);
  expect(selected()).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

test('does not confirm an answer rendered in a replacement value container', async () => {
  const { engine, clicks } = phoneCountryForm({ replaceDisplay: true });
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(clicks).toEqual(['us']);
});

test('preserves a same-code country change made without a change event after scanning', async () => {
  const { engine, selected, clicks, render } = phoneCountryForm({ initial: 'ca' });
  const scan = await engine.scan(profile, { overwriteExisting: true });
  const country = scan.fields.find(field => field.label === 'Country')!;
  render('us', '1');
  expect(await engine.fill(scan.scanId, [country.id])).toMatchObject({ filled: 0, skipped: 1, failed: 0 });
  expect(clicks).toEqual([]);
  expect(selected()?.querySelector('.iti__flag.iti__us')).not.toBeNull();
});

test('restores the original country on Undo when the new country shares its displayed dial code', async () => {
  const { engine, selected, clicks } = phoneCountryForm({ initial: 'ca' });
  const scan = await engine.scan(profile, { overwriteExisting: true });
  const country = scan.fields.find(field => field.label === 'Country')!;
  expect(await engine.fill(scan.scanId, [country.id])).toMatchObject({ filled: 1, failed: 0, undoAvailable: true });
  expect(selected()?.querySelector('.iti__flag.iti__us')).not.toBeNull();

  expect(await engine.undo(scan.scanId)).toMatchObject({ restored: 1, skipped: 0 });
  expect(clicks).toEqual(['us', 'ca']);
  expect(selected()?.querySelector('.iti__flag.iti__ca')).not.toBeNull();
});

test('Undo leaves a same-code country change made without a change event', async () => {
  const { engine, selected, clicks, render } = phoneCountryForm({ initial: 'gb' });
  const scan = await engine.scan(profile, { overwriteExisting: true });
  const country = scan.fields.find(field => field.label === 'Country')!;
  expect(await engine.fill(scan.scanId, [country.id])).toMatchObject({ filled: 1, failed: 0 });
  render('ca', '1');

  expect(await engine.undo(scan.scanId)).toMatchObject({ restored: 0, skipped: 1 });
  expect(clicks).toEqual(['us']);
  expect(selected()?.querySelector('.iti__flag.iti__ca')).not.toBeNull();
});

test('does not count a flag and code for an unrelated Country widget', async () => {
  const { engine, clicks } = phoneCountryForm({ legend: 'Office' });
  const scan = await engine.scan({ ...profile, answers: [{ question: 'Country', answer: 'United States +1' }] });
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 0, failed: 1 });
  expect(clicks).toEqual(['us']);
});
