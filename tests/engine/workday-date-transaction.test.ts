import { afterEach, expect, test } from 'vitest';
import { createEngine } from '../../src/engine';
import { emptyProfile } from '../../src/shared/profile';

afterEach(() => document.body.replaceChildren());

function application(initial: [string, string] = ['', '']) {
  const id = 'workExperience-8--startDate';
  const help = `helpText-${id}`;
  const part = (name: string, placeholder: string, max: number, tabIndex: number) => `
    <div id="${id}-dateSection${name}" tabindex="${tabIndex}">
      <div id="${id}-dateSection${name}-display" data-automation-id="dateSection${name}-display" aria-hidden="true">${placeholder}</div>
      <input id="${id}-dateSection${name}-input" data-automation-id="dateSection${name}-input" role="spinbutton"
        aria-label="${name}" aria-valuemin="1" aria-valuemax="${max}" aria-valuetext="${placeholder}"
        aria-describedby="${help}" inputmode="numeric" maxlength="${placeholder.length}">
    </div>`;
  document.body.innerHTML = `<main data-automation-id="applyFlowPage"><div data-automation-id="applyFlowMyExpPage">
    <div role="group" aria-labelledby="Work-Experience-section"><h4 id="Work-Experience-section">Work Experience</h4>
      <div role="group" aria-labelledby="Work-Experience-1-panel"><h5 id="Work-Experience-1-panel">Work Experience 1</h5>
        <label>Company<input value="Example Studio"></label>
        <div data-automation-id="formField-startDate"><fieldset><legend>From</legend>
          <div><div id="${help}" aria-hidden="true">current value is MM/YYYY</div>
          <div id="${id}" data-automation-id="dateInputWrapper" role="group" aria-labelledby="hiddenDateValueId-${id}">
            <div tabindex="-1">${part('Month', 'MM', 12, 0)}<span aria-hidden="true">/</span>${part('Year', 'YYYY', 9999, -1)}</div>
          </div><div id="${help}" hidden>use right and left arrows to navigate spin buttons</div></div>
        </fieldset></div>
      </div>
    </div>
  </div></main>`;
  const group = document.getElementById(id)!;
  const [month, year] = group.querySelectorAll('input');
  const values = () => [month.value, year.value];
  const commits: string[][] = [];
  const render = (input: HTMLInputElement, raw: string) => {
    const placeholder = input === month ? 'MM' : 'YYYY';
    const value = input === month && raw ? String(Number(raw)) : raw;
    input.value = value;
    input.setAttribute('aria-valuetext', value || placeholder);
    if (value) input.setAttribute('aria-valuenow', value);
    else input.removeAttribute('aria-valuenow');
    input.previousElementSibling!.textContent = input === month && value ? value.padStart(2, '0') : value || placeholder;
    group.previousElementSibling!.textContent = `current value is ${month.value || 'MM'}/${year.value || 'YYYY'}`;
  };
  render(month, initial[0]);
  render(year, initial[1]);
  for (const input of [month, year]) {
    input.parentElement!.addEventListener('click', () => {
      month.parentElement!.tabIndex = input === month ? 0 : -1;
      year.parentElement!.tabIndex = input === year ? 0 : -1;
      input.focus();
    });
    input.addEventListener('input', () => render(input, input.value));
  }
  group.addEventListener('focusout', event => {
    if (!(event.relatedTarget instanceof Node) || !group.contains(event.relatedTarget)) commits.push(values());
  });
  const profile = emptyProfile();
  profile.employment = [{ company: 'Example Studio', title: '', startDate: '2021-01', endDate: '',
    current: true, location: '', description: '' }];
  return { engine: createEngine(document), profile, month, year, values, commits, render };
}

test('a blank Workday date commits both segments together during fill and Undo', async () => {
  const { engine, profile, values, commits } = application();
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 2, undoAvailable: true });
  expect(values()).toEqual(['1', '2021']);
  expect(commits).toEqual([['1', '2021']]);
  expect(await engine.undo()).toEqual({ restored: 2, skipped: 0 });
  expect(values()).toEqual(['', '']);
  expect(commits).toEqual([['1', '2021'], ['', '']]);
});

test('selecting one ready segment leaves an entirely blank Workday date alone', async () => {
  const { engine, profile, values, commits } = application();
  const scan = await engine.scan(profile);
  const month = scan.fields.find(field => field.label === 'From Month')!;
  expect(month.status).toBe('ready');
  expect(await engine.fill(scan.scanId, [month.id])).toMatchObject({ filled: 0, skipped: 1, undoAvailable: false });
  expect(values()).toEqual(['', '']);
  expect(commits).toEqual([]);
});

test('Undo preserves both Workday date segments after one is manually edited', async () => {
  const { engine, profile, values, year, render } = application();
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 2 });
  render(year, '2028');
  year.dispatchEvent(new Event('input', { bubbles: true }));
  expect(await engine.undo()).toEqual({ restored: 0, skipped: 2 });
  expect(values()).toEqual(['1', '2028']);
});

test('Undo keeps a segment when its original value would leave a partial Workday date', async () => {
  const { engine, profile, values, year, commits } = application(['', '2020']);
  let changedYears = 0;
  year.addEventListener('input', () => changedYears++);
  const scan = await engine.scan(profile);
  expect(await engine.fill(scan.scanId)).toMatchObject({ filled: 1, undoAvailable: true });
  expect(values()).toEqual(['1', '2020']);
  expect(commits).toEqual([['1', '2020']]);
  expect(changedYears).toBe(0);
  expect(await engine.undo()).toEqual({ restored: 0, skipped: 1 });
  expect(values()).toEqual(['1', '2020']);
  expect(commits).toEqual([['1', '2020']]);
  expect(changedYears).toBe(0);
});

test('Undo leaves a selected segment alone after an edit to the retained sibling', async () => {
  const { engine, profile, values, year, commits } = application(['2', '2020']);
  const scan = await engine.scan(profile, { overwriteExisting: true });
  const month = scan.fields.find(field => field.label === 'From Month')!;
  expect(await engine.fill(scan.scanId, [month.id])).toMatchObject({ filled: 1, undoAvailable: true });
  expect(values()).toEqual(['1', '2020']);
  year.dispatchEvent(new Event('input', { bubbles: true }));
  expect(await engine.undo()).toEqual({ restored: 0, skipped: 1 });
  expect(values()).toEqual(['1', '2020']);
  expect(commits).toEqual([['1', '2020']]);
});
